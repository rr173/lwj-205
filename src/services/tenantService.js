const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  Tenant,
  TenantQuota,
  TenantMetering,
  TenantApiUsage,
  sequelize
} = require('../models');

const DEFAULT_TENANT_NAME = 'default';

async function getDefaultTenant() {
  let tenant = await Tenant.findOne({ where: { name: DEFAULT_TENANT_NAME } });
  if (tenant) return tenant;

  tenant = await createTenant({
    name: DEFAULT_TENANT_NAME,
    displayName: '默认租户',
    description: '系统预置的默认租户，用于兼容历史数据',
    createdBy: 'system'
  }, null, {
    maxDataSources: 100,
    maxRecordsPerBatch: 1000000,
    maxActiveSchedulePlans: 50,
    maxConcurrentSandboxes: 50,
    maxApiCallsPerHour: 100000
  });

  return tenant;
}

async function createTenant(tenantData, createdBy = 'system', customQuotas = null) {
  const result = await sequelize.transaction(async (t) => {
    const tenant = await Tenant.create({
      id: uuidv4(),
      name: tenantData.name,
      displayName: tenantData.displayName || tenantData.name,
      description: tenantData.description || null,
      status: 'active',
      createdBy
    }, { transaction: t });

    const quotaData = customQuotas || TenantQuota.DEFAULT_QUOTAS;
    await TenantQuota.create({
      id: uuidv4(),
      tenantId: tenant.id,
      maxDataSources: quotaData.maxDataSources,
      maxRecordsPerBatch: quotaData.maxRecordsPerBatch,
      maxActiveSchedulePlans: quotaData.maxActiveSchedulePlans,
      maxConcurrentSandboxes: quotaData.maxConcurrentSandboxes,
      maxApiCallsPerHour: quotaData.maxApiCallsPerHour
    }, { transaction: t });

    return tenant;
  });

  return result;
}

async function listTenants(filters = {}) {
  const where = {};
  if (filters.status) where.status = filters.status;
  if (filters.name) where.name = { [Op.like]: `%${filters.name}%` };

  return Tenant.findAll({
    where,
    include: [{ model: TenantQuota, as: 'quota' }],
    order: [['createdAt', 'DESC']]
  });
}

async function getTenantById(tenantId) {
  return Tenant.findOne({
    where: { id: tenantId },
    include: [{ model: TenantQuota, as: 'quota' }]
  });
}

async function getTenantByName(name) {
  return Tenant.findOne({
    where: { name },
    include: [{ model: TenantQuota, as: 'quota' }]
  });
}

async function freezeTenant(tenantId, reason, operator) {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new Error('租户不存在');

  await tenant.update({
    status: 'frozen',
    frozenAt: new Date(),
    frozenBy: operator,
    frozenReason: reason
  });

  return tenant;
}

async function unfreezeTenant(tenantId, operator) {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new Error('租户不存在');

  await tenant.update({
    status: 'active',
    frozenAt: null,
    frozenBy: null,
    frozenReason: null
  });

  return tenant;
}

async function updateTenant(tenantId, updateData) {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) throw new Error('租户不存在');

  const allowedFields = ['displayName', 'description'];
  const updates = {};
  for (const field of allowedFields) {
    if (updateData[field] !== undefined) {
      updates[field] = updateData[field];
    }
  }

  await tenant.update(updates);
  return tenant;
}

async function updateTenantQuotas(tenantId, quotaData) {
  const quota = await TenantQuota.findOne({ where: { tenantId } });
  if (!quota) throw new Error('租户配额配置不存在');

  const DataSource = require('../models/DataSource');
  const SchedulePlan = require('../models/SchedulePlan');
  const Sandbox = require('../models/Sandbox');

  const newMaxDataSources = quotaData.maxDataSources !== undefined ? quotaData.maxDataSources : quota.maxDataSources;
  const newMaxActiveSchedulePlans = quotaData.maxActiveSchedulePlans !== undefined ? quotaData.maxActiveSchedulePlans : quota.maxActiveSchedulePlans;
  const newMaxConcurrentSandboxes = quotaData.maxConcurrentSandboxes !== undefined ? quotaData.maxConcurrentSandboxes : quota.maxConcurrentSandboxes;

  if (newMaxDataSources < quota.maxDataSources) {
    const currentDS = await DataSource.count({ where: { tenantId } });
    if (currentDS > newMaxDataSources) {
      const err = new Error(`无法缩减数据源配额: 当前已有 ${currentDS} 个数据源，新配额 ${newMaxDataSources} 不足以容纳。请先删除多余数据源或将配额设为 >= ${currentDS}`);
      err.code = 'QUOTA_REDUCTION_CONFLICT';
      err.currentUsage = currentDS;
      err.requestedLimit = newMaxDataSources;
      throw err;
    }
  }

  if (newMaxActiveSchedulePlans < quota.maxActiveSchedulePlans) {
    const currentSP = await SchedulePlan.count({ where: { tenantId, isActive: true, isDeleted: false } });
    if (currentSP > newMaxActiveSchedulePlans) {
      const err = new Error(`无法缩减调度计划配额: 当前已有 ${currentSP} 个活跃调度计划，新配额 ${newMaxActiveSchedulePlans} 不足以容纳。请先停用多余调度计划或将配额设为 >= ${currentSP}`);
      err.code = 'QUOTA_REDUCTION_CONFLICT';
      err.currentUsage = currentSP;
      err.requestedLimit = newMaxActiveSchedulePlans;
      throw err;
    }
  }

  if (newMaxConcurrentSandboxes < quota.maxConcurrentSandboxes) {
    const currentSB = await Sandbox.count({ where: { tenantId, status: ['creating', 'ready', 'running'] } });
    if (currentSB > newMaxConcurrentSandboxes) {
      const err = new Error(`无法缩减沙盒并发配额: 当前已有 ${currentSB} 个活跃沙盒，新配额 ${newMaxConcurrentSandboxes} 不足以容纳。请先删除多余沙盒或将配额设为 >= ${currentSB}`);
      err.code = 'QUOTA_REDUCTION_CONFLICT';
      err.currentUsage = currentSB;
      err.requestedLimit = newMaxConcurrentSandboxes;
      throw err;
    }
  }

  const updates = {};
  const fields = [
    'maxDataSources',
    'maxRecordsPerBatch',
    'maxActiveSchedulePlans',
    'maxConcurrentSandboxes',
    'maxApiCallsPerHour'
  ];

  for (const field of fields) {
    if (quotaData[field] !== undefined && quotaData[field] >= 0) {
      updates[field] = quotaData[field];
    }
  }

  await quota.update(updates);
  return quota;
}

module.exports = {
  getDefaultTenant,
  createTenant,
  listTenants,
  getTenantById,
  getTenantByName,
  freezeTenant,
  unfreezeTenant,
  updateTenant,
  updateTenantQuotas
};
