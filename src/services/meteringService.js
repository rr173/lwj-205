const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  TenantMetering,
  sequelize
} = require('../models');
const {
  asyncLocalStorage
} = require('../utils/tenantContext');

const METERING_RETENTION_DAYS = 90;

function getContextTenantId() {
  const ctx = asyncLocalStorage.getStore()?.get('tenantContext');
  return ctx ? ctx.tenantId : null;
}

async function recordMetering(tenantId, metricDate, metrics) {
  const tid = tenantId || getContextTenantId();
  if (!tid) return;

  try {
    const date = metricDate || new Date().toISOString().split('T')[0];
    const [record] = await TenantMetering.findOrCreate({
      where: { tenantId: tid, metricDate: date },
      defaults: {
        id: uuidv4(),
        tenantId: tid,
        metricDate: date,
        recordsProcessed: 0,
        discrepanciesGenerated: 0,
        apiCalls: 0,
        batchesCompleted: 0,
        ticketsResolved: 0
      }
    });

    const updates = {};
    if (metrics.recordsProcessed) updates.recordsProcessed = sequelize.literal(`recordsProcessed + ${metrics.recordsProcessed}`);
    if (metrics.discrepanciesGenerated) updates.discrepanciesGenerated = sequelize.literal(`discrepanciesGenerated + ${metrics.discrepanciesGenerated}`);
    if (metrics.apiCalls) updates.apiCalls = sequelize.literal(`apiCalls + ${metrics.apiCalls}`);
    if (metrics.batchesCompleted) updates.batchesCompleted = sequelize.literal(`batchesCompleted + ${metrics.batchesCompleted}`);
    if (metrics.ticketsResolved) updates.ticketsResolved = sequelize.literal(`ticketsResolved + ${metrics.ticketsResolved}`);

    if (Object.keys(updates).length > 0) {
      await TenantMetering.update(updates, {
        where: { id: record.id }
      });
    }
  } catch (err) {
    console.error('计量记录失败:', err);
  }
}

async function incrementRecordsProcessed(count, tenantId = null) {
  await recordMetering(tenantId, null, { recordsProcessed: count });
}

async function incrementDiscrepanciesGenerated(count, tenantId = null) {
  await recordMetering(tenantId, null, { discrepanciesGenerated: count });
}

async function incrementApiCalls(count, tenantId = null) {
  await recordMetering(tenantId, null, { apiCalls: count });
}

async function incrementBatchesCompleted(count, tenantId = null) {
  await recordMetering(tenantId, null, { batchesCompleted: count });
}

async function incrementTicketsResolved(count, tenantId = null) {
  await recordMetering(tenantId, null, { ticketsResolved: count });
}

async function getMeteringStats(tenantId, startDate, endDate) {
  const where = {};
  if (tenantId) where.tenantId = tenantId;

  if (startDate && endDate) {
    where.metricDate = { [Op.between]: [startDate, endDate] };
  } else if (startDate) {
    where.metricDate = { [Op.gte]: startDate };
  } else if (endDate) {
    where.metricDate = { [Op.lte]: endDate };
  }

  const records = await TenantMetering.findAll({
    where,
    order: [['metricDate', 'ASC']]
  });

  const summary = {
    totalRecordsProcessed: 0,
    totalDiscrepanciesGenerated: 0,
    totalApiCalls: 0,
    totalBatchesCompleted: 0,
    totalTicketsResolved: 0,
    dailyBreakdown: []
  };

  records.forEach(r => {
    summary.totalRecordsProcessed += Number(r.recordsProcessed) || 0;
    summary.totalDiscrepanciesGenerated += Number(r.discrepanciesGenerated) || 0;
    summary.totalApiCalls += Number(r.apiCalls) || 0;
    summary.totalBatchesCompleted += Number(r.batchesCompleted) || 0;
    summary.totalTicketsResolved += Number(r.ticketsResolved) || 0;
    summary.dailyBreakdown.push({
      date: r.metricDate,
      recordsProcessed: Number(r.recordsProcessed) || 0,
      discrepanciesGenerated: Number(r.discrepanciesGenerated) || 0,
      apiCalls: Number(r.apiCalls) || 0,
      batchesCompleted: Number(r.batchesCompleted) || 0,
      ticketsResolved: Number(r.ticketsResolved) || 0
    });
  });

  return summary;
}

async function cleanupOldMeteringData() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - METERING_RETENTION_DAYS);

  try {
    const deleted = await TenantMetering.destroy({
      where: {
        metricDate: { [Op.lt]: cutoffDate.toISOString().split('T')[0] }
      }
    });
    console.log(`清理计量数据完成，删除了 ${deleted} 条过期记录`);
    return deleted;
  } catch (err) {
    console.error('清理计量数据失败:', err);
    return 0;
  }
}

function startCleanupJob() {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    cleanupOldMeteringData();
  }, ONE_DAY_MS);
}

module.exports = {
  recordMetering,
  incrementRecordsProcessed,
  incrementDiscrepanciesGenerated,
  incrementApiCalls,
  incrementBatchesCompleted,
  incrementTicketsResolved,
  getMeteringStats,
  cleanupOldMeteringData,
  startCleanupJob,
  METERING_RETENTION_DAYS
};
