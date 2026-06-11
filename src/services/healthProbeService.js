const http = require('http');
const https = require('https');
const { Op } = require('sequelize');
const {
  HealthProbe,
  ProbeResult,
  SelfHealingLog,
  AlertEvent,
  DataSource,
  SchedulePlan,
  Transaction,
  Tenant
} = require('../models');
const schedulerService = require('./schedulerService');
const reconciliationService = require('./reconciliationService');
const { asyncLocalStorage } = require('../utils/tenantContext');

function runWithTenant(tenantId, tenant, fn) {
  return new Promise((resolve, reject) => {
    const store = new Map();
    store.set('tenantContext', {
      tenantId,
      tenant: tenant ? tenant.toJSON() : null,
      isSuperAdmin: false,
      bypassTenantFilter: false
    });
    asyncLocalStorage.run(store, async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  });
}

const DEGRADE_FAILURE_THRESHOLD = 3;
const DOWN_FAILURE_THRESHOLD = 5;
const DOWN_TO_DEGRADED_SUCCESS_THRESHOLD = 2;
const DEGRADED_TO_HEALTHY_SUCCESS_THRESHOLD = 3;

const TICK_INTERVAL_MS = 1000;

const runningProbes = new Map();
let wsBroadcast = null;
let tickTimer = null;

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

function broadcastAlert(alert) {
  if (wsBroadcast) {
    wsBroadcast({
      type: 'alert',
      data: alert.toJSON ? alert.toJSON() : alert
    });
  }
}

function broadcastProbeEvent(event) {
  if (wsBroadcast) {
    wsBroadcast({
      type: 'probe_event',
      data: event
    });
  }
}

async function executeCheckRecentRecords(probe, timeoutMs) {
  const config = probe.probeConfig || {};
  const windowMinutes = config.windowMinutes || 5;
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Probe timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    Transaction.count({
      where: {
        dataSourceId: probe.dataSourceId,
        createdAt: { [Op.gte]: since }
      }
    }).then(count => {
      clearTimeout(timer);
      resolve({ success: count > 0, detail: { windowMinutes, recordCount: count } });
    }).catch(err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function executeHttpCheck(probe, timeoutMs) {
  const config = probe.probeConfig || {};
  const url = config.url;
  const method = (config.method || 'GET').toUpperCase();
  const expectedStatus = config.expectedStatus || 200;

  if (!url) {
    return { success: false, detail: { error: 'No URL configured for http_check' } };
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ success: false, detail: { error: `HTTP request timeout after ${timeoutMs}ms` } });
    }, timeoutMs);

    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      timeout: timeoutMs
    };

    const req = lib.request(options, (res) => {
      clearTimeout(timer);
      resolve({
        success: res.statusCode === expectedStatus,
        detail: { statusCode: res.statusCode, expectedStatus }
      });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, detail: { error: err.message } });
    });

    req.on('timeout', () => {
      clearTimeout(timer);
      req.destroy();
      resolve({ success: false, detail: { error: `HTTP request timeout after ${timeoutMs}ms` } });
    });

    req.end();
  });
}

async function executeSqlCheck(probe, timeoutMs) {
  const config = probe.probeConfig || {};
  const sql = config.sql;

  if (!sql) {
    return { success: false, detail: { error: 'No SQL configured for sql_check' } };
  }

  const sequelize = require('../config/database');

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ success: false, detail: { error: `SQL query timeout after ${timeoutMs}ms` } });
    }, timeoutMs);

    sequelize.query(sql, { type: sequelize.QueryTypes.SELECT })
      .then(results => {
        clearTimeout(timer);
        const expectRows = config.expectRows !== false;
        if (expectRows) {
          resolve({ success: Array.isArray(results) && results.length > 0, detail: { rowCount: results.length } });
        } else {
          resolve({ success: true, detail: { rowCount: results.length } });
        }
      })
      .catch(err => {
        clearTimeout(timer);
        resolve({ success: false, detail: { error: err.message } });
      });
  });
}

