const {
  BacktestPlan,
  BacktestExecution,
  ReconciliationBatch,
  Discrepancy,
  ArbitrationTicket
} = require('../models');
const sandboxService = require('./sandboxService');
const { Op } = require('sequelize');

let wsBroadcast = null;
let executionQueue = [];
let isProcessing = false;
let started = false;

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

function broadcastBacktestUpdate(plan, execution = null) {
  if (wsBroadcast) {
    wsBroadcast({
      type: 'backtest',
      data: {
        planId: plan.id,
        name: plan.name,
        status: plan.status,
        totalBatches: plan.totalBatches,
        completedBatches: plan.completedBatches,
        failedBatches: plan.failedBatches,
        currentBatchIndex: plan.currentBatchIndex,
        execution: execution ? {
          executionIndex: execution.executionIndex,
          batchId: execution.batchId,
          batchNo: execution.batchNo,
          status: execution.status
        } : null
      }
    });
  }
}

async function createBacktestPlan(options = {}) {
  const { name, description, batchIds, configSnapshot, arbitrationRulesSnapshot, alertThresholdsSnapshot, createdBy } = options;

  if (!name) throw new Error('回测计划名称不能为空');
  if (!batchIds || !Array.isArray(batchIds) || batchIds.length === 0) {
    throw new Error('必须指定至少一个批次ID');
  }
  if (!configSnapshot) {
    throw new Error('必须提供参数快照 configSnapshot');
  }

  const validBatches = [];
  for (const batchId of batchIds) {
    const batch = await ReconciliationBatch.findByPk(batchId);
    if (!batch) {
      throw new Error(`批次 ${batchId} 不存在`);
    }
    if (batch.status !== 'completed') {
      throw new Error(`批次 ${batch.batchNo} 未完成对账，不能用于回测`);
    }
    validBatches.push(batch);
  }

  const plan = await BacktestPlan.create({
    name,
    description: description || null,
    status: 'pending',
    batchIds,
    configSnapshot,
    arbitrationRulesSnapshot: arbitrationRulesSnapshot || null,
    alertThresholdsSnapshot: alertThresholdsSnapshot || null,
    totalBatches: batchIds.length,
    completedBatches: 0,
    failedBatches: 0,
    currentBatchIndex: 0,
    createdBy: createdBy || null
  });

  for (let i = 0; i < batchIds.length; i++) {
    const batch = validBatches[i];
    await BacktestExecution.create({
      backtestPlanId: plan.id,
      batchId: batchIds[i],
      batchNo: batch.batchNo,
      executionIndex: i,
      status: 'pending'
    });
  }

  return plan;
}

async function getBacktestPlan(planId) {
  const plan = await BacktestPlan.findByPk(planId, {
    include: [{ association: 'executions', order: [['executionIndex', 'ASC']] }]
  });
  if (!plan) throw new Error('回测计划不存在');
  return plan;
}

async function listBacktestPlans(filters = {}) {
  const where = {};
  if (filters.status) where.status = filters.status;

  const { count, rows } = await BacktestPlan.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(filters.limit) || 50, 100),
    offset: parseInt(filters.offset) || 0
  });

  return { total: count, data: rows };
}

async function cancelBacktestPlan(planId) {
  const plan = await BacktestPlan.findByPk(planId);
  if (!plan) throw new Error('回测计划不存在');
  if (plan.status === 'completed' || plan.status === 'failed' || plan.status === 'cancelled') {
    throw new Error(`回测计划状态为 ${plan.status}，不能取消`);
  }

  await plan.update({ status: 'cancelled', endTime: new Date() });
  broadcastBacktestUpdate(plan);
  return plan;
}

async function triggerBacktestPlan(planId) {
  const plan = await BacktestPlan.findByPk(planId);
  if (!plan) throw new Error('回测计划不存在');
  if (plan.status === 'running') throw new Error('回测计划已在执行中');
  if (plan.status === 'completed') throw new Error('回测计划已完成');
  if (plan.status === 'cancelled') throw new Error('回测计划已取消');

  executionQueue.push({ planId });
  processQueue();
  return plan;
}

async function processQueue() {
  if (isProcessing || executionQueue.length === 0) return;
  isProcessing = true;

  while (executionQueue.length > 0) {
    const { planId } = executionQueue.shift();
    try {
      await executeBacktestPlan(planId);
    } catch (err) {
      console.error(`执行回测计划失败 ${planId}:`, err.message);
    }
  }

  isProcessing = false;
}

