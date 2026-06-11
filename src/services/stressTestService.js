const { v4: uuidv4 } = require('uuid');
const {
  StressTestPlan,
  StressTestBatch,
  StressTestMetric,
  Sandbox,
  SandboxTransaction,
  SandboxDiscrepancy,
  SandboxArbitrationTicket,
  DataSource,
  ArbitrationRule
} = require('../models');
const { Op } = require('sequelize');
const sandboxService = require('./sandboxService');
const { getCurrentTenantId } = require('../utils/tenantContext');

let executionQueue = [];
let isProcessing = false;
let activePlanId = null;
let cancelledPlans = new Set();
let started = false;
let wsBroadcast = null;

const PHASES = {
  DATA_LOAD: 'data_load',
  EXACT_MATCH: 'exact_match',
  FUZZY_MATCH: 'fuzzy_match',
  DISCREPANCY_GENERATION: 'discrepancy_generation',
  ARBITRATION: 'arbitration',
  ADJUSTMENT_GENERATION: 'adjustment_generation',
  END_TO_END: 'end_to_end'
};

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

function broadcastStressTestUpdate(plan, batch = null) {
  if (wsBroadcast) {
    wsBroadcast({
      type: 'stress_test',
      data: {
        planId: plan.id,
        name: plan.name,
        status: plan.status,
        concurrentBatches: plan.concurrentBatches,
        totalRecords: plan.totalRecords,
        currentBatch: batch ? {
          batchIndex: batch.batchIndex,
          status: batch.status,
          recordCount: batch.recordCount
        } : null
      }
    });
  }
}

function getMemoryUsage() {
  if (process.memoryUsage) {
    return process.memoryUsage().heapUsed;
  }
  return 0;
}

class MetricCollector {
  constructor(planId, batchId, batchIndex, tenantId) {
    this.planId = planId;
    this.batchId = batchId;
    this.batchIndex = batchIndex;
    this.tenantId = tenantId;
    this.metrics = {};
    this.dbQueryCount = 0;
    this.maxQueryTimeMs = 0;
  }

  startPhase(phase) {
    this.metrics[phase] = {
      startTime: new Date(),
      memoryStart: getMemoryUsage(),
      dbQueryStart: this.dbQueryCount
    };
  }

  endPhase(phase, recordsProcessed = 0) {
    if (!this.metrics[phase]) return;
    const m = this.metrics[phase];
    const endTime = new Date();
    const durationMs = endTime - m.startTime;
    const memoryPeak = getMemoryUsage();

    this.metrics[phase] = {
      ...m,
      endTime,
      durationMs,
      memoryPeak,
      recordsProcessed,
      dbQueryCount: this.dbQueryCount - m.dbQueryStart
    };
  }

  recordQuery(durationMs) {
    this.dbQueryCount++;
    if (durationMs > this.maxQueryTimeMs) {
      this.maxQueryTimeMs = durationMs;
    }
  }

  async save() {
    const metricRecords = [];
    for (const [phase, data] of Object.entries(this.metrics)) {
      if (data.durationMs !== undefined) {
        metricRecords.push({
          id: uuidv4(),
          stressTestPlanId: this.planId,
          stressTestBatchId: this.batchId,
          batchIndex: this.batchIndex,
          phase,
          durationMs: data.durationMs,
          startTime: data.startTime,
          endTime: data.endTime,
          memoryUsageBytes: data.memoryPeak,
          dbQueryCount: data.dbQueryCount || 0,
          maxQueryTimeMs: phase === PHASES.END_TO_END ? this.maxQueryTimeMs : 0,
          recordsProcessed: data.recordsProcessed || 0,
          tenantId: this.tenantId
        });
      }
    }
    await StressTestMetric.bulkCreate(metricRecords);
  }
}

function generateTransactionId(index) {
  return `TX-${String(index).padStart(10, '0')}`;
}

function randomAmount(base = 1000) {
  return (base + Math.random() * 9000).toFixed(2);
}

