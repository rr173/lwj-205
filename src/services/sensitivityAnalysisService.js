const { v4: uuidv4 } = require('uuid');
const {
  SensitivityAnalysis,
  ReconciliationBatch,
  SandboxDiscrepancy
} = require('../models');
const sandboxService = require('./sandboxService');

const MAX_POINTS = 100;
const MAX_CONCURRENT = 1;

let wsBroadcast = null;
let analysisQueue = [];
let isProcessing = false;
let started = false;

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

function broadcastAnalysisUpdate(analysis) {
  if (wsBroadcast) {
    wsBroadcast({
      type: 'sensitivity_analysis',
      data: {
        taskId: analysis.id,
        status: analysis.status,
        type: analysis.type,
        totalPoints: analysis.totalPoints,
        completedPoints: analysis.completedPoints,
        failedPoints: analysis.failedPoints,
        params: analysis.params
      }
    });
  }
}

const ALLOWED_PARAMS = [
  'amountTolerance',
  'timeToleranceSeconds'
];

function generateValues(start, end, step) {
  const values = [];
  let current = start;
  while (current <= end + step * 0.0001) {
    values.push(parseFloat(current.toFixed(10)));
    current += step;
  }
  return values;
}

function validateParamDef(paramDef, label) {
  if (!paramDef || !paramDef.paramName) {
    throw new Error(`${label}: 必须指定 paramName`);
  }
  if (!ALLOWED_PARAMS.includes(paramDef.paramName)) {
    throw new Error(`${label}: 参数名 ${paramDef.paramName} 不支持，可选值: ${ALLOWED_PARAMS.join(', ')}`);
  }
  if (paramDef.start == null || paramDef.end == null || paramDef.step == null) {
    throw new Error(`${label}: 必须指定 start、end、step`);
  }
  if (paramDef.step <= 0) {
    throw new Error(`${label}: step 必须大于 0`);
  }
  if (paramDef.start > paramDef.end) {
    throw new Error(`${label}: start 不能大于 end`);
  }
  const values = generateValues(paramDef.start, paramDef.end, paramDef.step);
  if (values.length === 0) {
    throw new Error(`${label}: 生成的参数值范围为空`);
  }
  return values;
}

async function submitAnalysis(options = {}) {
  const { baseBatchId, type, params, baseConfig, createdBy } = options;

  if (!baseBatchId) throw new Error('必须指定基准批次ID');

  const baseBatch = await ReconciliationBatch.findByPk(baseBatchId);
  if (!baseBatch) throw new Error('基准批次不存在');
  if (baseBatch.status !== 'completed') throw new Error('基准批次未完成对账');

  if (!type || !['single', 'grid'].includes(type)) {
    throw new Error('type 必须为 single 或 grid');
  }

  if (!params) throw new Error('必须指定分析参数');

  let paramValues1;
  let paramValues2;
  let totalPoints;

  paramValues1 = validateParamDef(params.param1, 'param1');
  totalPoints = paramValues1.length;

  if (type === 'grid') {
    if (!params.param2) throw new Error('网格分析必须指定 param2');
    paramValues2 = validateParamDef(params.param2, 'param2');
    totalPoints = paramValues1.length * paramValues2.length;
  }

  if (totalPoints > MAX_POINTS) {
    throw new Error(`总数据点数 ${totalPoints} 超过上限 ${MAX_POINTS}，请减小范围或增大步长`);
  }

  const analysis = await SensitivityAnalysis.create({
    baseBatchId,
    type,
    status: 'queued',
    params: {
      ...params,
      param1Values: paramValues1,
      param2Values: type === 'grid' ? paramValues2 : undefined
    },
    baseConfig: baseConfig || baseBatch.config || {},
    totalPoints,
    completedPoints: 0,
    failedPoints: 0,
    createdBy: createdBy || null
  });

  analysisQueue.push({ taskId: analysis.id });
  processQueue();

  return analysis;
}

async function processQueue() {
  if (isProcessing || analysisQueue.length === 0) return;

  const runningCount = await SensitivityAnalysis.count({
    where: { status: 'running' }
  });
  if (runningCount >= MAX_CONCURRENT) return;

  isProcessing = true;

  while (analysisQueue.length > 0) {
    const stillRunning = await SensitivityAnalysis.count({
      where: { status: 'running' }
    });
    if (stillRunning >= MAX_CONCURRENT) break;

    const { taskId } = analysisQueue.shift();
    try {
      await executeAnalysis(taskId);
    } catch (err) {
      console.error(`灵敏度分析任务执行失败 ${taskId}:`, err.message);
    }
  }

  isProcessing = false;

  if (analysisQueue.length > 0) {
    setTimeout(() => processQueue(), 2000);
  }
}

