const { AlertEvent, Transaction, DataSource, ReconciliationBatch, Discrepancy } = require('../models');
const { Op } = require('sequelize');
const alertRuleService = require('./alertRuleService');

const SPIKE_WINDOW_MS = 5 * 60 * 1000;
const SPIKE_MIN_BASELINE_WINDOWS = 2;
const FALLBACK_SPIKE_MULTIPLIER = 3;
const FALLBACK_SPIKE_COOLDOWN_MS = 5 * 60 * 1000;
const FALLBACK_DISCREPANCY_RATIO_THRESHOLDS = {
  unilateral: 0.15,
  amount_mismatch: 0.10,
  time_offset: 0.10
};

const discrepancyRatioRuleKeyMap = {
  unilateral: 'discrepancy_ratio_unilateral',
  amount_mismatch: 'discrepancy_ratio_amount_mismatch',
  time_offset: 'discrepancy_ratio_time_offset'
};

let wsBroadcast = null;

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

const importBuckets = {};
const lastSpikeAlertTime = {};

function recordImport(dataSourceId, count) {
  const now = Date.now();
  if (!importBuckets[dataSourceId]) {
    importBuckets[dataSourceId] = [];
  }
  importBuckets[dataSourceId].push({ time: now, count });
  importBuckets[dataSourceId] = importBuckets[dataSourceId].filter(
    e => now - e.time < SPIKE_WINDOW_MS
  );
}

async function getSpikeMultiplier(dataSourceId) {
  const resolved = await alertRuleService.resolveEffectiveRule('volume_spike_multiplier', dataSourceId);
  if (resolved.rule) {
    return { multiplier: resolved.rule.parameters.multiplier, ruleId: resolved.ruleId, scope: resolved.scope };
  }
  return { multiplier: FALLBACK_SPIKE_MULTIPLIER, ruleId: null, scope: null };
}

async function getSpikeCooldown(dataSourceId) {
  const resolved = await alertRuleService.resolveEffectiveRule('volume_spike_cooldown', dataSourceId);
  if (resolved.rule) {
    return { cooldownMs: (resolved.rule.parameters.cooldownMinutes || 5) * 60 * 1000, ruleId: resolved.ruleId, scope: resolved.scope };
  }
  return { cooldownMs: FALLBACK_SPIKE_COOLDOWN_MS, ruleId: null, scope: null };
}

async function getDiscrepancyThreshold(type, dataSourceId) {
  const ruleKey = discrepancyRatioRuleKeyMap[type];
  if (!ruleKey) {
    return { threshold: FALLBACK_DISCREPANCY_RATIO_THRESHOLDS[type] || 0.15, ruleId: null, scope: null };
  }
  const resolved = await alertRuleService.resolveEffectiveRule(ruleKey, dataSourceId);
  if (resolved.rule) {
    return { threshold: resolved.rule.parameters.threshold, ruleId: resolved.ruleId, scope: resolved.scope };
  }
  return { threshold: FALLBACK_DISCREPANCY_RATIO_THRESHOLDS[type] || 0.15, ruleId: null, scope: null };
}

async function checkVolumeSpike(dataSourceId, importedCount) {
  recordImport(dataSourceId, importedCount);

  const now = Date.now();
  const cooldownInfo = await getSpikeCooldown(dataSourceId);

  if (lastSpikeAlertTime[dataSourceId] && (now - lastSpikeAlertTime[dataSourceId] < cooldownInfo.cooldownMs)) {
    return null;
  }

  const multiplierInfo = await getSpikeMultiplier(dataSourceId);
  const spikeMultiplier = multiplierInfo.multiplier;

  const windowStart = now - SPIKE_WINDOW_MS;
  const entries = importBuckets[dataSourceId] || [];
  const recentEntries = entries.filter(e => e.time >= windowStart);
  const recentTotal = recentEntries.reduce((sum, e) => sum + e.count, 0);

  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const windowStartDate = new Date(windowStart);

  const pastCount = await Transaction.count({
    where: {
      dataSourceId,
      createdAt: { [Op.gte]: oneHourAgo, [Op.lt]: windowStartDate }
    }
  });

  if (pastCount === 0) {
    return null;
  }

  const fiveMinIntervals = 12;
  const occupiedWindows = Math.max(1, Math.min(
    fiveMinIntervals,
    Math.ceil((windowStartDate - oneHourAgo) / SPIKE_WINDOW_MS)
  ));
  const nonEmptyWindows = pastCount > 0
    ? Math.min(occupiedWindows, Math.ceil(pastCount / Math.max(1, pastCount / occupiedWindows)))
    : 0;

  if (nonEmptyWindows < SPIKE_MIN_BASELINE_WINDOWS) {
    return null;
  }

  const avgPerWindow = pastCount / occupiedWindows;

  if (avgPerWindow > 0 && recentTotal > avgPerWindow * spikeMultiplier) {
    const ds = await DataSource.findByPk(dataSourceId);
    lastSpikeAlertTime[dataSourceId] = now;
    const actualMultiplier = parseFloat((recentTotal / avgPerWindow).toFixed(2));
    const triggeredRuleId = multiplierInfo.ruleId;
    const triggeredRuleScope = multiplierInfo.scope;
    const alert = await AlertEvent.create({
      type: 'volume_spike',
      severity: recentTotal > avgPerWindow * 5 ? 'critical' : 'warning',
      title: '数据导入量突增预警',
      message: `数据源「${ds ? ds.name : dataSourceId}」在5分钟内导入${recentTotal}条记录，超过正常均值(${avgPerWindow.toFixed(1)}条/5分钟)的${actualMultiplier}倍`,
      dataSourceId,
      dataSourceName: ds ? ds.name : null,
      triggeredRuleId,
      triggeredRuleScope,
      metric: {
        recentCount: recentTotal,
        avgPerWindow: parseFloat(avgPerWindow.toFixed(1)),
        multiplier: actualMultiplier,
        windowMinutes: 5,
        baselineWindows: occupiedWindows,
        thresholdMultiplier: spikeMultiplier
      }
    });
    broadcastAlert(alert);
    return alert;
  }
  return null;
}