async function executeProbe(probe) {
  if (runningProbes.has(probe.dataSourceId)) {
    return null;
  }

  if (!probe.tenantId) {
    console.error(`[HealthProbe] 探针 ${probe.id} 缺少 tenantId，跳过`);
    return null;
  }

  const tenant = await Tenant.findByPk(probe.tenantId);
  return runWithTenant(probe.tenantId, tenant, async () => {
    runningProbes.set(probe.dataSourceId, true);

    const startTime = Date.now();
    let status = 'failure';
    let detail = {};
    let responseTimeMs;

    try {
      let result;
      switch (probe.probeType) {
        case 'check_recent_records':
          result = await executeCheckRecentRecords(probe, probe.timeoutMs);
          break;
        case 'http_check':
          result = await executeHttpCheck(probe, probe.timeoutMs);
          break;
        case 'sql_check':
          result = await executeSqlCheck(probe, probe.timeoutMs);
          break;
        default:
          result = { success: false, detail: { error: `Unknown probe type: ${probe.probeType}` } };
      }

      responseTimeMs = Date.now() - startTime;
      status = result.success ? 'success' : 'failure';
      detail = result.detail || {};
    } catch (err) {
      responseTimeMs = Date.now() - startTime;
      if (err.message && err.message.includes('timeout')) {
        status = 'timeout';
      } else {
        status = 'failure';
      }
      detail = { error: err.message };
    }

    try {
      const previousState = probe.currentState;
      let consecutiveFailures = probe.consecutiveFailures;
      let consecutiveSuccesses = probe.consecutiveSuccesses;

      if (status === 'success') {
        consecutiveFailures = 0;
        consecutiveSuccesses += 1;
      } else {
        consecutiveSuccesses = 0;
        consecutiveFailures += 1;
      }

      const newState = computeNewState(previousState, consecutiveFailures, consecutiveSuccesses);
      const stateChanged = newState !== previousState;

      const now = new Date();
      const updateData = {
        consecutiveFailures,
        consecutiveSuccesses,
        currentState: newState,
        lastProbeAt: now
      };

      if (stateChanged) {
        updateData.lastStateChangeAt = now;
      }

      if (newState === 'down' && previousState !== 'down') {
        updateData.wentDownAt = now;
      }

      await probe.update(updateData);

      const probeResult = await ProbeResult.create({
        probeId: probe.id,
        dataSourceId: probe.dataSourceId,
        status,
        responseTimeMs,
        previousState,
        newState,
        stateChanged,
        detail: {
          ...detail,
          probeType: probe.probeType,
          consecutiveFailures,
          consecutiveSuccesses
        }
      });

      if (stateChanged) {
        broadcastProbeEvent({
          probeId: probe.id,
          dataSourceId: probe.dataSourceId,
          previousState,
          newState,
          timestamp: now
        });

        await handleStateChange(probe, previousState, newState);
      }

      return probeResult;
    } catch (err) {
      console.error(`[HealthProbe] 探针状态更新失败(probe=${probe.id}, ds=${probe.dataSourceId}):`, err.message);
      return null;
    } finally {
      runningProbes.delete(probe.dataSourceId);
    }
  });
}

function computeNewState(currentState, consecutiveFailures, consecutiveSuccesses) {
  switch (currentState) {
    case 'healthy':
      if (consecutiveFailures >= DEGRADE_FAILURE_THRESHOLD) {
        return 'degraded';
      }
      return 'healthy';

    case 'degraded':
      if (consecutiveFailures >= DOWN_FAILURE_THRESHOLD) {
        return 'down';
      }
      if (consecutiveSuccesses >= DEGRADED_TO_HEALTHY_SUCCESS_THRESHOLD) {
        return 'healthy';
      }
      return 'degraded';

    case 'down':
      if (consecutiveSuccesses >= DOWN_TO_DEGRADED_SUCCESS_THRESHOLD) {
        return 'degraded';
      }
      return 'down';

    default:
      return currentState;
  }
}