async function executeAnalysis(taskId) {
  const analysis = await SensitivityAnalysis.findByPk(taskId);
  if (!analysis) return;
  if (analysis.status === 'cancelled') return;

  await analysis.update({ status: 'running', startTime: new Date() });
  broadcastAnalysisUpdate(analysis);

  try {
    const params = analysis.params;
    const param1Values = params.param1Values;
    const baseConfig = analysis.baseConfig || {};

    if (analysis.type === 'single') {
      await executeSingleAnalysis(analysis, param1Values, params.param1.paramName, baseConfig);
    } else {
      const param2Values = params.param2Values;
      await executeGridAnalysis(analysis, param1Values, params.param1.paramName, param2Values, params.param2.paramName, baseConfig);
    }

    const refreshed = await SensitivityAnalysis.findByPk(taskId);
    await refreshed.update({ status: 'completed', endTime: new Date() });
    broadcastAnalysisUpdate(refreshed);
  } catch (err) {
    const refreshed = await SensitivityAnalysis.findByPk(taskId);
    if (refreshed && refreshed.status !== 'cancelled') {
      await refreshed.update({ status: 'failed', errorMessage: err.message, endTime: new Date() });
      broadcastAnalysisUpdate(refreshed);
    }
  }
}

async function runSinglePoint(baseBatchId, config, paramName, paramValue, createdBy, analysisId) {
  const overriddenConfig = { ...config, [paramName]: paramValue };

  const sandbox = await sandboxService.createSandbox({
    baseBatchId,
    name: `灵敏度分析-${paramName}=${paramValue}`,
    config: overriddenConfig,
    ttlHours: 1,
    createdBy: createdBy || 'sensitivity_analysis',
    sensitivityAnalysisId: analysisId
  });

  try {
    const completed = await sandboxService.runSandboxReconciliation(sandbox.id);

    const discrepancies = await SandboxDiscrepancy.findAll({
      where: { sandboxId: sandbox.id }
    });

    const discrepancyByType = {};
    for (const d of discrepancies) {
      discrepancyByType[d.type] = (discrepancyByType[d.type] || 0) + 1;
    }

    const uniqueCount = completed.matchedCount + completed.discrepancyCount;
    const matchRate = uniqueCount > 0 ? completed.matchedCount / uniqueCount : 0;

    return {
      matchedCount: completed.matchedCount,
      discrepancyCount: completed.discrepancyCount,
      uniqueTransactionCount: uniqueCount,
      matchRate: parseFloat((matchRate * 100).toFixed(2)),
      discrepancyByType
    };
  } finally {
    try {
      await sandboxService.deleteSandboxInternal(sandbox.id);
    } catch (e) {
      console.error(`清理临时沙盒失败 ${sandbox.id}:`, e.message);
    }
  }
}

async function runGridPoint(baseBatchId, config, param1Name, param1Value, param2Name, param2Value, createdBy, analysisId) {
  const overriddenConfig = { ...config, [param1Name]: param1Value, [param2Name]: param2Value };

  const sandbox = await sandboxService.createSandbox({
    baseBatchId,
    name: `灵敏度网格-${param1Name}=${param1Value},${param2Name}=${param2Value}`,
    config: overriddenConfig,
    ttlHours: 1,
    createdBy: createdBy || 'sensitivity_analysis',
    sensitivityAnalysisId: analysisId
  });

  try {
    const completed = await sandboxService.runSandboxReconciliation(sandbox.id);

    const uniqueCount = completed.matchedCount + completed.discrepancyCount;
    const matchRate = uniqueCount > 0 ? completed.matchedCount / uniqueCount : 0;

    return {
      matchedCount: completed.matchedCount,
      discrepancyCount: completed.discrepancyCount,
      uniqueTransactionCount: uniqueCount,
      matchRate: parseFloat((matchRate * 100).toFixed(2))
    };
  } finally {
    try {
      await sandboxService.deleteSandboxInternal(sandbox.id);
    } catch (e) {
      console.error(`清理临时沙盒失败 ${sandbox.id}:`, e.message);
    }
  }
}