async function getBaselineMetrics(batchId) {
  const batch = await ReconciliationBatch.findByPk(batchId);
  if (!batch) return null;

  const discrepancies = await Discrepancy.findAll({ where: { batchId } });
  const tickets = await ArbitrationTicket.findAll({ where: { batchId } });

  const byType = {};
  for (const d of discrepancies) {
    byType[d.type] = (byType[d.type] || 0) + 1;
  }

  const byTicketStatus = {};
  for (const t of tickets) {
    byTicketStatus[t.status] = (byTicketStatus[t.status] || 0) + 1;
  }

  const uniqueTx = batch.uniqueTransactionCount || (batch.matchedCount + batch.discrepancyCount);

  return {
    batchNo: batch.batchNo,
    matchedCount: batch.matchedCount,
    discrepancyCount: batch.discrepancyCount,
    uniqueTransactionCount: uniqueTx,
    matchRate: uniqueTx > 0 ? batch.matchedCount / uniqueTx : 0,
    discrepancyByType: byType,
    ticketsByStatus: byTicketStatus
  };
}

async function executeBacktestPlan(planId) {
  const plan = await BacktestPlan.findByPk(planId);
  if (!plan) return;
  if (plan.status === 'completed' || plan.status === 'cancelled') return;

  await plan.update({ status: 'running', startTime: new Date(), errorMessage: null });
  broadcastBacktestUpdate(plan);

  const executions = await BacktestExecution.findAll({
    where: { backtestPlanId: planId },
    order: [['executionIndex', 'ASC']]
  });

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < executions.length; i++) {
    const latestPlan = await BacktestPlan.findByPk(planId);
    if (latestPlan.status === 'cancelled') break;

    const execution = executions[i];
    await plan.update({ currentBatchIndex: i });
    await execution.update({ status: 'running', startTime: new Date() });
    broadcastBacktestUpdate(plan, execution);

    try {
      const baselineMetrics = await getBaselineMetrics(execution.batchId);
      await execution.update({ baselineMetrics });

      const sandbox = await sandboxService.createSandbox({
        baseBatchId: execution.batchId,
        name: `回测-${plan.name}-${execution.executionIndex}`,
        config: plan.configSnapshot,
        arbitrationRules: plan.arbitrationRulesSnapshot,
        alertThresholds: plan.alertThresholdsSnapshot,
        ttlHours: 48,
        backtestPlanId: planId,
        backtestExecutionIndex: execution.executionIndex
      });

      await execution.update({ sandboxId: sandbox.id });

      await sandboxService.runSandboxReconciliation(sandbox.id);

      const diffAnalysis = await sandboxService.compareSandboxWithBaseline(sandbox.id);
      await execution.update({ diffAnalysis });

      const refreshedSandbox = await sandboxService.getSandbox(sandbox.id);
      const sandboxMetrics = {
        matchedCount: refreshedSandbox.matchedCount,
        discrepancyCount: refreshedSandbox.discrepancyCount,
        uniqueTransactionCount: refreshedSandbox.uniqueTransactionCount,
        matchRate: refreshedSandbox.uniqueTransactionCount > 0
          ? refreshedSandbox.matchedCount / refreshedSandbox.uniqueTransactionCount
          : 0
      };
      await execution.update({ sandboxMetrics, status: 'completed', endTime: new Date() });

      completed++;
      await plan.update({ completedBatches: completed, failedBatches: failed });
      broadcastBacktestUpdate(plan, execution);
    } catch (err) {
      failed++;
      await execution.update({ status: 'failed', errorMessage: err.message, endTime: new Date() });
      await plan.update({ completedBatches: completed, failedBatches: failed });
      broadcastBacktestUpdate(plan, execution);
      console.error(`回测执行失败 (plan=${planId}, batch=${execution.batchId}):`, err.message);
    }
  }

  const finalPlan = await BacktestPlan.findByPk(planId);
  if (finalPlan.status !== 'cancelled') {
    const summary = await generateBacktestSummary(planId);
    await finalPlan.update({
      status: failed > 0 && completed === 0 ? 'failed' : 'completed',
      summaryReport: summary,
      endTime: new Date()
    });
    broadcastBacktestUpdate(finalPlan);
  }
}

