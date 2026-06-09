const cron = require('node-cron');
const { Op } = require('sequelize');
const {
  ReconciliationBatch,
  Discrepancy,
  DataSource,
  ReconciliationReport,
  ReportSubscription,
  ScheduleExecution
} = require('../models');

const MAX_REPORTS = 100;

let wsBroadcast = null;

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

function broadcastReport(report, subscription) {
  if (wsBroadcast) {
    wsBroadcast({
      type: 'report',
      data: {
        report: report.toJSON ? report.toJSON() : report,
        subscriptionId: subscription ? subscription.id : null,
        subscriptionName: subscription ? subscription.name : null,
        triggeredAt: new Date().toISOString()
      }
    });
  }
}

async function generateBatchReport(batchId) {
  const existing = await ReconciliationReport.findOne({ where: { batchId } });
  if (existing) return existing;

  const batch = await ReconciliationBatch.findByPk(batchId);
  if (!batch) throw new Error('批次不存在');
  if (batch.status !== 'completed') throw new Error('批次尚未完成对账，无法生成报告');

  const report = await _buildBatchReport(batch);
  const created = await ReconciliationReport.create(report);

  await cleanupOldReports();

  return created;
}

async function generateTimeRangeReport(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const existing = await ReconciliationReport.findOne({
    where: {
      reportType: 'time_range',
      timeRangeStart: start,
      timeRangeEnd: end
    },
    order: [['createdAt', 'DESC']]
  });

  if (existing) return existing;

  const batches = await ReconciliationBatch.findAll({
    where: {
      status: 'completed',
      createdAt: { [Op.gte]: start, [Op.lte]: end }
    },
    order: [['createdAt', 'ASC']]
  });

  if (batches.length === 0) {
    throw new Error('该时间范围内没有已完成的对账批次');
  }

  const report = await _buildTimeRangeReport(batches, start, end);
  const created = await ReconciliationReport.create(report);

  await cleanupOldReports();

  return created;
}

async function _buildBatchReport(batch) {
  const discrepancies = await Discrepancy.findAll({ where: { batchId: batch.id } });
  const totalRecords = batch.uniqueTransactionCount || (batch.matchedCount + batch.discrepancyCount) || batch.totalRecords;
  const matchRate = totalRecords > 0 ? batch.matchedCount / totalRecords : 0;

  const byType = {};
  for (const d of discrepancies) {
    byType[d.type] = (byType[d.type] || 0) + 1;
  }

  const discrepancyRatioByType = {};
  for (const [type, count] of Object.entries(byType)) {
    discrepancyRatioByType[type] = totalRecords > 0 ? count / totalRecords : 0;
  }

  let slaCompliant = null;
  const execution = await ScheduleExecution.findOne({ where: { batchId: batch.id } });
  if (execution) {
    slaCompliant = !execution.slaBreached;
  }

  const summary = {
    batchId: batch.id,
    batchNo: batch.batchNo,
    totalRecords,
    matchedCount: batch.matchedCount,
    discrepancyCount: discrepancies.length,
    matchRate: parseFloat(matchRate.toFixed(4)),
    discrepancyRatioByType,
    slaCompliant,
    completedAt: batch.endTime
  };

  const discrepancyDetails = await _buildDiscrepancyDetails(batch.id, discrepancies);

  const rootCauseDistribution = _buildRootCauseDistribution(discrepancies);

  const comparison = await _buildComparison(batch);

  return {
    reportType: 'batch',
    batchId: batch.id,
    timeRangeStart: batch.startTime,
    timeRangeEnd: batch.endTime,
    batchIds: [batch.id],
    summary,
    discrepancyDetails,
    rootCauseDistribution,
    comparison
  };
}

