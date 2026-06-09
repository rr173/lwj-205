const { Op, fn, col, literal } = require('sequelize');
const {
  ReconciliationBatch,
  Discrepancy,
  AlertEvent,
  DataSource
} = require('../models');

let wsBroadcast = null;

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

function broadcastMessage(message) {
  if (wsBroadcast) {
    wsBroadcast(message);
  }
}

const DISC_TYPES = ['unilateral', 'amount_mismatch', 'time_offset'];
const TYPE_LABELS = {
  unilateral: '单边挂账',
  amount_mismatch: '金额不符',
  time_offset: '时间偏移'
};
const CONSECUTIVE_RISE_THRESHOLD = 3;
const HIGH_FREQUENCY_RATIO = 0.3;
const REPEAT_DIFF_SEVERITY_THRESHOLD = 3;

async function getDiscrepancyTrend(startDate, endDate, dataSourceId) {
  const batchWhere = {
    status: 'completed',
    createdAt: { [Op.gte]: new Date(startDate), [Op.lte]: new Date(endDate) }
  };

  if (dataSourceId) {
    batchWhere.config = { dataSourceIds: { [Op.contains]: [dataSourceId] } };
  }

  const batches = await ReconciliationBatch.findAll({
    where: batchWhere,
    order: [['createdAt', 'ASC']]
  });

  const dailyBuckets = {};

  for (const batch of batches) {
    const dayKey = new Date(batch.createdAt).toISOString().slice(0, 10);

    if (!dailyBuckets[dayKey]) {
      dailyBuckets[dayKey] = { date: dayKey, batches: [], byType: {} };
      for (const t of DISC_TYPES) {
        dailyBuckets[dayKey].byType[t] = 0;
      }
    }

    const discrepancies = await Discrepancy.findAll({
      where: { batchId: batch.id }
    });

    for (const d of discrepancies) {
      dailyBuckets[dayKey].byType[d.type] = (dailyBuckets[dayKey].byType[d.type] || 0) + 1;
    }

    dailyBuckets[dayKey].batches.push({
      batchId: batch.id,
      batchNo: batch.batchNo,
      createdAt: batch.createdAt,
      totalCount: discrepancies.length
    });
  }

  const trendData = Object.values(dailyBuckets).sort((a, b) => a.date.localeCompare(b.date));

  const lineData = [];
  for (const day of trendData) {
    const point = { date: day.date };
    for (const t of DISC_TYPES) {
      point[t] = day.byType[t] || 0;
    }
    lineData.push(point);
  }

  const deteriorationAlerts = detectDeterioration(batches, dataSourceId);

  return {
    startDate,
    endDate,
    dataSourceId: dataSourceId || null,
    trend: lineData,
    dailyBatches: trendData.map(d => ({
      date: d.date,
      batchCount: d.batches.length,
      batches: d.batches
    })),
    deteriorationAlerts
  };
}

async function detectDeterioration(batches, dataSourceId) {
  const alerts = [];
  const batchDiscCounts = {};

  for (const batch of batches) {
    const discrepancies = await Discrepancy.findAll({
      where: { batchId: batch.id }
    });
    batchDiscCounts[batch.id] = {};
    for (const t of DISC_TYPES) {
      batchDiscCounts[batch.id][t] = 0;
    }
    for (const d of discrepancies) {
      batchDiscCounts[batch.id][d.type] = (batchDiscCounts[batch.id][d.type] || 0) + 1;
    }
  }

  const sortedBatches = [...batches].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  for (const discType of DISC_TYPES) {
    let consecutiveRiseCount = 0;
    let riseStartIdx = -1;

    for (let i = 1; i < sortedBatches.length; i++) {
      const prevCount = batchDiscCounts[sortedBatches[i - 1].id][discType];
      const currCount = batchDiscCounts[sortedBatches[i].id][discType];

      if (currCount > prevCount) {
        if (consecutiveRiseCount === 0) {
          riseStartIdx = i - 1;
        }
        consecutiveRiseCount++;
      } else {
        consecutiveRiseCount = 0;
        riseStartIdx = -1;
      }

      if (consecutiveRiseCount >= CONSECUTIVE_RISE_THRESHOLD) {
        const startBatch = sortedBatches[riseStartIdx];
        const endBatch = sortedBatches[i];
        const startCount = batchDiscCounts[startBatch.id][discType];
        const endCount = batchDiscCounts[endBatch.id][discType];

        const alert = await AlertEvent.create({
          type: 'trend_deterioration',
          severity: 'critical',
          title: '差异趋势恶化告警',
          message: `${TYPE_LABELS[discType]}类差异连续${consecutiveRiseCount + 1}个批次持续上升，从${startCount}条升至${endCount}条（批次 ${startBatch.batchNo} → ${endBatch.batchNo}）`,
          dataSourceId: dataSourceId || null,
          metric: {
            discrepancyType: discType,
            consecutiveRiseBatches: consecutiveRiseCount + 1,
            startBatchNo: startBatch.batchNo,
            endBatchNo: endBatch.batchNo,
            startCount,
            endCount,
            growthRate: startCount > 0 ? parseFloat(((endCount - startCount) / startCount).toFixed(4)) : null
          }
        });

        broadcastMessage({
          type: 'trend_deterioration',
          data: alert.toJSON ? alert.toJSON() : alert
        });

        alerts.push({
          discrepancyType: discType,
          status: '恶化中',
          consecutiveRiseBatches: consecutiveRiseCount + 1,
          startBatchNo: startBatch.batchNo,
          endBatchNo: endBatch.batchNo,
          startCount,
          endCount,
          alertId: alert.id
        });

        break;
      }
    }
  }

  return alerts;
}