function randomTimestamp(baseDate, rangeHours = 24) {
  const base = new Date(baseDate).getTime();
  const offset = Math.random() * rangeHours * 3600 * 1000;
  return new Date(base + offset);
}

function weightedRandomType(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let random = Math.random() * total;
  for (const [type, weight] of Object.entries(weights)) {
    random -= weight;
    if (random <= 0) return type;
  }
  return Object.keys(weights)[0];
}

async function generateMockTransactions(plan, batchIndex) {
  const {
    dataSourceCount,
    recordsPerSource,
    discrepancyRatio,
    discrepancyTypeWeights
  } = plan;

  const tenantId = plan.tenantId;
  const dataSourceIds = [];
  for (let i = 0; i < dataSourceCount; i++) {
    dataSourceIds.push(`ds-stress-${plan.id}-${i}`);
  }

  const baseDate = new Date();
  const transactions = [];
  const totalTxCount = recordsPerSource;
  const discrepancyCount = Math.floor(totalTxCount * discrepancyRatio);

  const discrepancyTxIds = new Set();
  while (discrepancyTxIds.size < discrepancyCount) {
    discrepancyTxIds.add(Math.floor(Math.random() * totalTxCount));
  }

  for (let i = 0; i < totalTxCount; i++) {
    const txId = generateTransactionId(i);
    const baseAmount = parseFloat(randomAmount());
    const baseTime = randomTimestamp(baseDate);
    const isDiscrepancy = discrepancyTxIds.has(i);
    const discType = isDiscrepancy ? weightedRandomType(discrepancyTypeWeights) : null;

    for (let dsIdx = 0; dsIdx < dataSourceCount; dsIdx++) {
      let amount = baseAmount;
      let timestamp = baseTime;
      let present = true;

      if (isDiscrepancy) {
        if (discType === 'unilateral') {
          if (dsIdx === dataSourceCount - 1) {
            present = false;
          }
        } else if (discType === 'amount') {
          if (dsIdx === dataSourceCount - 1) {
            amount = baseAmount * (1 + (Math.random() * 0.1 - 0.05));
          }
        } else if (discType === 'time') {
          if (dsIdx === dataSourceCount - 1) {
            timestamp = new Date(baseTime.getTime() + (Math.random() * 600 + 300) * 1000);
          }
        }
      }

      if (present) {
        transactions.push({
          id: uuidv4(),
          sandboxId: null,
          dataSourceId: dataSourceIds[dsIdx],
          originalTransactionId: null,
          transactionId: txId,
          amount: amount.toFixed(2),
          currency: 'CNY',
          timestamp,
          counterparty: `商户${Math.floor(Math.random() * 100)}`,
          summary: `压测交易-${txId}`,
          tenantId,
          rawData: { stressTest: true, batchIndex, dsIndex: dsIdx }
        });
      }
    }
  }

  return { transactions, dataSourceIds, totalTxCount, discrepancyCount };
}

