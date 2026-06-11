const tenantService = require('../services/tenantService');
const quotaService = require('../services/quotaService');
const meteringService = require('../services/meteringService');
const auditService = require('../services/auditService');

async function createTenant(req, res) {
  try {
    const { name, displayName, description, quotas } = req.body;

    if (!name) {
      return res.status(400).json({ error: '租户名称不能为空' });
    }

    const existing = await tenantService.getTenantByName(name);
    if (existing) {
      return res.status(400).json({ error: '租户名称已存在' });
    }

    const tenant = await tenantService.createTenant(
      { name, displayName, description },
      req.user?.id || 'system',
      quotas
    );

    await auditService.record({
      operator: req.user?.id || 'unknown',
      role: req.user?.role || 'admin',
      action: 'CREATE',
      targetType: 'tenant',
      targetId: tenant.id,
      tenantId: tenant.id,
      afterValue: tenant.toJSON(),
      ip: req.ip
    });

    const tenantWithQuota = await tenantService.getTenantById(tenant.id);

    res.status(201).json({
      message: '租户创建成功',
      tenant: tenantWithQuota
    });
  } catch (err) {
    console.error('创建租户失败:', err);
    res.status(500).json({ error: '创建租户失败', message: err.message });
  }
}

async function listTenants(req, res) {
  try {
    const { status, name } = req.query;
    const tenants = await tenantService.listTenants({ status, name });
    res.json({ total: tenants.length, data: tenants });
  } catch (err) {
    console.error('查询租户列表失败:', err);
    res.status(500).json({ error: '查询租户列表失败' });
  }
}

async function getTenant(req, res) {
  try {
    const { tenantId } = req.params;
    const tenant = await tenantService.getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: '租户不存在' });
    }
    res.json({ data: tenant });
  } catch (err) {
    console.error('查询租户详情失败:', err);
    res.status(500).json({ error: '查询租户详情失败' });
  }
}

async function updateTenant(req, res) {
  try {
    const { tenantId } = req.params;
    const { displayName, description } = req.body;

    const tenant = await tenantService.getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: '租户不存在' });
    }

    const beforeValue = tenant.toJSON();
    const updated = await tenantService.updateTenant(tenantId, { displayName, description });

    await auditService.record({
      operator: req.user?.id || 'unknown',
      role: req.user?.role || 'admin',
      action: 'UPDATE',
      targetType: 'tenant',
      targetId: tenantId,
      tenantId: tenantId,
      beforeValue,
      afterValue: updated.toJSON(),
      ip: req.ip
    });

    res.json({ message: '租户更新成功', data: updated });
  } catch (err) {
    console.error('更新租户失败:', err);
    res.status(500).json({ error: '更新租户失败', message: err.message });
  }
}

async function freezeTenant(req, res) {
  try {
    const { tenantId } = req.params;
    const { reason } = req.body;

    const tenant = await tenantService.getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: '租户不存在' });
    }

    const beforeValue = tenant.toJSON();
    const updated = await tenantService.freezeTenant(
      tenantId,
      reason || '超级管理员操作',
      req.user?.id || 'system'
    );

    await auditService.record({
      operator: req.user?.id || 'unknown',
      role: req.user?.role || 'superadmin',
      action: 'FREEZE',
      targetType: 'tenant',
      targetId: tenantId,
      tenantId: tenantId,
      beforeValue,
      afterValue: updated.toJSON(),
      ip: req.ip
    });

    res.json({ message: '租户已冻结', data: updated });
  } catch (err) {
    console.error('冻结租户失败:', err);
    res.status(500).json({ error: '冻结租户失败', message: err.message });
  }
}

async function unfreezeTenant(req, res) {
  try {
    const { tenantId } = req.params;

    const tenant = await tenantService.getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: '租户不存在' });
    }

    const beforeValue = tenant.toJSON();
    const updated = await tenantService.unfreezeTenant(
      tenantId,
      req.user?.id || 'system'
    );

    await auditService.record({
      operator: req.user?.id || 'unknown',
      role: req.user?.role || 'superadmin',
      action: 'UNFREEZE',
      targetType: 'tenant',
      targetId: tenantId,
      tenantId: tenantId,
      beforeValue,
      afterValue: updated.toJSON(),
      ip: req.ip
    });

    res.json({ message: '租户已解冻', data: updated });
  } catch (err) {
    console.error('解冻租户失败:', err);
    res.status(500).json({ error: '解冻租户失败', message: err.message });
  }
}

async function getQuotaUsage(req, res) {
  try {
    const { tenantId } = req.params;
    const usage = await quotaService.getQuotaUsage(tenantId);
    res.json({ data: usage });
  } catch (err) {
    console.error('获取配额使用情况失败:', err);
    res.status(500).json({ error: '获取配额使用情况失败', message: err.message });
  }
}

async function updateTenantQuotas(req, res) {
  try {
    const { tenantId } = req.params;
    const quotaData = req.body;

    const tenant = await tenantService.getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: '租户不存在' });
    }

    const beforeValue = tenant.quota?.toJSON() || null;
    const updated = await tenantService.updateTenantQuotas(tenantId, quotaData);

    await auditService.record({
      operator: req.user?.id || 'unknown',
      role: req.user?.role || 'superadmin',
      action: 'UPDATE_QUOTA',
      targetType: 'tenant_quota',
      targetId: tenantId,
      tenantId: tenantId,
      beforeValue,
      afterValue: updated.toJSON(),
      ip: req.ip
    });

    res.json({ message: '租户配额已更新', data: updated });
  } catch (err) {
    console.error('更新租户配额失败:', err);
    if (err.code === 'QUOTA_REDUCTION_CONFLICT') {
      return res.status(409).json({
        error: '配额缩减冲突',
        code: err.code,
        currentUsage: err.currentUsage,
        requestedLimit: err.requestedLimit,
        message: err.message
      });
    }
    res.status(500).json({ error: '更新租户配额失败', message: err.message });
  }
}

async function getMeteringStats(req, res) {
  try {
    const { tenantId } = req.params;
    const { startDate, endDate } = req.query;

    const stats = await meteringService.getMeteringStats(tenantId, startDate, endDate);
    res.json({ data: stats });
  } catch (err) {
    console.error('获取计量统计失败:', err);
    res.status(500).json({ error: '获取计量统计失败', message: err.message });
  }
}

async function getCurrentTenantInfo(req, res) {
  try {
    const ctx = require('../utils/tenantContext').getTenantContext();
    if (!ctx || ctx.isSuperAdmin) {
      return res.json({ data: { isSuperAdmin: true } });
    }

    const tenant = await tenantService.getTenantById(ctx.tenantId);
    const usage = await quotaService.getQuotaUsage(ctx.tenantId);

    res.json({
      data: {
        tenant: tenant,
        quotaUsage: usage
      }
    });
  } catch (err) {
    console.error('获取当前租户信息失败:', err);
    res.status(500).json({ error: '获取当前租户信息失败' });
  }
}

module.exports = {
  createTenant,
  listTenants,
  getTenant,
  updateTenant,
  freezeTenant,
  unfreezeTenant,
  getQuotaUsage,
  updateTenantQuotas,
  getMeteringStats,
  getCurrentTenantInfo
};