async function tagDiscrepancyRootCause(discrepancyId, rootCause) {
  const discrepancy = await Discrepancy.findByPk(discrepancyId);
  if (!discrepancy) throw new Error('差异记录不存在');

  await discrepancy.update({ rootCause });
  return discrepancy;
}

async function batchTagRootCause(discrepancyIds, rootCause) {
  if (!Array.isArray(discrepancyIds) || discrepancyIds.length === 0) {
    throw new Error('discrepancyIds 必须为非空数组');
  }
  if (!rootCause || typeof rootCause !== 'string') {
    throw new Error('rootCause 必须为非空字符串');
  }

  const [updatedCount] = await Discrepancy.update(
    { rootCause },
    { where: { id: { [Op.in]: discrepancyIds } } }
  );

  return { updatedCount, rootCause, discrepancyIds };
}

async function getRootCauseAggregation(startDate, endDate, dataSourceId) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const batchWhere = {
    status: 'completed',
    createdAt: { [Op.gte]: start, [Op.lte]: end }
  };

  if (dataSourceId) {
    batchWhere.config = { dataSourceIds: { [Op.contains]: [dataSourceId] } };
  }

  const batches = await ReconciliationBatch.findAll({
    where: batchWhere,
    attributes: ['id']
  });

  const batchIds = batches.map(b => b.id);

  if (batchIds.length === 0) {
    return {
      startDate,
      endDate,
      dataSourceId: dataSourceId || null,
      totalDiscrepancies: 0,
      rootCauses: [],
      highFrequencyCauses: []
    };
  }

  const discrepancies = await Discrepancy.findAll({
    where: {
      batchId: { [Op.in]: batchIds },
      rootCause: { [Op.ne]: null }
    },
    attributes: ['rootCause']
  });

  const totalCount = discrepancies.length;

  const causeMap = {};
  for (const d of discrepancies) {
    const cause = d.rootCause || '未分类';
    if (!causeMap[cause]) {
      causeMap[cause] = { rootCause: cause, count: 0 };
    }
    causeMap[cause].count++;
  }

  const rootCauses = Object.values(causeMap)
    .sort((a, b) => b.count - a.count)
    .map(item => ({
      ...item,
      percentage: totalCount > 0 ? parseFloat((item.count / totalCount * 100).toFixed(2)) : 0
    }));

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentBatches = await ReconciliationBatch.findAll({
    where: {
      status: 'completed',
      createdAt: { [Op.gte]: sevenDaysAgo }
    },
    attributes: ['id']
  });

  const recentBatchIds = recentBatches.map(b => b.id);

  let highFrequencyCauses = [];

  if (recentBatchIds.length > 0) {
    const recentDiscrepancies = await Discrepancy.findAll({
      where: {
        batchId: { [Op.in]: recentBatchIds },
        rootCause: { [Op.ne]: null }
      },
      attributes: ['rootCause']
    });

    const recentTotal = recentDiscrepancies.length;

    if (recentTotal > 0) {
      const recentCauseMap = {};
      for (const d of recentDiscrepancies) {
        const cause = d.rootCause || '未分类';
        if (!recentCauseMap[cause]) {
          recentCauseMap[cause] = { rootCause: cause, count: 0 };
        }
        recentCauseMap[cause].count++;
      }

      highFrequencyCauses = Object.values(recentCauseMap)
        .filter(item => (item.count / recentTotal) > HIGH_FREQUENCY_RATIO)
        .map(item => ({
          ...item,
          percentage: parseFloat((item.count / recentTotal * 100).toFixed(2)),
          isHighFrequency: true
        }))
        .sort((a, b) => b.count - a.count);
    }
  }

  return {
    startDate,
    endDate,
    dataSourceId: dataSourceId || null,
    totalDiscrepancies: totalCount,
    rootCauses,
    highFrequencyCauses
  };
}

