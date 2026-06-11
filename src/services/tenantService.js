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
