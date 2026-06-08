const { AlertEvent, Transaction, DataSource, ReconciliationBatch, Discrepancy } = require('../models');
const { Op } = require('sequelize');

const SPIKE_WINDOW_MS = 5 * 60 * 1000;
const SPIKE_MULTIPLIER = 3;
const DISCREPANCY_RATIO_THRESHOLDS = {
  unilateral: 0.15,
  amount_mismatch: 0.10,
  time_offset: 0.10
};

let wsBroadcast = null;

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

const importBuckets = {};

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

async function checkVolumeSpike(dataSourceId, importedCount) {
  recordImport(dataSourceId, importedCount);

  const now = Date.now();
  const windowStart = now - SPIKE_WINDOW_MS;
  const entries = importBuckets[dataSourceId] || [];
  const recentEntries = entries.filter(e => e.time >= windowStart);
  const recentTotal = recentEntries.reduce((sum, e) => sum + e.count, 0);

  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const pastCount = await Transaction.count({
    where: {
      dataSourceId,
      createdAt: { [Op.gte]: oneHourAgo, [Op.lt]: new Date(windowStart) }
    }
  });

  const fiveMinIntervals = 12;
  const avgPerWindow = pastCount / fiveMinIntervals;

  if (avgPerWindow > 0 && recentTotal > avgPerWindow * SPIKE_MULTIPLIER) {
    const ds = await DataSource.findByPk(dataSourceId);
    const alert = await AlertEvent.create({
      type: 'volume_spike',
      severity: recentTotal > avgPerWindow * 5 ? 'critical' : 'warning',
      title: '数据导入量突增预警',
      message: `数据源「${ds ? ds.name : dataSourceId}」在5分钟内导入${recentTotal}条记录，超过正常均值(${avgPerWindow.toFixed(1)}条/5分钟)的${SPIKE_MULTIPLIER}倍`,
      dataSourceId,
      dataSourceName: ds ? ds.name : null,
      metric: {
        recentCount: recentTotal,
        avgPerWindow: parseFloat(avgPerWindow.toFixed(1)),
        multiplier: parseFloat((recentTotal / avgPerWindow).toFixed(2)),
        windowMinutes: 5
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

  const totalCount = batch.totalRecords;
  if (totalCount === 0) return [];

  const discrepancies = await Discrepancy.findAll({ where: { batchId } });
  const alerts = [];

  const byType = {};
  for (const d of discrepancies) {
    byType[d.type] = (byType[d.type] || 0) + 1;
  }

  const typeLabels = {
    unilateral: '单边挂账',
    amount_mismatch: '金额不符',
    time_offset: '时间偏移'
  };

  for (const [type, count] of Object.entries(byType)) {
    const ratio = count / totalCount;
    const threshold = DISCREPANCY_RATIO_THRESHOLDS[type] || 0.15;

    if (ratio > threshold) {
      const severity = ratio > threshold * 2 ? 'critical' : 'warning';
      const alert = await AlertEvent.create({
        type: 'discrepancy_ratio',
        severity,
        title: '差异占比超限告警',
        message: `批次「${batch.batchNo}」${typeLabels[type] || type}差异占比${(ratio * 100).toFixed(1)}%，超过阈值${(threshold * 100).toFixed(0)}%（${count}条/${totalCount}条）`,
        batchId,
        batchNo: batch.batchNo,
        metric: {
          discrepancyType: type,
          discrepancyCount: count,
          totalRecords: totalCount,
          ratio: parseFloat(ratio.toFixed(4)),
          threshold,
          thresholdPercent: parseFloat((threshold * 100).toFixed(0))
        }
      });
      broadcastAlert(alert);
      alerts.push(alert);
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
    const totalRecords = batch.totalRecords || 0;

    const byType = {};
    for (const d of discrepancies) {
      byType[d.type] = (byType[d.type] || 0) + 1;
    }

    const ratios = {};
    for (const [type, count] of Object.entries(byType)) {
      ratios[type] = totalRecords > 0 ? count / totalRecords : 0;
    }

    let health = 'green';
    for (const [type, ratio] of Object.entries(ratios)) {
      const threshold = DISCREPANCY_RATIO_THRESHOLDS[type] || 0.15;
      if (ratio > threshold * 2) {
        health = 'red';
        break;
      }
      if (ratio > threshold) {
        health = 'yellow';
      }
    }

    if (totalDisc === 0 && totalRecords > 0) {
      health = 'green';
    }

    result.push({
      batchId: batch.id,
      batchNo: batch.batchNo,
      totalRecords,
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
  DISCREPANCY_RATIO_THRESHOLDS
};