async function createStressSandbox(plan, batchIndex, collector) {
  const tenantId = plan.tenantId;
  const sandboxName = `压测沙盒-${plan.name}-${batchIndex}`;

  const sandbox = await Sandbox.create({
    name: sandboxName,
    baseBatchId: '00000000-0000-0000-0000-000000000000',
    baseBatchNo: 'STRESS-TEST',
    status: 'creating',
    config: {
      timeToleranceSeconds: 300,
      amountTolerance: 0.01,
      dataSourceIds: []
    },
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdBy: 'stress-test',
    tenantId
  });

  collector.startPhase(PHASES.DATA_LOAD);
  const { transactions, totalTxCount, discrepancyCount } = await generateMockTransactions(
    plan, batchIndex
  );

  for (const tx of transactions) {
    tx.sandboxId = sandbox.id;
  }

  const chunkSize = 1000;
  for (let i = 0; i < transactions.length; i += chunkSize) {
    if (cancelledPlans.has(plan.id)) {
      throw new Error('压测已取消');
    }
    await SandboxTransaction.bulkCreate(transactions.slice(i, i + chunkSize));
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  await sandbox.update({ status: 'ready' });
  collector.endPhase(PHASES.DATA_LOAD, transactions.length);

  return { sandbox, totalTxCount, discrepancyCount };
}

async function runStressReconciliation(sandbox, plan, batchIndex, collector) {
  const tenantId = plan.tenantId;

  try {
    await SandboxArbitrationTicket.destroy({ where: { sandboxId: sandbox.id } });
    await SandboxDiscrepancy.destroy({ where: { sandboxId: sandbox.id } });

    collector.startPhase(PHASES.EXACT_MATCH);
    const transactions = await SandboxTransaction.findAll({ where: { sandboxId: sandbox.id } });
    collector.endPhase(PHASES.EXACT_MATCH, transactions.length);

    collector.startPhase(PHASES.FUZZY_MATCH);

    const timeTolerance = sandbox.config?.timeToleranceSeconds ?? 300;
    const amountTolerance = sandbox.config?.amountTolerance ?? 0.01;

    const byTransactionId = {};
    for (const tx of transactions) {
      if (!byTransactionId[tx.transactionId]) {
        byTransactionId[tx.transactionId] = [];
      }
      byTransactionId[tx.transactionId].push(tx);
    }

    const dataSourceIds = [...new Set(transactions.map(t => t.dataSourceId))];
    const sourceIds = dataSourceIds;

    const discrepancies = [];
    let matchedCount = 0;

    for (const [txId, txList] of Object.entries(byTransactionId)) {
      if (cancelledPlans.has(plan.id)) {
        throw new Error('压测已取消');
      }

      const sourceMap = {};
      for (const tx of txList) {
        sourceMap[tx.dataSourceId] = tx;
      }

      const presentSources = Object.keys(sourceMap);
      const missingSources = sourceIds.filter(id => !presentSources.includes(id));

      if (missingSources.length > 0) {
        discrepancies.push({
          id: uuidv4(),
          sandboxId: sandbox.id,
          type: 'unilateral',
          transactionId: txId,
          description: `交易 ${txId} 在数据源 [${missingSources.join(', ')}] 中缺失`,
          sourceTransactions: txList.map(t => ({
            dataSourceId: t.dataSourceId,
            amount: parseFloat(t.amount),
            timestamp: t.timestamp
          })),
          missingInSources: missingSources,
          status: 'open'
        });
        continue;
      }

      const amounts = txList.map(t => parseFloat(t.amount));
      const maxAmount = Math.max(...amounts);
      const minAmount = Math.min(...amounts);
      const amountDiff = maxAmount - minAmount;

      if (amountDiff > amountTolerance) {
        discrepancies.push({
          id: uuidv4(),
          sandboxId: sandbox.id,
          type: 'amount_mismatch',
          transactionId: txId,
          description: `交易 ${txId} 金额不一致，差异: ${amountDiff}`,
          sourceTransactions: txList.map(t => ({
            dataSourceId: t.dataSourceId,
            amount: parseFloat(t.amount),
            timestamp: t.timestamp
          })),
          amountDiff,
          status: 'open'
        });
        continue;
      }

      const times = txList.map(t => new Date(t.timestamp).getTime());
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);
      const timeDiffSeconds = (maxTime - minTime) / 1000;

      if (timeDiffSeconds > timeTolerance) {
        discrepancies.push({
          id: uuidv4(),
          sandboxId: sandbox.id,
          type: 'time_offset',
          transactionId: txId,
          description: `交易 ${txId} 时间偏移超限，差异: ${timeDiffSeconds.toFixed(2)}秒`,
          sourceTransactions: txList.map(t => ({
            dataSourceId: t.dataSourceId,
            amount: parseFloat(t.amount),
            timestamp: t.timestamp
          })),
          timeDiffSeconds: Math.round(timeDiffSeconds),
          status: 'open'
        });
        continue;
      }

      matchedCount++;
    }

    collector.endPhase(PHASES.FUZZY_MATCH, Object.keys(byTransactionId).length);

    collector.startPhase(PHASES.DISCREPANCY_GENERATION);
    await SandboxDiscrepancy.bulkCreate(discrepancies);

    const tickets = [];
    for (const disc of discrepancies) {
      tickets.push({
        id: uuidv4(),
        sandboxId: sandbox.id,
        discrepancyId: disc.id,
        status: 'pending'
      });
    }
    await SandboxArbitrationTicket.bulkCreate(tickets);
    collector.endPhase(PHASES.DISCREPANCY_GENERATION, discrepancies.length);

    collector.startPhase(PHASES.ARBITRATION);
    await applyStressAutoArbitration(sandbox.id, tenantId, plan);
    collector.endPhase(PHASES.ARBITRATION, discrepancies.length);

    collector.startPhase(PHASES.ADJUSTMENT_GENERATION);
    await generateStressAdjustments(sandbox.id, tenantId);
    collector.endPhase(PHASES.ADJUSTMENT_GENERATION, Math.floor(discrepancies.length * 0.3));

    const uniqueCount = matchedCount + discrepancies.length;
    await sandbox.update({
      status: 'completed',
      matchedCount,
      discrepancyCount: discrepancies.length,
      uniqueTransactionCount: uniqueCount,
      endTime: new Date()
    });

    return { matchedCount, discrepancyCount: discrepancies.length, uniqueCount };
  } catch (err) {
    await sandbox.update({ status: 'failed', errorMessage: err.message, endTime: new Date() });
    throw err;
  }
}

