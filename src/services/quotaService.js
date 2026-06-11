const { Op } = require('sequelize');
const {
  TenantQuota,
  Tenant,
  DataSource,
  SchedulePlan,
  Sandbox,
  TenantApiUsage,
  sequelize
} = require('../models');
const {
  asyncLocalStorage
} = require('../utils/tenantContext');

class QuotaExceededError extends Error {
  constructor(quotaName, used, limit) {
    super(`配额不足: ${quotaName} (已用 ${used}/${limit})`);
    this.name = 'QuotaExceededError';
    this.quotaName = quotaName;
    this.used = used;
    this.limit = limit;
  }
}

const tenantMutexQueue = new Map();

function acquireTenantMutex(tenantId) {
  return new Promise((resolve) => {
    if (!tenantMutexQueue.has(tenantId)) {
      tenantMutexQueue.set(tenantId, []);
      resolve();
      return;
    }
    const queue = tenantMutexQueue.get(tenantId);
    queue.push(resolve);
  });
}

function releaseTenantMutex(tenantId) {
  const queue = tenantMutexQueue.get(tenantId);
  if (!queue || queue.length === 0) {
    tenantMutexQueue.delete(tenantId);
    return;
  }
  const next = queue.shift();
  next();
}

function getContextTenantId() {
  const ctx = asyncLocalStorage.getStore()?.get('tenantContext');
  return ctx ? ctx.tenantId : null;
}

async function getTenantQuotas(tenantId = null) {
  const tid = tenantId || getContextTenantId();
  if (!tid) throw new Error('租户上下文不存在');

  const quota = await TenantQuota.findOne({ where: { tenantId: tid } });
  if (!quota) throw new Error('租户配额配置不存在');

  return quota.toJSON();
}

async function getQuotaUsage(tenantId = null) {
  const tid = tenantId || getContextTenantId();
  if (!tid) throw new Error('租户上下文不存在');

  const quota = await getTenantQuotas(tid);

  const dataSourceCount = await DataSource.count({ where: { tenantId: tid } });
  const activeScheduleCount = await SchedulePlan.count({
    where: { tenantId: tid, isActive: true, isDeleted: false }
  });
  const concurrentSandboxCount = await Sandbox.count({
    where: { tenantId: tid, status: ['creating', 'ready', 'running'] }
  });

  const now = new Date();
  const hourBucket = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  const apiUsage = await TenantApiUsage.findOne({
    where: { tenantId: tid, hourBucket }
  });
  const apiCalls = apiUsage ? apiUsage.callCount : 0;

  return {
    quotas: quota,
    usage: {
      dataSources: {
        used: dataSourceCount,
        limit: quota.maxDataSources,
        remaining: Math.max(0, quota.maxDataSources - dataSourceCount)
      },
      activeSchedulePlans: {
        used: activeScheduleCount,
        limit: quota.maxActiveSchedulePlans,
        remaining: Math.max(0, quota.maxActiveSchedulePlans - activeScheduleCount)
      },
      concurrentSandboxes: {
        used: concurrentSandboxCount,
        limit: quota.maxConcurrentSandboxes,
        remaining: Math.max(0, quota.maxConcurrentSandboxes - concurrentSandboxCount)
      },
      apiCallsPerHour: {
        used: apiCalls,
        limit: quota.maxApiCallsPerHour,
        remaining: Math.max(0, quota.maxApiCallsPerHour - apiCalls)
      },
      maxRecordsPerBatch: {
        limit: quota.maxRecordsPerBatch
      }
    }
  };
}

async function checkDataSourcesQuota(tenantId = null, count = 1) {
  const tid = tenantId || getContextTenantId();
  if (!tid) throw new Error('租户上下文不存在');

  await acquireTenantMutex(tid);
  try {
    const quota = await TenantQuota.findOne({ where: { tenantId: tid } });
    if (!quota) throw new Error('租户配额配置不存在');

    const currentCount = await DataSource.count({ where: { tenantId: tid } });
    if (currentCount + count > quota.maxDataSources) {
      throw new QuotaExceededError('maxDataSources', currentCount + count, quota.maxDataSources);
    }
    return true;
  } finally {
    releaseTenantMutex(tid);
  }
}