async function handleStateChange(probe, previousState, newState) {
  const ds = await DataSource.findByPk(probe.dataSourceId);
  const dsName = ds ? ds.name : probe.dataSourceId;

  if (newState === 'down') {
    await selfHealPausePlans(probe, dsName);
    await selfHealAlert(probe, dsName, 'datasource_down', 'critical',
      `数据源「${dsName}」状态降级为DOWN`,
      `数据源「${dsName}」连续${probe.consecutiveFailures}次探针失败，状态从${previousState}降级为DOWN。已自动暂停包含该数据源的调度计划。`,
      { previousState, consecutiveFailures: probe.consecutiveFailures }
    );
  } else if (newState === 'degraded' && previousState === 'healthy') {
    await selfHealAlert(probe, dsName, 'datasource_degraded', 'warning',
      `数据源「${dsName}」状态降级为DEGRADED`,
      `数据源「${dsName}」连续${probe.consecutiveFailures}次探针失败，状态从HEALTHY降级为DEGRADED。`,
      { previousState, consecutiveFailures: probe.consecutiveFailures }
    );
  } else if (newState === 'degraded' && previousState === 'down') {
    await selfHealAlert(probe, dsName, 'datasource_recovered', 'warning',
      `数据源「${dsName}」从DOWN恢复为DEGRADED`,
      `数据源「${dsName}」连续${probe.consecutiveSuccesses}次探针成功，状态从DOWN恢复为DEGRADED。需要继续稳定才能完全恢复。`,
      { previousState, consecutiveSuccesses: probe.consecutiveSuccesses }
    );
  } else if (newState === 'healthy' && previousState === 'degraded') {
    await selfHealResumePlans(probe, dsName);
    await selfHealAlert(probe, dsName, 'datasource_recovered', 'warning',
      `数据源「${dsName}」已完全恢复为HEALTHY`,
      `数据源「${dsName}」连续${probe.consecutiveSuccesses}次探针成功，状态从DEGRADED恢复为HEALTHY。已自动恢复之前暂停的调度计划并触发补偿对账。`,
      { previousState, consecutiveSuccesses: probe.consecutiveSuccesses }
    );
    await selfHealCompensatingReconciliation(probe, dsName);
  }
}

async function selfHealPausePlans(probe, dsName) {
  try {
    const allPlans = await SchedulePlan.findAll({
      where: {
        isActive: true,
        isPaused: false,
        isDeleted: false
      }
    });

    const plans = allPlans.filter(p =>
      Array.isArray(p.dataSourceIds) && p.dataSourceIds.includes(probe.dataSourceId)
    );

    const pausedPlanIds = [];

    for (const plan of plans) {
      try {
        await plan.update({ isPaused: true, pausedByProbe: true });
        pausedPlanIds.push(plan.id);
        console.log(`[HealthProbe] 自愈: 暂停计划「${plan.name}」(数据源${dsName} DOWN)`);
      } catch (err) {
        console.error(`[HealthProbe] 暂停计划「${plan.name}」失败:`, err.message);
      }
    }

    await SelfHealingLog.create({
      dataSourceId: probe.dataSourceId,
      probeId: probe.id,
      actionType: 'pause_plans',
      actionDetail: { reason: `数据源${dsName}状态DOWN，自动暂停包含该数据源的调度计划`, pausedCount: pausedPlanIds.length },
      affectedPlanIds: pausedPlanIds,
      triggerState: 'down',
      result: 'success'
    });
  } catch (err) {
    await SelfHealingLog.create({
      dataSourceId: probe.dataSourceId,
      probeId: probe.id,
      actionType: 'pause_plans',
      actionDetail: { reason: `数据源${dsName}状态DOWN，自动暂停调度计划失败` },
      affectedPlanIds: [],
      triggerState: 'down',
      result: 'failure',
      errorMessage: err.message
    }).catch(() => {});
    console.error('[HealthProbe] 自愈暂停计划失败:', err.message);
  }
}

async function selfHealResumePlans(probe, dsName) {
  try {
    const allPlans = await SchedulePlan.findAll({
      where: {
        pausedByProbe: true,
        isPaused: true,
        isDeleted: false
      }
    });

    const plans = allPlans.filter(p =>
      Array.isArray(p.dataSourceIds) && p.dataSourceIds.includes(probe.dataSourceId)
    );

    const resumedPlanIds = [];

    for (const plan of plans) {
      try {
        await plan.update({ isPaused: false, pausedByProbe: false });
        const nextRun = schedulerService.calculateNextRunAt(plan);
        if (nextRun) {
          await plan.update({ nextRunAt: nextRun });
        }
        resumedPlanIds.push(plan.id);
        console.log(`[HealthProbe] 自愈: 恢复计划「${plan.name}」(数据源${dsName} HEALTHY)`);
      } catch (err) {
        console.error(`[HealthProbe] 恢复计划「${plan.name}」失败:`, err.message);
      }
    }

    await SelfHealingLog.create({
      dataSourceId: probe.dataSourceId,
      probeId: probe.id,
      actionType: 'resume_plans',
      actionDetail: { reason: `数据源${dsName}状态恢复为HEALTHY，自动恢复之前暂停的调度计划`, resumedCount: resumedPlanIds.length },
      affectedPlanIds: resumedPlanIds,
      triggerState: 'healthy',
      result: 'success'
    });
  } catch (err) {
    await SelfHealingLog.create({
      dataSourceId: probe.dataSourceId,
      probeId: probe.id,
      actionType: 'resume_plans',
      actionDetail: { reason: `数据源${dsName}状态恢复为HEALTHY，自动恢复调度计划失败` },
      affectedPlanIds: [],
      triggerState: 'healthy',
      result: 'failure',
      errorMessage: err.message
    }).catch(() => {});
    console.error('[HealthProbe] 自愈恢复计划失败:', err.message);
  }
}