async function applyStressAutoArbitration(sandboxId, tenantId, plan) {
  let rules;
  try {
    rules = await ArbitrationRule.findAll({
      where: { isActive: true, tenantId },
      order: [['priority', 'ASC']]
    });
  } catch (err) {
    rules = [];
  }

  if (rules.length === 0) {
    rules = [
      {
        id: 'default-1',
        ruleType: 'amount_tolerance',
        condition: { maxDifference: 0.01 },
        priority: 1
      }
    ];
  }

  const tickets = await SandboxArbitrationTicket.findAll({
    where: { sandboxId, status: 'pending' },
    include: [{ model: SandboxDiscrepancy, as: 'SandboxDiscrepancy' }]
  });

  for (const ticket of tickets) {
    if (cancelledPlans.has(plan.id)) {
      throw new Error('压测已取消');
    }
    const disc = ticket.SandboxDiscrepancy;
    if (!disc) continue;
    for (const rule of rules) {
      if (await applyStressRule(sandboxId, ticket, disc, rule)) {
        break;
      }
    }
  }
}

async function applyStressRule(sandboxId, ticket, discrepancy, rule) {
  const condition = rule.condition || {};

  if (rule.ruleType === 'amount_tolerance') {
    if (discrepancy.type !== 'amount_mismatch') return false;
    const maxDiff = condition.maxDifference || 0.01;
    const amountDiff = parseFloat(discrepancy.amountDiff);
    if (amountDiff <= maxDiff + 0.000001) {
      await ticket.update({
        status: 'ignored',
        resolutionType: 'ignore',
        resolvedBy: 'system',
        resolvedAt: new Date(),
        ruleApplied: rule.name || '默认金额容差规则'
      });
      await discrepancy.update({ status: 'ignored' });
      return true;
    }
  }

  return false;
}

async function generateStressAdjustments(sandboxId, tenantId) {
  const tickets = await SandboxArbitrationTicket.findAll({
    where: { sandboxId, status: 'auto_resolved', resolutionType: 'use_source' },
    include: [{ model: SandboxDiscrepancy, as: 'SandboxDiscrepancy' }]
  });

  return tickets.length;
}