async function checkDiscrepancyRatio(batchId) {
  const batch = await ReconciliationBatch.findByPk(batchId);
  if (!batch || batch.status !== 'completed') return [];

  const totalCount = batch.uniqueTransactionCount || (batch.matchedCount + batch.discrepancyCount);
  if (totalCount === 0) return [];

  const discrepancies = await Discrepancy.findAll({ where: { batchId } });
  const alerts = [];

  const typeLabels = {
    unilateral: '单边挂账',
    amount_mismatch: '金额不符',
    time_offset: '时间偏移'
  };

  const dataSources = await DataSource.findAll({ where: { isActive: true } });
  const batchDsIds = batch.config?.dataSourceIds?.length
    ? batch.config.dataSourceIds
    : dataSources.map(ds => ds.id);

  const dsNameMap = {};
  for (const ds of dataSources) {
    dsNameMap[ds.id] = ds.name;
  }

  const byTypeAndDs = {};
  for (const d of discrepancies) {
    const involvedDsIds = new Set();

    if (d.sourceTransactions && Array.isArray(d.sourceTransactions)) {
      for (const st of d.sourceTransactions) {
        if (st.dataSourceId) involvedDsIds.add(st.dataSourceId);
      }
    }

    if (d.missingInSources && Array.isArray(d.missingInSources)) {
      for (const mid of d.missingInSources) {
        involvedDsIds.add(mid);
      }
    }

    if (involvedDsIds.size === 0) {
      for (const dsId of batchDsIds) {
        involvedDsIds.add(dsId);
      }
    }

    for (const dsId of involvedDsIds) {
      if (!byTypeAndDs[d.type]) byTypeAndDs[d.type] = {};
      byTypeAndDs[d.type][dsId] = (byTypeAndDs[d.type][dsId] || 0) + 1;
    }
  }

  for (const [discType, dsCounts] of Object.entries(byTypeAndDs)) {
    for (const [dsId, count] of Object.entries(dsCounts)) {
      const ratio = count / totalCount;
      const thresholdInfo = await getDiscrepancyThreshold(discType, dsId);
      const threshold = thresholdInfo.threshold;

      if (ratio > threshold) {
        const severity = ratio > threshold * 2 ? 'critical' : 'warning';
        const dsName = dsNameMap[dsId] || dsId;
        const alert = await AlertEvent.create({
          type: 'discrepancy_ratio',
          severity,
          title: '差异占比超限告警',
          message: `批次「${batch.batchNo}」数据源「${dsName}」${typeLabels[discType] || discType}差异占比${(ratio * 100).toFixed(1)}%，超过阈值${(threshold * 100).toFixed(0)}%（${count}笔/${totalCount}笔）`,
          batchId,
          batchNo: batch.batchNo,
          dataSourceId: dsId,
          dataSourceName: dsName,
          triggeredRuleId: thresholdInfo.ruleId,
          triggeredRuleScope: thresholdInfo.scope,
          metric: {
            discrepancyType: discType,
            discrepancyCount: count,
            totalRecords: totalCount,
            ratio: parseFloat(ratio.toFixed(4)),
            threshold,
            thresholdPercent: parseFloat((threshold * 100).toFixed(0)),
            resolvedForDataSourceId: dsId,
            resolvedForDataSourceName: dsName
          }
        });
        broadcastAlert(alert);
        alerts.push(alert);
      }
    }
  }

  return alerts;
}

