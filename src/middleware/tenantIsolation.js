const { Op } = require('sequelize');
const {
  Tenant,
  DataSource,
  Transaction,
  ReconciliationBatch,
  Discrepancy,
  ArbitrationTicket,
  AdjustmentInstruction,
  ArbitrationRule,
  AlertEvent,
  AlertRule,
  AlertRuleHistory,
  SchedulePlan,
  ScheduleExecution,
  ReconciliationReport,
  ReportSubscription,
  HealthProbe,
  ProbeResult,
  SelfHealingLog,
  AuditLog,
  TransactionArchive,
  DiscrepancyArchive,
  ArbitrationTicketArchive,
  AdjustmentInstructionArchive,
  ArchiveConfig,
  Sandbox,
  SandboxTransaction,
  SandboxDiscrepancy,
  SandboxArbitrationTicket,
  BacktestPlan,
  BacktestExecution,
  SensitivityAnalysis
} = require('../models');
const {
  asyncLocalStorage,
  getCurrentTenantId,
  getBypassTenantFilter,
  isSuperAdmin
} = require('../utils/tenantContext');

const SUPERADMIN_ROLE = 'superadmin';
const DEFAULT_TENANT_NAME = 'default';

const TENANT_AWARE_MODELS = [
  DataSource,
  Transaction,
  ReconciliationBatch,
  Discrepancy,
  ArbitrationTicket,
  AdjustmentInstruction,
  ArbitrationRule,
  AlertEvent,
  AlertRule,
  AlertRuleHistory,
  SchedulePlan,
  ScheduleExecution,
  ReconciliationReport,
  ReportSubscription,
  HealthProbe,
  ProbeResult,
  SelfHealingLog,
  AuditLog,
  TransactionArchive,
  DiscrepancyArchive,
  ArbitrationTicketArchive,
  AdjustmentInstructionArchive,
  ArchiveConfig,
  Sandbox,
  SandboxTransaction,
  SandboxDiscrepancy,
  SandboxArbitrationTicket,
  BacktestPlan,
  BacktestExecution,
  SensitivityAnalysis
];

function applyTenantScope(Model) {
  Model.addScope('tenant', (tenantId) => {
    return {
      where: { tenantId }
    };
  });

  const originalFindAll = Model.findAll.bind(Model);
  Model.findAll = function (options = {}) {
    if (!getBypassTenantFilter() && !isSuperAdmin()) {
      const tenantId = getCurrentTenantId();
      if (tenantId) {
        options.where = options.where || {};
        options.where.tenantId = tenantId;
      }
    }
    return originalFindAll(options);
  };

  const originalFindOne = Model.findOne.bind(Model);
  Model.findOne = function (options = {}) {
    if (!getBypassTenantFilter() && !isSuperAdmin()) {
      const tenantId = getCurrentTenantId();
      if (tenantId) {
        options.where = options.where || {};
        options.where.tenantId = tenantId;
      }
    }
    return originalFindOne(options);
  };

  const originalFindByPk = Model.findByPk.bind(Model);
  Model.findByPk = function (identifier, options = {}) {
    if (!getBypassTenantFilter() && !isSuperAdmin()) {
      const tenantId = getCurrentTenantId();
      if (tenantId) {
        options.where = options.where || {};
        options.where.tenantId = tenantId;
      }
    }
    return originalFindByPk(identifier, options);
  };

  const originalCount = Model.count.bind(Model);
  Model.count = function (options = {}) {
    if (!getBypassTenantFilter() && !isSuperAdmin()) {
      const tenantId = getCurrentTenantId();
      if (tenantId) {
        options.where = options.where || {};
        options.where.tenantId = tenantId;
      }
    }
    return originalCount(options);
  };

  const originalCreate = Model.create.bind(Model);
  Model.create = function (values, options = {}) {
    const tenantId = getCurrentTenantId();
    if (tenantId && !values.tenantId) {
      values.tenantId = tenantId;
    }
    return originalCreate(values, options);
  };

  const originalBulkCreate = Model.bulkCreate.bind(Model);
  Model.bulkCreate = function (records, options = {}) {
    const tenantId = getCurrentTenantId();
    if (tenantId) {
      records.forEach(r => {
        if (!r.tenantId) r.tenantId = tenantId;
      });
    }
    return originalBulkCreate(records, options);
  };

  const originalUpdate = Model.update.bind(Model);
  Model.update = function (values, options = {}) {
    if (!getBypassTenantFilter() && !isSuperAdmin()) {
      const tenantId = getCurrentTenantId();
      if (tenantId) {
        options.where = options.where || {};
        options.where.tenantId = tenantId;
      }
    }
    return originalUpdate(values, options);
  };

  const originalDestroy = Model.destroy.bind(Model);
  Model.destroy = function (options = {}) {
    if (!getBypassTenantFilter() && !isSuperAdmin()) {
      const tenantId = getCurrentTenantId();
      if (tenantId) {
        options.where = options.where || {};
        options.where.tenantId = tenantId;
      }
    }
    return originalDestroy(options);
  };
}

function initTenantScopes() {
  TENANT_AWARE_MODELS.forEach(Model => applyTenantScope(Model));
}

async function extractAndValidateTenant(req, res, next) {
  const store = new Map();
  asyncLocalStorage.run(store, async () => {
    try {
      const userRole = req.user ? req.user.role : 'viewer';
      const isSA = userRole === SUPERADMIN_ROLE;

      if (isSA) {
        store.set('tenantContext', {
          isSuperAdmin: true,
          bypassTenantFilter: true
        });
        return next();
      }

      const tenantId = req.headers['x-tenant-id'];
      if (!tenantId) {
        return res.status(400).json({
          error: '缺少租户标识',
          message: '请求必须携带 X-Tenant-Id 请求头'
        });
      }

      const tenant = await Tenant.findOne({
        where: {
          [Op.or]: [
            { id: tenantId },
            { name: tenantId }
          ]
        }
      });

      if (!tenant) {
        return res.status(400).json({
          error: '租户不存在',
          message: `找不到标识为 ${tenantId} 的租户`
        });
      }

      store.set('tenantContext', {
        tenantId: tenant.id,
        tenant: tenant.toJSON(),
        isSuperAdmin: false,
        bypassTenantFilter: false
      });

      next();
    } catch (err) {
      console.error('租户校验失败:', err);
      res.status(500).json({ error: '租户校验失败' });
    }
  });
}

function checkTenantFrozen(req, res, next) {
  const ctx = asyncLocalStorage.getStore()?.get('tenantContext');
  if (!ctx || ctx.isSuperAdmin) {
    return next();
  }

  const tenant = ctx.tenant;
  const method = req.method;
  const isWriteOperation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);

  if (tenant && tenant.status === 'frozen' && isWriteOperation) {
    return res.status(403).json({
      error: '租户已冻结',
      message: '该租户已被冻结，所有写操作被禁止，请联系超级管理员解冻'
    });
  }

  next();
}

module.exports = {
  initTenantScopes,
  extractAndValidateTenant,
  checkTenantFrozen,
  SUPERADMIN_ROLE,
  DEFAULT_TENANT_NAME
};