async function executeStressBatch(plan, batchIndex) {
  const tenantId = plan.tenantId;
  const batch = await StressTestBatch.create({
    stressTestPlanId: plan.id,
    batchIndex,
    status: 'generating_data',
    startTime: new Date(),
    tenantId
  });

  const collector = new MetricCollector(plan.id, batch.id, batchIndex, tenantId);

  try {
    collector.startPhase(PHASES.END_TO_END);

    if (cancelledPlans.has(plan.id)) {
      throw new Error('压测已取消');
    }

    const { sandbox, totalTxCount } = await createStressSandbox(plan, batchIndex, collector);
    await batch.update({ sandboxId: sandbox.id, recordCount: totalTxCount, status: 'running' });

    const planLatest = await StressTestPlan.findByPk(plan.id);
    broadcastStressTestUpdate(planLatest, batch);

    if (cancelledPlans.has(plan.id)) {
      throw new Error('压测已取消');
    }

    const { matchedCount, discrepancyCount } = await runStressReconciliation(
      sandbox, plan, batchIndex, collector
    );

    collector.endPhase(PHASES.END_TO_END, totalTxCount);
    await collector.save();

    await batch.update({
      status: 'completed',
      matchedCount,
      discrepancyCount,
      endTime: new Date()
    });

    return { batch, matchedCount, discrepancyCount };
  } catch (err) {
    if (err.message === '压测已取消') {
      await batch.update({ status: 'cancelled', errorMessage: err.message, endTime: new Date() });
    } else {
      await batch.update({ status: 'failed', errorMessage: err.message, endTime: new Date() });
    }
    try {
      await collector.save();
    } catch (saveErr) {
      console.error('保存指标失败:', saveErr.message);
    }
    throw err;
  }
}

async function cleanUpSandboxes(planId) {
  const batches = await StressTestBatch.findAll({
    where: { stressTestPlanId: planId, sandboxId: { [Op.not]: null } }
  });

  for (const batch of batches) {
    try {
      if (batch.sandboxId) {
        await sandboxService.deleteSandboxInternal(batch.sandboxId, false);
      }
    } catch (err) {
      console.error(`清理沙盒失败 ${batch.sandboxId}:`, err.message);
    }
  }

  await StressTestPlan.update(
    { sandboxCleaned: true },
    { where: { id: planId } }
  );
}

function calculatePercentile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
}