async function _buildTimeRangeReport(batches, startDate, endDate) {
  let totalRecords = 0;
  let totalMatched = 0;
  let totalDiscrepancies = 0;
  const allDiscrepancies = [];
  const batchIds = [];

  for (const batch of batches) {
    const batchTotal = batch.uniqueTransactionCount || (batch.matchedCount + batch.discrepancyCount) || batch.totalRecords;
    totalRecords += batchTotal;
    totalMatched += batch.matchedCount;

    const discrepancies = await Discrepancy.findAll({ where: { batchId: batch.id } });
    totalDiscrepancies += discrepancies.length;
    allDiscrepancies.push(...discrepancies);
    batchIds.push(batch.id);
  }

  const matchRate = totalRecords > 0 ? totalMatched / totalRecords : 0;

  const byType = {};
  for (const d of allDiscrepancies) {
    byType[d.type] = (byType[d.type] || 0) + 1;
  }

  const discrepancyRatioByType = {};
  for (const [type, count] of Object.entries(byType)) {
    discrepancyRatioByType[type] = totalRecords > 0 ? count / totalRecords : 0;
  }

  const slaBreachedCount = await ScheduleExecution.count({
    where: {
      batchId: { [Op.in]: batchIds },
      slaBreached: true
    }
  });

  const summary = {
    batchCount: batches.length,
    totalRecords,
    matchedCount: totalMatched,
    discrepancyCount: totalDiscrepancies,
    matchRate: parseFloat(matchRate.toFixed(4)),
    discrepancyRatioByType,
    slaCompliant: slaBreachedCount === 0,
    slaBreachedBatches: slaBreachedCount,
    timeRangeStart: startDate,
    timeRangeEnd: endDate
  };

  const discrepancyDetails = await _buildDiscrepancyDetailsForRange(allDiscrepancies);

  const rootCauseDistribution = _buildRootCauseDistribution(allDiscrepancies);

  const comparison = await _buildTimeRangeComparison(batches, startDate, endDate);

  return {
    reportType: 'time_range',
    batchId: null,
    timeRangeStart: startDate,
    timeRangeEnd: endDate,
    batchIds,
    summary,
    discrepancyDetails,
    rootCauseDistribution,
    comparison
  };
}

async function _buildDiscrepancyDetails(batchId, discrepancies) {
  const grouped = {};
  for (const d of discrepancies) {
    if (!grouped[d.type]) grouped[d.type] = [];
    grouped[d.type].push(d);
  }

  const details = {};
  for (const [type, items] of Object.entries(grouped)) {
    details[type] = {
      count: items.length,
      topItems: items.slice(0, 10).map(d => ({
        id: d.id,
        transactionId: d.transactionId,
        description: d.description,
        amountDiff: d.amountDiff ? parseFloat(d.amountDiff) : null,
        timeDiffSeconds: d.timeDiffSeconds,
        status: d.status,
        rootCause: d.rootCause,
        severity: d.severity,
        createdAt: d.createdAt
      }))
    };
  }

  return details;
}

async function _buildDiscrepancyDetailsForRange(discrepancies) {
  const grouped = {};
  for (const d of discrepancies) {
    if (!grouped[d.type]) grouped[d.type] = [];
    grouped[d.type].push(d);
  }

  const details = {};
  for (const [type, items] of Object.entries(grouped)) {
    details[type] = {
      count: items.length,
      topItems: items.slice(0, 10).map(d => ({
        id: d.id,
        transactionId: d.transactionId,
        description: d.description,
        amountDiff: d.amountDiff ? parseFloat(d.amountDiff) : null,
        timeDiffSeconds: d.timeDiffSeconds,
        status: d.status,
        rootCause: d.rootCause,
        severity: d.severity,
        createdAt: d.createdAt
      }))
    };
  }

  return details;
}

function _buildRootCauseDistribution(discrepancies) {
  const tagged = {};
  let untaggedCount = 0;

  for (const d of discrepancies) {
    if (d.rootCause) {
      tagged[d.rootCause] = (tagged[d.rootCause] || 0) + 1;
    } else {
      untaggedCount++;
    }
  }

  const total = discrepancies.length;
  const distribution = Object.entries(tagged)
    .map(([cause, count]) => ({
      rootCause: cause,
      count,
      percentage: total > 0 ? parseFloat((count / total * 100).toFixed(2)) : 0
    }))
    .sort((a, b) => b.count - a.count);

  if (untaggedCount > 0) {
    distribution.push({
      rootCause: '待分析',
      count: untaggedCount,
      percentage: total > 0 ? parseFloat((untaggedCount / total * 100).toFixed(2)) : 0
    });
  }

  return distribution;
}