async function checkActiveSchedulePlansQuota(tenantId = null) {
  const tid = tenantId || getContextTenantId();
  if (!tid) throw new Error('租户上下文不存在');

  await acquireTenantMutex(tid);
  try {
    const quota = await TenantQuota.findOne({ where: { tenantId: tid } });
    if (!quota) throw new Error('租户配额配置不存在');

    const currentCount = await SchedulePlan.count({
      where: { tenantId: tid, isActive: true, isDeleted: false }
    });
    if (currentCount + 1 > quota.maxActiveSchedulePlans) {
      throw new QuotaExceededError('maxActiveSchedulePlans', currentCount + 1, quota.maxActiveSchedulePlans);
    }
    return true;
  } finally {
    releaseTenantMutex(tid);
  }
}

async function checkConcurrentSandboxesQuota(tenantId = null) {
  const tid = tenantId || getContextTenantId();
  if (!tid) throw new Error('租户上下文不存在');

  await acquireTenantMutex(tid);
  try {
    const quota = await TenantQuota.findOne({ where: { tenantId: tid } });
    if (!quota) throw new Error('租户配额配置不存在');

    const currentCount = await Sandbox.count({
      where: { tenantId: tid, status: ['creating', 'ready', 'running'] }
    });
    if (currentCount + 1 > quota.maxConcurrentSandboxes) {
      throw new QuotaExceededError('maxConcurrentSandboxes', currentCount + 1, quota.maxConcurrentSandboxes);
    }
    return true;
  } finally {
    releaseTenantMutex(tid);
  }
}

async function checkRecordsPerBatchQuota(recordsCount, tenantId = null) {
  const tid = tenantId || getContextTenantId();
  if (!tid) throw new Error('租户上下文不存在');

  const quota = await TenantQuota.findOne({ where: { tenantId: tid } });
  if (!quota) throw new Error('租户配额配置不存在');

  if (recordsCount > quota.maxRecordsPerBatch) {
    throw new QuotaExceededError('maxRecordsPerBatch', recordsCount, quota.maxRecordsPerBatch);
  }
  return true;
}

async function checkApiCallsQuota(tenantId = null) {
  const tid = tenantId || getContextTenantId();
  if (!tid) return true;

  await acquireTenantMutex(tid);
  try {
    const quota = await TenantQuota.findOne({ where: { tenantId: tid } });
    if (!quota) return true;

    const now = new Date();
    const hourBucket = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

    let usage = await TenantApiUsage.findOne({ where: { tenantId: tid, hourBucket } });
    if (!usage) {
      usage = await TenantApiUsage.create({
        id: require('uuid').v4(),
        tenantId: tid,
        hourBucket,
        callCount: 0
      });
    }

    if (usage.callCount + 1 > quota.maxApiCallsPerHour) {
      throw new QuotaExceededError('maxApiCallsPerHour', usage.callCount + 1, quota.maxApiCallsPerHour);
    }

    await usage.increment('callCount', { by: 1 });
    return true;
  } finally {
    releaseTenantMutex(tid);
  }
}

async function incrementApiCallCount(tenantId = null) {
  const tid = tenantId || getContextTenantId();
  if (!tid) return;

  const now = new Date();
  const hourBucket = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

  try {
    await TenantApiUsage.upsert({
      tenantId: tid,
      hourBucket
    }, {
      callCount: sequelize.literal('callCount + 1')
    });
  } catch (err) {
    console.error('API调用计数失败:', err);
  }
}

async function withTenantWriteLock(tenantId, fn) {
  await acquireTenantMutex(tenantId);
  try {
    return await fn();
  } finally {
    releaseTenantMutex(tenantId);
  }
}

module.exports = {
  QuotaExceededError,
  getTenantQuotas,
  getQuotaUsage,
  checkDataSourcesQuota,
  checkRecordsPerBatchQuota,
  checkActiveSchedulePlansQuota,
  checkConcurrentSandboxesQuota,
  checkApiCallsQuota,
  incrementApiCallCount,
  acquireTenantMutex,
  releaseTenantMutex,
  withTenantWriteLock
};