async function generateCapacityReport(planId) {
  const plan = await StressTestPlan.findByPk(planId);
  if (!plan) return null;

  const batches = await StressTestBatch.findAll({
    where: { stressTestPlanId: planId, status: 'completed' },
    order: [['batchIndex', 'ASC']]
  });

  if (batches.length === 0) {
    return { error: '没有成功完成的批次' };
  }

  const metrics = await StressTestMetric.findAll({
    where: { stressTestPlanId: planId }
  });

  const phaseMetrics = {};
  for (const m of metrics) {
    if (!phaseMetrics[m.phase]) {
      phaseMetrics[m.phase] = [];
    }
    phaseMetrics[m.phase].push(parseFloat(m.durationMs));
  }

  const phaseStats = {};
  for (const [phase, durations] of Object.entries(phaseMetrics)) {
    const sorted = [...durations].sort((a, b) => a - b);
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    phaseStats[phase] = {
      count: durations.length,
      avgMs: Math.round(avg),
      p50Ms: Math.round(calculatePercentile(sorted, 50)),
      p90Ms: Math.round(calculatePercentile(sorted, 90)),
      p99Ms: Math.round(calculatePercentile(sorted, 99)),
      minMs: Math.round(sorted[0]),
      maxMs: Math.round(sorted[sorted.length - 1])
    };
  }

  const endToEndTimes = phaseMetrics[PHASES.END_TO_END] || [];
  const totalRecords = plan.recordsPerSource * plan.dataSourceCount;
  const avgEndToEndMs = endToEndTimes.length > 0
    ? endToEndTimes.reduce((a, b) => a + b, 0) / endToEndTimes.length
    : 0;

  const throughput = avgEndToEndMs > 0
    ? Math.round((totalRecords / (avgEndToEndMs / 1000)) * 100) / 100
    : 0;

  const maxSafeTimeMs = 5 * 60 * 1000;
  const maxSafeRecords = avgEndToEndMs > 0
    ? Math.floor((maxSafeTimeMs / avgEndToEndMs) * totalRecords)
    : 0;

  let bottleneckPhase = null;
  let bottleneckRatio = 0;
  const e2eAvg = phaseStats[PHASES.END_TO_END]?.avgMs || 1;
  for (const [phase, stats] of Object.entries(phaseStats)) {
    if (phase === PHASES.END_TO_END) continue;
    const ratio = stats.avgMs / e2eAvg;
    if (ratio > bottleneckRatio) {
      bottleneckRatio = ratio;
      bottleneckPhase = phase;
    }
  }

  const memoryMetrics = metrics.filter(m => m.memoryUsageBytes);
  const peakMemory = memoryMetrics.length > 0
    ? Math.max(...memoryMetrics.map(m => parseFloat(m.memoryUsageBytes)))
    : 0;

  const report = {
    planId: plan.id,
    planName: plan.name,
    generatedAt: new Date().toISOString(),
    config: {
      dataSourceCount: plan.dataSourceCount,
      recordsPerSource: plan.recordsPerSource,
      discrepancyRatio: plan.discrepancyRatio,
      discrepancyTypeWeights: plan.discrepancyTypeWeights,
      concurrentBatches: plan.concurrentBatches,
      totalRecordsPerBatch: totalRecords
    },
    executionSummary: {
      totalBatches: plan.concurrentBatches,
      completedBatches: batches.filter(b => b.status === 'completed').length,
      failedBatches: batches.filter(b => b.status === 'failed').length,
      cancelledBatches: batches.filter(b => b.status === 'cancelled').length
    },
    phasePerformance: phaseStats,
    throughput: {
      recordsPerSecond: throughput,
      recordsPerMinute: Math.round(throughput * 60)
    },
    resourceUsage: {
      peakMemoryBytes: peakMemory,
      peakMemoryMB: Math.round(peakMemory / (1024 * 1024) * 100) / 100
    },
    bottleneckAnalysis: {
      bottleneckPhase,
      bottleneckRatio: Math.round(bottleneckRatio * 10000) / 100,
      description: bottleneckPhase
        ? `${bottleneckPhase} 阶段耗时占比最高，约 ${Math.round(bottleneckRatio * 100)}%`
        : '无法确定瓶颈阶段'
    },
    capacityAssessment: {
      maxSafeRecordsPerBatch: maxSafeRecords,
      maxSafeRecordsPerBatchFormatted: maxSafeRecords.toLocaleString(),
      definition: '单批次端到端耗时不超过5分钟时的最大记录数',
      estimatedThroughputDaily: Math.round(throughput * 60 * 60 * 24)
    },
    recommendations: generateRecommendations(phaseStats, bottleneckPhase, throughput)
  };

  await plan.update({ capacityReport: report });
  return report;
}

function generateRecommendations(phaseStats, bottleneckPhase, throughput) {
  const recommendations = [];

  if (bottleneckPhase) {
    const phaseNames = {
      [PHASES.DATA_LOAD]: '数据加载',
      [PHASES.EXACT_MATCH]: '精确匹配',
      [PHASES.FUZZY_MATCH]: '模糊匹配',
      [PHASES.DISCREPANCY_GENERATION]: '差异生成',
      [PHASES.ARBITRATION]: '仲裁规则执行',
      [PHASES.ADJUSTMENT_GENERATION]: '调账指令生成'
    };
    const phaseName = phaseNames[bottleneckPhase] || bottleneckPhase;
    recommendations.push({
      priority: 'high',
      title: `优化 ${phaseName} 阶段`,
      description: `${phaseName} 是当前性能瓶颈，建议优先优化该阶段的算法或增加资源投入。`
    });
  }

  if (phaseStats[PHASES.DATA_LOAD]?.avgMs > 5000) {
    recommendations.push({
      priority: 'medium',
      title: '数据加载优化',
      description: '数据加载阶段耗时较长，建议考虑批量导入优化或增加数据库连接池大小。'
    });
  }

  if (phaseStats[PHASES.FUZZY_MATCH]?.avgMs > 10000) {
    recommendations.push({
      priority: 'medium',
      title: '匹配算法优化',
      description: '模糊匹配阶段耗时较长，建议考虑使用哈希索引或优化匹配算法。'
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      priority: 'low',
      title: '系统运行良好',
      description: '当前配置下系统各阶段性能均衡，无明显瓶颈。'
    });
  }

  return recommendations;
}