function broadcastAlert(alert) {
  if (wsBroadcast) {
    wsBroadcast({
      type: 'alert',
      data: alert.toJSON ? alert.toJSON() : alert
    });
  }
}

async function getAlerts(filters = {}) {
  const where = {};
  if (filters.type) where.type = filters.type;
  if (filters.severity) where.severity = filters.severity;
  if (filters.isRead !== undefined) where.isRead = filters.isRead === 'true';

  const { count, rows } = await AlertEvent.findAndCountAll({
    where,
    limit: Math.min(parseInt(filters.limit) || 100, 500),
    offset: parseInt(filters.offset) || 0,
    order: [['createdAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function markAlertRead(alertId) {
  const alert = await AlertEvent.findByPk(alertId);
  if (!alert) throw new Error('告警事件不存在');
  await alert.update({ isRead: true });
  return alert;
}

async function getImportTrend(minutes = 60) {
  const since = new Date(Date.now() - minutes * 60 * 1000);
  const dataSources = await DataSource.findAll({ where: { isActive: true } });

  const result = [];
  for (const ds of dataSources) {
    const transactions = await Transaction.findAll({
      where: {
        dataSourceId: ds.id,
        createdAt: { [Op.gte]: since }
      },
      attributes: ['createdAt'],
      order: [['createdAt', 'ASC']]
    });

    const buckets = {};
    const bucketSize = 5;
    for (let i = 0; i < minutes / bucketSize; i++) {
      const bucketStart = new Date(since.getTime() + i * bucketSize * 60 * 1000);
      const key = bucketStart.toISOString();
      buckets[key] = 0;
    }

    for (const tx of transactions) {
      const txTime = new Date(tx.createdAt);
      const bucketIndex = Math.floor((txTime - since) / (bucketSize * 60 * 1000));
      const bucketStart = new Date(since.getTime() + bucketIndex * bucketSize * 60 * 1000);
      const key = bucketStart.toISOString();
      if (buckets[key] !== undefined) {
        buckets[key]++;
      }
    }

    result.push({
      dataSourceId: ds.id,
      dataSourceName: ds.name,
      bucketSizeMinutes: bucketSize,
      dataPoints: Object.entries(buckets).map(([time, count]) => ({
        time,
        count
      }))
    });
  }

  return result;
}

async function getBatchHealthOverview() {
  const batches = await ReconciliationBatch.findAll({
    where: { status: 'completed' },
    order: [['createdAt', 'DESC']],
    limit: 20
  });

  const result = [];
  for (const batch of batches) {
    const discrepancies = await Discrepancy.findAll({ where: { batchId: batch.id } });
    const totalDisc = discrepancies.length;
    const uniqueTxCount = batch.uniqueTransactionCount || (batch.matchedCount + batch.discrepancyCount) || batch.totalRecords;

    const byType = {};
    for (const d of discrepancies) {
      byType[d.type] = (byType[d.type] || 0) + 1;
    }

    const ratios = {};
    for (const [type, count] of Object.entries(byType)) {
      ratios[type] = uniqueTxCount > 0 ? count / uniqueTxCount : 0;
    }

    let health = 'green';
    for (const [type, ratio] of Object.entries(ratios)) {
      const thresholdInfo = await getDiscrepancyThreshold(type, null);
      const threshold = thresholdInfo.threshold;
      if (ratio > threshold * 2) {
        health = 'red';
        break;
      }
      if (ratio > threshold) {
        health = 'yellow';
      }
    }

    if (totalDisc === 0 && uniqueTxCount > 0) {
      health = 'green';
    }

    result.push({
      batchId: batch.id,
      batchNo: batch.batchNo,
      totalRecords: batch.totalRecords,
      uniqueTransactionCount: uniqueTxCount,
      matchedCount: batch.matchedCount,
      discrepancyCount: totalDisc,
      discrepancyByType: byType,
      discrepancyRatios: ratios,
      health,
      createdAt: batch.createdAt,
      endTime: batch.endTime
    });
  }

  return result;
}

module.exports = {
  setWsBroadcast,
  checkVolumeSpike,
  checkDiscrepancyRatio,
  getAlerts,
  markAlertRead,
  getImportTrend,
  getBatchHealthOverview,
  FALLBACK_DISCREPANCY_RATIO_THRESHOLDS
};