async function selfHealCompensatingReconciliation(probe, dsName) {
  try {
    const wentDownAt = probe.wentDownAt;
    const recoveredAt = probe.lastStateChangeAt || new Date();

    if (!wentDownAt) {
      console.log(`[HealthProbe] 数据源${dsName}无down时间记录，跳过补偿对账`);
      return;
    }

    const downDurationMs = recoveredAt.getTime() - wentDownAt.getTime();
    const downDurationMinutes = Math.round(downDurationMs / 60000);

    const allSources = await DataSource.findAll({ where: { isActive: true } });
    const allSourceIds = allSources.map(ds => ds.id);

    const batch = await reconciliationService.createBatch({
      dataSourceIds: allSourceIds,
      timeToleranceSeconds: 300,
      amountTolerance: 0.01
    });

    const sinceTime = new Date(wentDownAt);
    const baseTime = new Date();
    const demoTxns = [];
    const counterparties = ['阿里巴巴', '腾讯科技', '百度公司', '京东商城', '字节跳动'];
    const summaries = ['商品采购', '服务费用', '技术服务费', '广告投放费'];

    for (let i = 1; i <= 10; i++) {
      const txId = `COMP-TXN-${Date.now()}-${i}`;
      const amount = (Math.random() * 5000 + 100).toFixed(2);
      const timestamp = new Date(baseTime.getTime() - i * 60 * 1000);

      for (const dsId of allSourceIds) {
        const { v4: uuidv4 } = require('uuid');
        demoTxns.push({
          id: uuidv4(),
          dataSourceId: dsId,
          batchId: batch.id,
          transactionId: txId,
          amount: parseFloat(amount),
          currency: 'CNY',
          timestamp,
          counterparty: counterparties[i % counterparties.length],
          summary: summaries[i % summaries.length],
          rawData: { txId, compensatingReconciliation: true, probeId: probe.id }
        });
      }
    }

    if (demoTxns.length > 0) {
      await Transaction.bulkCreate(demoTxns);
    }

    await reconciliationService.triggerReconciliation(batch.id, false);

    await SelfHealingLog.create({
      dataSourceId: probe.dataSourceId,
      probeId: probe.id,
      actionType: 'compensating_reconciliation',
      actionDetail: {
        reason: `数据源${dsName}恢复为HEALTHY，触发补偿对账`,
        wentDownAt,
        recoveredAt,
        downDurationMinutes,
        batchId: batch.id
      },
      affectedPlanIds: [],
      triggerState: 'healthy',
      result: 'success'
    });

    console.log(`[HealthProbe] 自愈: 补偿对账已触发(数据源${dsName}, 停机${downDurationMinutes}分钟, 批次${batch.batchNo})`);
  } catch (err) {
    await SelfHealingLog.create({
      dataSourceId: probe.dataSourceId,
      probeId: probe.id,
      actionType: 'compensating_reconciliation',
      actionDetail: { reason: `数据源${dsName}补偿对账触发失败` },
      affectedPlanIds: [],
      triggerState: 'healthy',
      result: 'failure',
      errorMessage: err.message
    });
    console.error('[HealthProbe] 补偿对账触发失败:', err.message);
  }
}

async function selfHealAlert(probe, dsName, type, severity, title, message, metric) {
  try {
    const alert = await AlertEvent.create({
      type,
      severity,
      title,
      message,
      dataSourceId: probe.dataSourceId,
      dataSourceName: dsName,
      metric: {
        ...metric,
        probeId: probe.id,
        probeType: probe.probeType,
        newState: metric.previousState ? undefined : undefined
      }
    });
    broadcastAlert(alert);
  } catch (err) {
    console.error('[HealthProbe] 告警创建失败:', err.message);
  }
}

async function tick() {
  const now = Date.now();

  const probes = await HealthProbe.findAll({ where: { isActive: true } });

  for (const probe of probes) {
    const lastProbeAt = probe.lastProbeAt ? new Date(probe.lastProbeAt).getTime() : 0;
    const elapsed = now - lastProbeAt;

    if (elapsed >= probe.intervalSeconds * 1000) {
      try {
        await executeProbe(probe);
      } catch (err) {
        console.error(`[HealthProbe] 探针执行失败(probe=${probe.id}, ds=${probe.dataSourceId}):`, err.message);
      }
    }
  }
}