async function processQueue() {
  if (isProcessing || executionQueue.length === 0) return;
  isProcessing = true;

  while (executionQueue.length > 0) {
    const { planId } = executionQueue.shift();
    try {
      await executeStressTestPlan(planId);
    } catch (err) {
      console.error(`执行压测计划失败 ${planId}:`, err.message);
    }
  }

  isProcessing = false;
  activePlanId = null;
}

async function executeStressTestPlan(planId) {
  const plan = await StressTestPlan.findByPk(planId);
  if (!plan) return;
  if (plan.status === 'completed' || plan.status === 'cancelled' || plan.status === 'failed') return;

  activePlanId = planId;
  cancelledPlans.delete(planId);

  try {
    await plan.update({ status: 'generating_data', startTime: new Date(), errorMessage: null });
    broadcastStressTestUpdate(plan);

    const concurrentBatches = plan.concurrentBatches;
    let completedBatches = 0;
    let failedBatches = 0;
    let totalRecords = 0;
    let totalDiscrepancies = 0;

    const batchPromises = [];
    for (let i = 0; i < concurrentBatches; i++) {
      const promise = executeStressBatch(plan, i)
        .then(result => {
          completedBatches++;
          totalRecords += result.batch.recordCount || 0;
          totalDiscrepancies += result.discrepancyCount || 0;
        })
        .catch(err => {
          failedBatches++;
          console.error(`压测批次 ${i} 失败:`, err.message);
        });
      batchPromises.push(promise);
    }

    await Promise.all(batchPromises);

    const latestPlan = await StressTestPlan.findByPk(planId);
    const wasCancelled = cancelledPlans.has(planId);

    if (wasCancelled) {
      await latestPlan.update({
        status: 'cancelled',
        totalRecords,
        totalDiscrepancies,
        endTime: new Date()
      });
    } else {
      const report = await generateCapacityReport(planId);
      await latestPlan.update({
        status: failedBatches > 0 && completedBatches === 0 ? 'failed' : 'completed',
        totalRecords,
        totalDiscrepancies,
        endTime: new Date(),
        capacityReport: report
      });
    }

    const finalPlan = await StressTestPlan.findByPk(planId);
    broadcastStressTestUpdate(finalPlan);

    await cleanUpSandboxes(planId);

  } catch (err) {
    const plan = await StressTestPlan.findByPk(planId);
    if (plan) {
      await plan.update({ status: 'failed', errorMessage: err.message, endTime: new Date() });
      broadcastStressTestUpdate(plan);
    }
  } finally {
    activePlanId = null;
    cancelledPlans.delete(planId);
  }
}

async function createStressTestPlan(options = {}) {
  const {
    name,
    description,
    dataSourceCount,
    recordsPerSource,
    discrepancyRatio,
    discrepancyTypeWeights,
    concurrentBatches,
    config,
    createdBy
  } = options;

  const tenantId = getCurrentTenantId();

  if (!name) throw new Error('压测计划名称不能为空');
  if (!dataSourceCount || dataSourceCount < 2 || dataSourceCount > 10) {
    throw new Error('数据源数量必须在 2-10 之间');
  }
  if (!recordsPerSource || recordsPerSource < 100 || recordsPerSource > 100000) {
    throw new Error('每个源的交易记录数必须在 100-100000 之间');
  }
  if (discrepancyRatio === undefined || discrepancyRatio < 0 || discrepancyRatio > 0.5) {
    throw new Error('差异注入比例必须在 0-50% 之间');
  }
  if (!concurrentBatches || concurrentBatches < 1 || concurrentBatches > 5) {
    throw new Error('并发对账批次数必须在 1-5 之间');
  }

  const activeCount = await StressTestPlan.count({
    where: {
      tenantId,
      status: { [Op.in]: ['pending', 'generating_data', 'running'] }
    }
  });

  if (activeCount > 0) {
    throw new Error('只能同时运行一个压测计划，请等待当前压测完成或取消后再创建');
  }

  const plan = await StressTestPlan.create({
    name,
    description: description || null,
    dataSourceCount,
    recordsPerSource,
    discrepancyRatio,
    discrepancyTypeWeights: discrepancyTypeWeights || { unilateral: 0.4, amount: 0.4, time: 0.2 },
    concurrentBatches,
    config: config || {},
    tenantId,
    createdBy: createdBy || null
  });

  return plan;
}