async function getTransactionDiscrepancyChain(transactionId) {
  if (!transactionId) throw new Error('transactionId 不能为空');

  const discrepancies = await Discrepancy.findAll({
    where: { transactionId },
    include: [{
      model: ReconciliationBatch,
      as: 'batch',
      attributes: ['id', 'batchNo', 'createdAt', 'status']
    }],
    order: [['createdAt', 'ASC']]
  });

  const chain = discrepancies.map(d => ({
    id: d.id,
    batchId: d.batchId,
    batchNo: d.batch ? d.batch.batchNo : null,
    batchCreatedAt: d.batch ? d.batch.createdAt : null,
    type: d.type,
    description: d.description,
    rootCause: d.rootCause,
    severity: d.severity,
    status: d.status,
    amountDiff: d.amountDiff ? parseFloat(d.amountDiff) : null,
    timeDiffSeconds: d.timeDiffSeconds,
    createdAt: d.createdAt
  }));

  const consecutiveCount = detectConsecutiveDiscrepancies(discrepancies);

  return {
    transactionId,
    totalOccurrences: discrepancies.length,
    consecutiveOccurrences: consecutiveCount,
    isRepeatedlyFailing: consecutiveCount >= REPEAT_DIFF_SEVERITY_THRESHOLD,
    severity: consecutiveCount >= REPEAT_DIFF_SEVERITY_THRESHOLD ? 'critical' : 'normal',
    chain
  };
}

function detectConsecutiveDiscrepancies(discrepancies) {
  if (discrepancies.length === 0) return 0;

  const sorted = [...discrepancies].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );

  let maxConsecutive = 1;
  let currentConsecutive = 1;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].status !== 'resolved' && sorted[i - 1].status !== 'resolved') {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else {
      currentConsecutive = 1;
    }
  }

  return maxConsecutive;
}

async function checkAndUpgradeRecurringDiscrepancies(batchId) {
  const batchDiscrepancies = await Discrepancy.findAll({
    where: { batchId, severity: 'normal' }
  });

  const upgraded = [];

  for (const disc of batchDiscrepancies) {
    if (!disc.transactionId) continue;

    const allDiscForTx = await Discrepancy.findAll({
      where: { transactionId: disc.transactionId },
      order: [['createdAt', 'ASC']]
    });

    const consecutiveCount = detectConsecutiveDiscrepancies(allDiscForTx);

    if (consecutiveCount >= REPEAT_DIFF_SEVERITY_THRESHOLD && disc.severity !== 'critical') {
      await disc.update({ severity: 'critical' });
      upgraded.push({
        discrepancyId: disc.id,
        transactionId: disc.transactionId,
        consecutiveOccurrences: consecutiveCount
      });
    }
  }

  return upgraded;
}

async function runPostReconciliationAnalysis(batchId) {
  try {
    const batch = await ReconciliationBatch.findByPk(batchId);
    if (!batch || batch.status !== 'completed') return;

    const dataSourceIds = batch.config?.dataSourceIds || [];
    const dataSourceId = dataSourceIds.length === 1 ? dataSourceIds[0] : null;

    const recentBatches = await ReconciliationBatch.findAll({
      where: {
        status: 'completed',
        createdAt: { [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      },
      order: [['createdAt', 'ASC']]
    });

    if (recentBatches.length >= CONSECUTIVE_RISE_THRESHOLD + 1) {
      await detectDeterioration(recentBatches, dataSourceId);
    }

    await checkAndUpgradeRecurringDiscrepancies(batchId);
  } catch (err) {
    console.error('对账后趋势分析失败:', err.message);
  }
}

module.exports = {
  setWsBroadcast,
  getDiscrepancyTrend,
  tagDiscrepancyRootCause,
  batchTagRootCause,
  getRootCauseAggregation,
  getTransactionDiscrepancyChain,
  checkAndUpgradeRecurringDiscrepancies,
  runPostReconciliationAnalysis
};