async function executeSingleAnalysis(analysis, paramValues, paramName, baseConfig) {
  const results = [];
  let completedPoints = 0;
  let failedPoints = 0;

  for (let i = 0; i < paramValues.length; i++) {
    const latestAnalysis = await SensitivityAnalysis.findByPk(analysis.id);
    if (latestAnalysis.status === 'cancelled') return;

    const paramValue = paramValues[i];
    try {
      const pointResult = await runSinglePoint(
        analysis.baseBatchId, baseConfig, paramName, paramValue, analysis.createdBy, analysis.id
      );
      results.push({
        paramValue,
        ...pointResult
      });
      completedPoints++;
    } catch (err) {
      results.push({
        paramValue,
        error: err.message,
        matchedCount: 0,
        discrepancyCount: 0,
        uniqueTransactionCount: 0,
        matchRate: 0,
        discrepancyByType: {}
      });
      failedPoints++;
      console.error(`单参数分析点失败 ${paramName}=${paramValue}:`, err.message);
    }

    await analysis.update({
      completedPoints,
      failedPoints,
      results
    });
    broadcastAnalysisUpdate(analysis);
  }
}

async function executeGridAnalysis(analysis, param1Values, param1Name, param2Values, param2Name, baseConfig) {
  const rows = [];
  let completedPoints = 0;
  let failedPoints = 0;

  for (let i = 0; i < param1Values.length; i++) {
    const latestAnalysis = await SensitivityAnalysis.findByPk(analysis.id);
    if (latestAnalysis.status === 'cancelled') return;

    const row = {
      param1Value: param1Values[i],
      cells: []
    };

    for (let j = 0; j < param2Values.length; j++) {
      const latestAnalysis2 = await SensitivityAnalysis.findByPk(analysis.id);
      if (latestAnalysis2.status === 'cancelled') return;

      try {
        const pointResult = await runGridPoint(
          analysis.baseBatchId, baseConfig,
          param1Name, param1Values[i],
          param2Name, param2Values[j],
          analysis.createdBy, analysis.id
        );
        row.cells.push({
          param2Value: param2Values[j],
          ...pointResult
        });
        completedPoints++;
      } catch (err) {
        row.cells.push({
          param2Value: param2Values[j],
          error: err.message,
          matchRate: 0,
          matchedCount: 0,
          discrepancyCount: 0,
          uniqueTransactionCount: 0
        });
        failedPoints++;
        console.error(`网格分析点失败 ${param1Name}=${param1Values[i]},${param2Name}=${param2Values[j]}:`, err.message);
      }

      await analysis.update({
        completedPoints,
        failedPoints,
        results: {
          param1Name,
          param2Name,
          param1Values,
          param2Values,
          rows
        }
      });
      broadcastAnalysisUpdate(analysis);
    }

    rows.push(row);
  }
}

async function getAnalysis(taskId) {
  const analysis = await SensitivityAnalysis.findByPk(taskId, {
    include: [{ association: 'baseBatch', attributes: ['id', 'batchNo', 'status'] }]
  });
  if (!analysis) throw new Error('灵敏度分析任务不存在');
  return analysis;
}

async function listAnalyses(filters = {}) {
  const where = {};
  if (filters.status) where.status = filters.status;
  if (filters.baseBatchId) where.baseBatchId = filters.baseBatchId;

  const { count, rows } = await SensitivityAnalysis.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(filters.limit) || 50, 100),
    offset: parseInt(filters.offset) || 0
  });

  return { total: count, data: rows };
}

async function cancelAnalysis(taskId) {
  const analysis = await SensitivityAnalysis.findByPk(taskId);
  if (!analysis) throw new Error('灵敏度分析任务不存在');
  if (analysis.status === 'completed' || analysis.status === 'failed' || analysis.status === 'cancelled') {
    throw new Error(`任务状态为 ${analysis.status}，不能取消`);
  }

  await analysis.update({ status: 'cancelled', endTime: new Date() });
  broadcastAnalysisUpdate(analysis);

  analysisQueue = analysisQueue.filter(item => item.taskId !== taskId);

  return analysis;
}

function start() {
  if (started) return;
  started = true;
}

function stop() {
  started = false;
  analysisQueue = [];
  isProcessing = false;
}

module.exports = {
  setWsBroadcast,
  start,
  stop,
  submitAnalysis,
  getAnalysis,
  listAnalyses,
  cancelAnalysis
};