async function getStressTestPlan(planId) {
  const plan = await StressTestPlan.findByPk(planId, {
    include: [
      { association: 'batches', order: [['batchIndex', 'ASC']] }
    ]
  });
  if (!plan) throw new Error('压测计划不存在');
  return plan;
}

async function listStressTestPlans(filters = {}) {
  const tenantId = getCurrentTenantId();
  const where = { tenantId };
  if (filters.status) where.status = filters.status;

  const { count, rows } = await StressTestPlan.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(filters.limit) || 50, 100),
    offset: parseInt(filters.offset) || 0
  });

  return { total: count, data: rows };
}

async function triggerStressTestPlan(planId) {
  const plan = await StressTestPlan.findByPk(planId);
  if (!plan) throw new Error('压测计划不存在');
  if (plan.status === 'running' || plan.status === 'generating_data') {
    throw new Error('压测计划已在执行中');
  }
  if (plan.status === 'completed') throw new Error('压测计划已完成');
  if (plan.status === 'cancelled') throw new Error('压测计划已取消');

  if (activePlanId) {
    throw new Error('已有压测计划正在执行，请等待完成或取消后再执行');
  }

  executionQueue.push({ planId });
  processQueue();

  return plan;
}

async function cancelStressTestPlan(planId) {
  const plan = await StressTestPlan.findByPk(planId);
  if (!plan) throw new Error('压测计划不存在');

  if (!['pending', 'generating_data', 'running'].includes(plan.status)) {
    throw new Error(`压测计划状态为 ${plan.status}，不能取消`);
  }

  cancelledPlans.add(planId);

  if (plan.status === 'pending') {
    await plan.update({ status: 'cancelled', endTime: new Date() });
  }

  broadcastStressTestUpdate(plan);
  return plan;
}

async function getCapacityReport(planId) {
  const plan = await StressTestPlan.findByPk(planId);
  if (!plan) throw new Error('压测计划不存在');

  if (plan.capacityReport) return plan.capacityReport;

  if (plan.status !== 'completed' && plan.status !== 'cancelled') {
    throw new Error('压测计划尚未完成，无法生成容量评估报告');
  }

  return generateCapacityReport(planId);
}

async function getBatchMetrics(planId, filters = {}) {
  const where = { stressTestPlanId: planId };
  if (filters.batchIndex !== undefined) where.batchIndex = filters.batchIndex;
  if (filters.phase) where.phase = filters.phase;

  const { count, rows } = await StressTestMetric.findAndCountAll({
    where,
    order: [['batchIndex', 'ASC'], ['phase', 'ASC']],
    limit: Math.min(parseInt(filters.limit) || 500, 1000),
    offset: parseInt(filters.offset) || 0
  });

  return { total: count, data: rows };
}

function getActiveStatus() {
  return {
    isProcessing,
    queueLength: executionQueue.length,
    activePlanId,
    queuedPlanIds: executionQueue.map(t => t.planId)
  };
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
  createStressTestPlan,
  getStressTestPlan,
  listStressTestPlans,
  triggerStressTestPlan,
  cancelStressTestPlan,
  getCapacityReport,
  getBatchMetrics,
  getActiveStatus,
  PHASES
};