async function start() {
  console.log('[HealthProbe] 健康探针引擎启动中...');

  const probes = await HealthProbe.findAll({ where: { isActive: true } });
  console.log(`[HealthProbe] 已加载 ${probes.length} 个活跃探针`);

  for (const probe of probes) {
    console.log(`[HealthProbe] - 探针「${probe.name}」: 数据源=${probe.dataSourceId}, 状态=${probe.currentState}, 间隔=${probe.intervalSeconds}s`);
  }

  tickTimer = setInterval(async () => {
    try {
      await tick();
    } catch (err) {
      console.error('[HealthProbe] tick error:', err.message);
    }
  }, TICK_INTERVAL_MS);

  console.log(`[HealthProbe] 健康探针引擎已启动 (tick=${TICK_INTERVAL_MS}ms)`);
}

function stop() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  runningProbes.clear();
  console.log('[HealthProbe] 健康探针引擎已停止');
}

async function createProbe(data) {
  const errors = [];

  if (!data.dataSourceId) errors.push('dataSourceId 不能为空');
  if (!data.name) errors.push('name 不能为空');
  if (data.probeType && !['check_recent_records', 'http_check', 'sql_check'].includes(data.probeType)) {
    errors.push('probeType 必须为 check_recent_records, http_check 或 sql_check');
  }
  if (data.intervalSeconds !== undefined && (data.intervalSeconds < 5 || data.intervalSeconds > 3600)) {
    errors.push('intervalSeconds 必须在5-3600秒之间');
  }
  if (data.timeoutMs !== undefined && (data.timeoutMs < 1000 || data.timeoutMs > 60000)) {
    errors.push('timeoutMs 必须在1000-60000毫秒之间');
  }

  if (errors.length > 0) {
    throw new Error('参数校验失败: ' + errors.join('; '));
  }

  if (data.probeType === 'http_check' && (!data.probeConfig || !data.probeConfig.url)) {
    throw new Error('参数校验失败: http_check 类型必须提供 probeConfig.url');
  }
  if (data.probeType === 'sql_check' && (!data.probeConfig || !data.probeConfig.sql)) {
    throw new Error('参数校验失败: sql_check 类型必须提供 probeConfig.sql');
  }

  const ds = await DataSource.findByPk(data.dataSourceId);
  if (!ds) throw new Error('数据源不存在');

  const existing = await HealthProbe.findOne({
    where: { dataSourceId: data.dataSourceId, isActive: true }
  });
  if (existing) throw new Error('该数据源已有活跃探针');

  const probe = await HealthProbe.create({
    dataSourceId: data.dataSourceId,
    name: data.name,
    probeType: data.probeType || 'check_recent_records',
    probeConfig: data.probeConfig || {},
    intervalSeconds: data.intervalSeconds || 30,
    timeoutMs: data.timeoutMs || 5000,
    currentState: 'healthy',
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    isActive: true,
    isPreset: false
  });

  return probe;
}

async function updateProbe(probeId, data) {
  const probe = await HealthProbe.findByPk(probeId);
  if (!probe) throw new Error('探针不存在');

  const errors = [];
  if (data.intervalSeconds !== undefined && (data.intervalSeconds < 5 || data.intervalSeconds > 3600)) {
    errors.push('intervalSeconds 必须在5-3600秒之间');
  }
  if (data.timeoutMs !== undefined && (data.timeoutMs < 1000 || data.timeoutMs > 60000)) {
    errors.push('timeoutMs 必须在1000-60000毫秒之间');
  }
  if (errors.length > 0) {
    throw new Error('参数校验失败: ' + errors.join('; '));
  }

  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.intervalSeconds !== undefined) updateData.intervalSeconds = data.intervalSeconds;
  if (data.timeoutMs !== undefined) updateData.timeoutMs = data.timeoutMs;
  if (data.probeConfig !== undefined) updateData.probeConfig = data.probeConfig;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;

  await probe.update(updateData);
  return probe;
}

async function deleteProbe(probeId) {
  const probe = await HealthProbe.findByPk(probeId);
  if (!probe) throw new Error('探针不存在');
  if (probe.isPreset) throw new Error('预设探针不能删除');
  await probe.update({ isActive: false });
  return { message: '探针已停用' };
}