async function _buildComparison(batch) {
  const currentDiscCount = batch.discrepancyCount;

  const previousBatch = await ReconciliationBatch.findOne({
    where: {
      status: 'completed',
      createdAt: { [Op.lt]: batch.createdAt },
      id: { [Op.ne]: batch.id }
    },
    order: [['createdAt', 'DESC']]
  });

  let sequentialChangeRate = null;
  if (previousBatch) {
    const prevDiscCount = previousBatch.discrepancyCount;
    if (prevDiscCount > 0) {
      sequentialChangeRate = parseFloat(((currentDiscCount - prevDiscCount) / prevDiscCount * 100).toFixed(2));
    } else if (currentDiscCount > 0) {
      sequentialChangeRate = 100;
    } else {
      sequentialChangeRate = 0;
    }
  }

  const sevenDaysAgo = new Date(batch.createdAt.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoEnd = new Date(sevenDaysAgo.getTime() + 2 * 60 * 60 * 1000);

  const sameTimeBatch = await ReconciliationBatch.findOne({
    where: {
      status: 'completed',
      createdAt: { [Op.gte]: sevenDaysAgo, [Op.lte]: sevenDaysAgoEnd },
      id: { [Op.ne]: batch.id }
    },
    order: [['createdAt', 'DESC']]
  });

  let weekOverWeekChangeRate = null;
  if (sameTimeBatch) {
    const weekDiscCount = sameTimeBatch.discrepancyCount;
    if (weekDiscCount > 0) {
      weekOverWeekChangeRate = parseFloat(((currentDiscCount - weekDiscCount) / weekDiscCount * 100).toFixed(2));
    } else if (currentDiscCount > 0) {
      weekOverWeekChangeRate = 100;
    } else {
      weekOverWeekChangeRate = 0;
    }
  }

  return {
    currentDiscrepancyCount: currentDiscCount,
    sequentialComparison: previousBatch ? {
      previousBatchId: previousBatch.id,
      previousBatchNo: previousBatch.batchNo,
      previousDiscrepancyCount: previousBatch.discrepancyCount,
      changeRate: sequentialChangeRate
    } : null,
    weekOverWeekComparison: sameTimeBatch ? {
      comparedBatchId: sameTimeBatch.id,
      comparedBatchNo: sameTimeBatch.batchNo,
      comparedDiscrepancyCount: sameTimeBatch.discrepancyCount,
      changeRate: weekOverWeekChangeRate
    } : null
  };
}

async function _buildTimeRangeComparison(batches, startDate, endDate) {
  const rangeMs = new Date(endDate) - new Date(startDate);
  const currentDiscCount = batches.reduce((sum, b) => sum + b.discrepancyCount, 0);

  const previousEnd = new Date(startDate);
  const previousStart = new Date(previousEnd.getTime() - rangeMs);

  const previousBatches = await ReconciliationBatch.findAll({
    where: {
      status: 'completed',
      createdAt: { [Op.gte]: previousStart, [Op.lt]: previousEnd }
    }
  });

  let sequentialChangeRate = null;
  if (previousBatches.length > 0) {
    const prevDiscCount = previousBatches.reduce((sum, b) => sum + b.discrepancyCount, 0);
    if (prevDiscCount > 0) {
      sequentialChangeRate = parseFloat(((currentDiscCount - prevDiscCount) / prevDiscCount * 100).toFixed(2));
    } else if (currentDiscCount > 0) {
      sequentialChangeRate = 100;
    } else {
      sequentialChangeRate = 0;
    }
  }

  const sevenDaysAgoEnd = new Date(new Date(startDate).getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoStart = new Date(sevenDaysAgoEnd.getTime() - rangeMs);

  const weekAgoBatches = await ReconciliationBatch.findAll({
    where: {
      status: 'completed',
      createdAt: { [Op.gte]: sevenDaysAgoStart, [Op.lte]: sevenDaysAgoEnd }
    }
  });

  let weekOverWeekChangeRate = null;
  if (weekAgoBatches.length > 0) {
    const weekDiscCount = weekAgoBatches.reduce((sum, b) => sum + b.discrepancyCount, 0);
    if (weekDiscCount > 0) {
      weekOverWeekChangeRate = parseFloat(((currentDiscCount - weekDiscCount) / weekDiscCount * 100).toFixed(2));
    } else if (currentDiscCount > 0) {
      weekOverWeekChangeRate = 100;
    } else {
      weekOverWeekChangeRate = 0;
    }
  }

  return {
    currentDiscrepancyCount: currentDiscCount,
    sequentialComparison: previousBatches.length > 0 ? {
      previousTimeRangeStart: previousStart,
      previousTimeRangeEnd: previousEnd,
      previousBatchCount: previousBatches.length,
      previousDiscrepancyCount: previousBatches.reduce((sum, b) => sum + b.discrepancyCount, 0),
      changeRate: sequentialChangeRate
    } : null,
    weekOverWeekComparison: weekAgoBatches.length > 0 ? {
      comparedTimeRangeStart: sevenDaysAgoStart,
      comparedTimeRangeEnd: sevenDaysAgoEnd,
      comparedBatchCount: weekAgoBatches.length,
      comparedDiscrepancyCount: weekAgoBatches.reduce((sum, b) => sum + b.discrepancyCount, 0),
      changeRate: weekOverWeekChangeRate
    } : null
  };
}

async function getReport(reportId) {
  const report = await ReconciliationReport.findByPk(reportId);
  if (!report) throw new Error('报告不存在');
  return report;
}

async function listReports(filters = {}) {
  const where = {};
  if (filters.reportType) where.reportType = filters.reportType;

  const { count, rows } = await ReconciliationReport.findAndCountAll({
    where,
    limit: Math.min(parseInt(filters.limit) || 50, 200),
    offset: parseInt(filters.offset) || 0,
    order: [['createdAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function cleanupOldReports() {
  const totalCount = await ReconciliationReport.count();
  if (totalCount <= MAX_REPORTS) return;

  const excess = totalCount - MAX_REPORTS;
  const oldest = await ReconciliationReport.findAll({
    order: [['createdAt', 'ASC']],
    limit: excess,
    attributes: ['id']
  });

  const idsToDelete = oldest.map(r => r.id);
  if (idsToDelete.length > 0) {
    await ReconciliationReport.destroy({ where: { id: { [Op.in]: idsToDelete } } });
  }
}

async function createSubscription(data) {
  if (!data.name) throw new Error('订阅名称不能为空');
  if (!['on_completion', 'cron'].includes(data.triggerMode)) {
    throw new Error('triggerMode 必须为 on_completion 或 cron');
  }

  if (data.triggerMode === 'cron') {
    if (!data.cronExpression) throw new Error('cron 模式下 cronExpression 不能为空');
    if (!cron.validate(data.cronExpression)) {
      throw new Error(`cronExpression 无效: "${data.cronExpression}" 不是合法的 cron 表达式`);
    }
  }

  if (data.filterDiscrepancyRatioThreshold !== undefined && data.filterDiscrepancyRatioThreshold !== null) {
    const t = data.filterDiscrepancyRatioThreshold;
    if (typeof t !== 'number' || t <= 0 || t > 1) {
      throw new Error('filterDiscrepancyRatioThreshold 必须为大于0且不超过1的数值（如0.1表示10%）');
    }
  }

  const subscription = await ReportSubscription.create({
    name: data.name,
    triggerMode: data.triggerMode,
    cronExpression: data.cronExpression || null,
    filterDataSourceIds: data.filterDataSourceIds || [],
    filterDiscrepancyRatioThreshold: data.filterDiscrepancyRatioThreshold || null,
    isEnabled: data.isEnabled !== undefined ? data.isEnabled : true
  });

  if (subscription.triggerMode === 'cron' && subscription.cronExpression) {
    const nextTrigger = _calculateNextCronTrigger(subscription.cronExpression);
    await subscription.update({ nextTriggerAt: nextTrigger });
  }

  return subscription;
}

async function updateSubscription(subscriptionId, data) {
  const subscription = await ReportSubscription.findByPk(subscriptionId);
  if (!subscription) throw new Error('订阅不存在');

  if (data.triggerMode && !['on_completion', 'cron'].includes(data.triggerMode)) {
    throw new Error('triggerMode 必须为 on_completion 或 cron');
  }

  const effectiveMode = data.triggerMode || subscription.triggerMode;
  const effectiveCron = data.cronExpression !== undefined ? data.cronExpression : subscription.cronExpression;

  if (effectiveMode === 'cron') {
    if (!effectiveCron) throw new Error('cron 模式下 cronExpression 不能为空');
    if (!cron.validate(effectiveCron)) {
      throw new Error(`cronExpression 无效: "${effectiveCron}" 不是合法的 cron 表达式`);
    }
  }

  if (data.filterDiscrepancyRatioThreshold !== undefined && data.filterDiscrepancyRatioThreshold !== null) {
    const t = data.filterDiscrepancyRatioThreshold;
    if (typeof t !== 'number' || t <= 0 || t > 1) {
      throw new Error('filterDiscrepancyRatioThreshold 必须为大于0且不超过1的数值（如0.1表示10%）');
    }
  }

  await subscription.update(data);

  if (effectiveMode === 'cron' && effectiveCron) {
    const nextTrigger = _calculateNextCronTrigger(effectiveCron);
    await subscription.update({ nextTriggerAt: nextTrigger });
  } else {
    await subscription.update({ nextTriggerAt: null });
  }

  return subscription;
}

async function toggleSubscription(subscriptionId) {
  const subscription = await ReportSubscription.findByPk(subscriptionId);
  if (!subscription) throw new Error('订阅不存在');

  const newEnabled = !subscription.isEnabled;
  await subscription.update({ isEnabled: newEnabled });

  if (newEnabled && subscription.triggerMode === 'cron' && subscription.cronExpression) {
    const nextTrigger = _calculateNextCronTrigger(subscription.cronExpression);
    await subscription.update({ nextTriggerAt: nextTrigger });
  }

  return subscription;
}

async function deleteSubscription(subscriptionId) {
  const subscription = await ReportSubscription.findByPk(subscriptionId);
  if (!subscription) throw new Error('订阅不存在');

  await subscription.destroy();
  return { message: '订阅已删除' };
}

async function listSubscriptions(filters = {}) {
  const where = {};
  if (filters.isEnabled !== undefined) where.isEnabled = filters.isEnabled === 'true';
  if (filters.triggerMode) where.triggerMode = filters.triggerMode;

  const { count, rows } = await ReportSubscription.findAndCountAll({
    where,
    limit: Math.min(parseInt(filters.limit) || 100, 500),
    offset: parseInt(filters.offset) || 0,
    order: [['createdAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getSubscription(subscriptionId) {
  const subscription = await ReportSubscription.findByPk(subscriptionId);
  if (!subscription) throw new Error('订阅不存在');
  return subscription;
}

function _calculateNextCronTrigger(cronExpression) {
  try {
    const task = cron.schedule(cronExpression, () => {}, { scheduled: false });
    const nextDate = task.getNextRun();
    task.stop();
    if (nextDate) {
      return nextDate instanceof Date ? nextDate : new Date(nextDate);
    }
  } catch (e) {
    console.error('计算下次触发时间失败:', e.message);
  }
  return null;
}

async function _matchesFilterAsync(subscription, report) {
  const filterDsIds = subscription.filterDataSourceIds || [];
  if (filterDsIds.length > 0) {
    const reportBatchIds = report.batchIds || [];
    if (reportBatchIds.length > 0) {
      const batches = await ReconciliationBatch.findAll({
        where: { id: { [Op.in]: reportBatchIds } }
      });
      const reportDsIds = new Set();
      for (const batch of batches) {
        const configuredDsIds = batch.config?.dataSourceIds || [];
        if (configuredDsIds.length > 0) {
          for (const dsId of configuredDsIds) {
            reportDsIds.add(dsId);
          }
        } else {
          const activeDataSources = await DataSource.findAll({ where: { isActive: true } });
          for (const ds of activeDataSources) {
            reportDsIds.add(ds.id);
          }
        }
      }
      const hasOverlap = filterDsIds.some(id => reportDsIds.has(id));
      if (!hasOverlap) return false;
    }
  }

  const threshold = subscription.filterDiscrepancyRatioThreshold;
  if (threshold !== null && threshold !== undefined) {
    const summary = report.summary || {};
    const ratiosByType = summary.discrepancyRatioByType || {};
    const exceedsThreshold = Object.values(ratiosByType).some(ratio => ratio > threshold);
    if (!exceedsThreshold) return false;
  }

  return true;
}

async function checkOnCompletionSubscriptions(batchId) {
  try {
    const report = await generateBatchReport(batchId);
    const subscriptions = await ReportSubscription.findAll({
      where: { triggerMode: 'on_completion', isEnabled: true }
    });

    for (const sub of subscriptions) {
      const matches = await _matchesFilterAsync(sub, report);
      if (matches) {
        broadcastReport(report, sub);
        await sub.update({ lastTriggeredAt: new Date() });
      }
    }
  } catch (err) {
    console.error('对账完成订阅推送失败:', err.message);
  }
}

async function checkCronSubscriptions() {
  const now = new Date();

  const subscriptions = await ReportSubscription.findAll({
    where: {
      triggerMode: 'cron',
      isEnabled: true,
      nextTriggerAt: { [Op.lte]: now }
    }
  });

  for (const sub of subscriptions) {
    const nextTrigger = _calculateNextCronTrigger(sub.cronExpression);
    await sub.update({ nextTriggerAt: nextTrigger });

    try {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

      const report = await generateTimeRangeReport(startDate, endDate);

      const matches = await _matchesFilterAsync(sub, report);
      if (matches) {
        broadcastReport(report, sub);
      }

      await sub.update({ lastTriggeredAt: new Date() });
    } catch (err) {
      console.error(`cron订阅「${sub.name}」触发失败:`, err.message);
      if (!sub.nextTriggerAt) {
        const retryNextTrigger = _calculateNextCronTrigger(sub.cronExpression);
        await sub.update({ nextTriggerAt: retryNextTrigger });
      }
    }
  }
}

module.exports = {
  setWsBroadcast,
  generateBatchReport,
  generateTimeRangeReport,
  getReport,
  listReports,
  cleanupOldReports,
  createSubscription,
  updateSubscription,
  toggleSubscription,
  deleteSubscription,
  listSubscriptions,
  getSubscription,
  checkOnCompletionSubscriptions,
  checkCronSubscriptions
};