async function generateBacktestSummary(planId) {
  const plan = await BacktestPlan.findByPk(planId);
  if (!plan) return null;

  const executions = await BacktestExecution.findAll({
    where: { backtestPlanId: planId, status: 'completed' },
    order: [['executionIndex', 'ASC']]
  });

  if (executions.length === 0) {
    return { error: '没有成功完成的执行' };
  }

  const batchResults = [];
  let totalMatchedBaseline = 0;
  let totalMatchedSandbox = 0;
  let totalDiscBaseline = 0;
  let totalDiscSandbox = 0;
  let totalNew = 0;
  let totalDisappeared = 0;
  let totalChanged = 0;
  let improvedCount = 0;
  let worsenedCount = 0;
  let unchangedCount = 0;

  for (const exec of executions) {
    const bm = exec.baselineMetrics || {};
    const sm = exec.sandboxMetrics || {};
    const da = exec.diffAnalysis?.summary || {};

    const baselineMatchRate = bm.matchRate || 0;
    const sandboxMatchRate = sm.matchRate || 0;
    const matchRateChange = sandboxMatchRate - baselineMatchRate;
    const discChange = (sm.discrepancyCount || 0) - (bm.discrepancyCount || 0);

    let trend = 'unchanged';
    if (matchRateChange > 0.001 || discChange < 0) {
      trend = 'improved';
      improvedCount++;
    } else if (matchRateChange < -0.001 || discChange > 0) {
      trend = 'worsened';
      worsenedCount++;
    } else {
      unchangedCount++;
    }

    totalMatchedBaseline += bm.matchedCount || 0;
    totalMatchedSandbox += sm.matchedCount || 0;
    totalDiscBaseline += bm.discrepancyCount || 0;
    totalDiscSandbox += sm.discrepancyCount || 0;
    totalNew += da.newDiscrepancies?.count || 0;
    totalDisappeared += da.disappearedDiscrepancies?.count || 0;
    totalChanged += da.dispositionChanges?.count || 0;

    batchResults.push({
      executionIndex: exec.executionIndex,
      batchId: exec.batchId,
      batchNo: exec.batchNo,
      baseline: {
        matchedCount: bm.matchedCount,
        discrepancyCount: bm.discrepancyCount,
        matchRate: parseFloat((baselineMatchRate * 100).toFixed(2))
      },
      sandbox: {
        matchedCount: sm.matchedCount,
        discrepancyCount: sm.discrepancyCount,
        matchRate: parseFloat((sandboxMatchRate * 100).toFixed(2))
      },
      changes: {
        matchRateChange: parseFloat((matchRateChange * 100).toFixed(2)),
        discrepancyChange: discChange,
        newDiscrepancies: da.newDiscrepancies?.count || 0,
        disappearedDiscrepancies: da.disappearedDiscrepancies?.count || 0,
        dispositionChanges: da.dispositionChanges?.count || 0
      },
      trend
    });
  }

  const totalUnique = totalMatchedBaseline + totalDiscBaseline;
  const avgBaselineMatchRate = totalUnique > 0 ? totalMatchedBaseline / totalUnique : 0;
  const totalUniqueSandbox = totalMatchedSandbox + totalDiscSandbox;
  const avgSandboxMatchRate = totalUniqueSandbox > 0 ? totalMatchedSandbox / totalUniqueSandbox : 0;

  return {
    planId,
    planName: plan.name,
    totalBatches: plan.totalBatches,
    completedBatches: plan.completedBatches,
    failedBatches: plan.failedBatches,
    overall: {
      baselineTotalMatched: totalMatchedBaseline,
      baselineTotalDiscrepancies: totalDiscBaseline,
      baselineAvgMatchRate: parseFloat((avgBaselineMatchRate * 100).toFixed(2)),
      sandboxTotalMatched: totalMatchedSandbox,
      sandboxTotalDiscrepancies: totalDiscSandbox,
      sandboxAvgMatchRate: parseFloat((avgSandboxMatchRate * 100).toFixed(2)),
      matchRateChange: parseFloat(((avgSandboxMatchRate - avgBaselineMatchRate) * 100).toFixed(2)),
      discrepancyChange: totalDiscSandbox - totalDiscBaseline,
      totalNewDiscrepancies: totalNew,
      totalDisappearedDiscrepancies: totalDisappeared,
      totalDispositionChanges: totalChanged
    },
    trendSummary: {
      improved: improvedCount,
      worsened: worsenedCount,
      unchanged: unchangedCount
    },
    batchResults
  };
}

async function getBacktestSummary(planId) {
  const plan = await BacktestPlan.findByPk(planId);
  if (!plan) throw new Error('回测计划不存在');
  if (plan.status !== 'completed' && plan.status !== 'running') {
    throw new Error('回测计划尚未完成');
  }
  if (plan.summaryReport) return plan.summaryReport;
  return generateBacktestSummary(planId);
}

async function getBacktestExecutions(planId, filters = {}) {
  const where = { backtestPlanId: planId };
  if (filters.status) where.status = filters.status;

  const { count, rows } = await BacktestExecution.findAndCountAll({
    where,
    order: [['executionIndex', 'ASC']],
    limit: Math.min(parseInt(filters.limit) || 100, 500),
    offset: parseInt(filters.offset) || 0
  });
  return { total: count, data: rows };
}

async function getBacktestExecutionDetail(executionId) {
  const execution = await BacktestExecution.findByPk(executionId);
  if (!execution) throw new Error('回测执行记录不存在');
  return execution;
}

function start() {
  if (started) return;
  started = true;
}

function stop() {
  started = false;
}

module.exports = {
  setWsBroadcast,
  start,
  stop,
  createBacktestPlan,
  getBacktestPlan,
  listBacktestPlans,
  cancelBacktestPlan,
  triggerBacktestPlan,
  getBacktestSummary,
  getBacktestExecutions,
  getBacktestExecutionDetail
};