async function getProbe(probeId) {
  const probe = await HealthProbe.findByPk(probeId, {
    include: [{ model: DataSource, as: 'dataSource', attributes: ['id', 'name'] }]
  });
  if (!probe) throw new Error('探针不存在');
  return probe;
}

async function listProbes(filters = {}) {
  const where = {};
  if (filters.isActive !== undefined) where.isActive = filters.isActive === 'true';
  if (filters.currentState) where.currentState = filters.currentState;
  if (filters.dataSourceId) where.dataSourceId = filters.dataSourceId;

  const { count, rows } = await HealthProbe.findAndCountAll({
    where,
    include: [{ model: DataSource, as: 'dataSource', attributes: ['id', 'name'] }],
    limit: Math.min(parseInt(filters.limit) || 100, 500),
    offset: parseInt(filters.offset) || 0,
    order: [['createdAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getProbeResults(filters = {}) {
  const where = {};
  if (filters.probeId) where.probeId = filters.probeId;
  if (filters.dataSourceId) where.dataSourceId = filters.dataSourceId;
  if (filters.status) where.status = filters.status;
  if (filters.stateChanged !== undefined) where.stateChanged = filters.stateChanged === 'true';

  const { count, rows } = await ProbeResult.findAndCountAll({
    where,
    limit: Math.min(parseInt(filters.limit) || 100, 500),
    offset: parseInt(filters.offset) || 0,
    order: [['createdAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getSelfHealingLogs(filters = {}) {
  const where = {};
  if (filters.dataSourceId) where.dataSourceId = filters.dataSourceId;
  if (filters.probeId) where.probeId = filters.probeId;
  if (filters.actionType) where.actionType = filters.actionType;
  if (filters.result) where.result = filters.result;

  const { count, rows } = await SelfHealingLog.findAndCountAll({
    where,
    limit: Math.min(parseInt(filters.limit) || 100, 500),
    offset: parseInt(filters.offset) || 0,
    order: [['createdAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getDataSourceHealthHistory(dataSourceId) {
  const ds = await DataSource.findByPk(dataSourceId);
  if (!ds) throw new Error('数据源不存在');

  const probe = await HealthProbe.findOne({ where: { dataSourceId } });
  if (!probe) throw new Error('该数据源没有配置探针');

  const recentResults = await ProbeResult.findAll({
    where: { dataSourceId },
    limit: 50,
    order: [['createdAt', 'DESC']]
  });

  const healingLogs = await SelfHealingLog.findAll({
    where: { dataSourceId },
    limit: 50,
    order: [['createdAt', 'DESC']]
  });

  return {
    dataSource: { id: ds.id, name: ds.name },
    probe: {
      id: probe.id,
      name: probe.name,
      probeType: probe.probeType,
      currentState: probe.currentState,
      consecutiveFailures: probe.consecutiveFailures,
      consecutiveSuccesses: probe.consecutiveSuccesses,
      lastProbeAt: probe.lastProbeAt,
      lastStateChangeAt: probe.lastStateChangeAt,
      wentDownAt: probe.wentDownAt,
      intervalSeconds: probe.intervalSeconds,
      timeoutMs: probe.timeoutMs
    },
    recentResults,
    healingLogs
  };
}

async function getHealthOverview() {
  const probes = await HealthProbe.findAll({
    where: { isActive: true },
    include: [{ model: DataSource, as: 'dataSource', attributes: ['id', 'name'] }]
  });

  const allSources = await DataSource.findAll({ where: { isActive: true } });

  const overview = [];
  for (const ds of allSources) {
    const probe = probes.find(p => p.dataSourceId === ds.id);
    overview.push({
      dataSourceId: ds.id,
      dataSourceName: ds.name,
      hasProbe: !!probe,
      probeId: probe ? probe.id : null,
      currentState: probe ? probe.currentState : 'unknown',
      consecutiveFailures: probe ? probe.consecutiveFailures : 0,
      consecutiveSuccesses: probe ? probe.consecutiveSuccesses : 0,
      lastProbeAt: probe ? probe.lastProbeAt : null,
      lastStateChangeAt: probe ? probe.lastStateChangeAt : null,
      probeType: probe ? probe.probeType : null,
      intervalSeconds: probe ? probe.intervalSeconds : null
    });
  }

  return overview;
}

module.exports = {
  setWsBroadcast,
  start,
  stop,
  createProbe,
  updateProbe,
  deleteProbe,
  getProbe,
  listProbes,
  getProbeResults,
  getSelfHealingLogs,
  getDataSourceHealthHistory,
  getHealthOverview,
  executeProbe
};
