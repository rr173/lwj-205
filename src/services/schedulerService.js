const cron = require('node-cron');
const {
  SchedulePlan,
  ScheduleExecution,
  ReconciliationBatch,
  AlertEvent,
  DataSource
} = require('../models');
const reconciliationService = require('./reconciliationService');
const arbitrationService = require('./arbitrationService');

const TICK_INTERVAL_MS = 5000;
const SLA_CHECK_INTERVAL_MS = 10000;
const SLA_WINDOW_SIZE = 30;

const dataSourceLocks = new Map();
const runningExecutions = new Map();
let wsBroadcast = null;
let tickTimer = null;
let slaCheckTimer = null;

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

function calculateNextRunAt(plan) {
  const now = new Date();

  if (plan.scheduleType === 'cron') {
    try {
      const task = cron.schedule(plan.cronExpression, () => {}, { scheduled: false });
      const nextDate = task.getNextRun();
      task.stop();
      if (nextDate) {
        const next = nextDate instanceof Date ? nextDate : new Date(nextDate);
        if (isWithinTimeWindow(next, plan)) {
          return next;
        }
        return findNextInWindow(plan, now);
      }
    } catch (e) {
      console.error(`Invalid cron expression for plan ${plan.id}:`, e.message);
    }
    return null;
  }

  if (plan.scheduleType === 'interval') {
    const intervalMs = (plan.intervalMinutes || 60) * 60 * 1000;
    let next = new Date((plan.lastRunAt || plan.createdAt || now).getTime() + intervalMs);

    if (next <= now) {
      const intervalsSkipped = Math.floor((now - next) / intervalMs) + 1;
      next = new Date(next.getTime() + intervalsSkipped * intervalMs);
    }

    if (plan.timeWindowStart && plan.timeWindowEnd) {
      next = findNextInWindow(plan, next);
    }

    return next;
  }

  return null;
}

function isWithinTimeWindow(date, plan) {
  if (!plan.timeWindowStart || !plan.timeWindowEnd) return true;

  const hh = date.getHours();
  const mm = date.getMinutes();
  const currentMinutes = hh * 60 + mm;

  const [startH, startM] = plan.timeWindowStart.split(':').map(Number);
  const [endH, endM] = plan.timeWindowEnd.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function findNextInWindow(plan, afterDate) {
  if (!plan.timeWindowStart || !plan.timeWindowEnd) return afterDate;

  const [startH, startM] = plan.timeWindowStart.split(':').map(Number);
  const [endH, endM] = plan.timeWindowEnd.split(':').map(Number);

  let candidate = new Date(afterDate);
  const maxDaysToSearch = 7;

  for (let d = 0; d < maxDaysToSearch; d++) {
    if (d > 0) {
      candidate = new Date(candidate);
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(startH, startM, 0, 0);
    }

    const windowStart = new Date(candidate);
    windowStart.setHours(startH, startM, 0, 0);

    const windowEnd = new Date(candidate);
    windowEnd.setHours(endH, endM, 0, 0);

    if (startH > endH || (startH === endH && startM >= endM)) {
      windowEnd.setDate(windowEnd.getDate() + 1);
    }

    if (candidate < windowStart) {
      candidate = windowStart;
    }

    if (candidate >= windowStart && candidate < windowEnd) {
      return candidate;
    }
  }

  return afterDate;
}

function acquireDataSourceLocks(plan) {
  const dsIds = plan.dataSourceIds || [];
  const lockedBy = [];

  for (const dsId of dsIds) {
    const lockInfo = dataSourceLocks.get(dsId);
    if (lockInfo && lockInfo.planId !== plan.id) {
      lockedBy.push({ dataSourceId: dsId, lockedByPlanId: lockInfo.planId });
    }
  }

  if (lockedBy.length > 0) {
    return { acquired: false, lockedBy };
  }

  for (const dsId of dsIds) {
    dataSourceLocks.set(dsId, { planId: plan.id, lockedAt: new Date() });
  }

  return { acquired: true, lockedBy: [] };
}

function releaseDataSourceLocks(planId) {
  for (const [dsId, lockInfo] of dataSourceLocks.entries()) {
    if (lockInfo.planId === planId) {
      dataSourceLocks.delete(dsId);
    }
  }
}

async function getActiveRunningExecution(planId) {
  return ScheduleExecution.findOne({
    where: { planId, status: 'running' },
    order: [['startedAt', 'DESC']]
  });
}

async function executeScheduledReconciliation(plan, triggeredBy) {
  const running = await getActiveRunningExecution(plan.id);
  if (running) {
    await ScheduleExecution.create({
      planId: plan.id,
      status: 'skipped',
      startedAt: new Date(),
      completedAt: new Date(),
      skipReason: '上一个批次尚未完成，跳过本次调度',
      triggeredBy
    });

    await plan.update({ lastExecutionStatus: 'skipped' });
    console.log(`[Scheduler] 计划「${plan.name}」跳过: 上一个批次尚未完成`);
    return;
  }

  const lockResult = acquireDataSourceLocks(plan);
  if (!lockResult.acquired) {
    await ScheduleExecution.create({
      planId: plan.id,
      status: 'skipped',
      startedAt: new Date(),
      completedAt: new Date(),
      skipReason: `数据源被其他计划锁定: ${lockResult.lockedBy.map(l => l.lockedByPlanId).join(', ')}`,
      triggeredBy
    });

    await plan.update({ lastExecutionStatus: 'skipped' });
    console.log(`[Scheduler] 计划「${plan.name}」跳过: 数据源被锁定`);
    return;
  }

  const now = new Date();
  const slaDeadline = new Date(now.getTime() + plan.slaMinutes * 60 * 1000);

  const execution = await ScheduleExecution.create({
    planId: plan.id,
    status: 'running',
    startedAt: now,
    slaDeadline,
    triggeredBy
  });

  runningExecutions.set(plan.id, execution.id);

  const config = {
    ...plan.reconciliationConfig,
    dataSourceIds: plan.dataSourceIds
  };

  try {
    const batch = await reconciliationService.createBatch(config);

    await execution.update({ batchId: batch.id });

    const transactions = await require('../models').Transaction.findAll({ where: { batchId: batch.id } });
    if (transactions.length === 0) {
      const dataSources = await DataSource.findAll({ where: { isActive: true } });
      const sourceIds = plan.dataSourceIds.length
        ? plan.dataSourceIds
        : dataSources.map(ds => ds.id);

      const baseTime = new Date();
      const demoTxns = [];
      const counterparties = ['阿里巴巴', '腾讯科技', '百度公司', '京东商城', '字节跳动'];
      const summaries = ['商品采购', '服务费用', '技术服务费', '广告投放费'];

      for (let i = 1; i <= 10; i++) {
        const txId = `SCH-TXN-${Date.now()}-${i}`;
        const amount = (Math.random() * 5000 + 100).toFixed(2);
        const timestamp = new Date(baseTime.getTime() - i * 60 * 1000);

        for (const dsId of sourceIds) {
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
            rawData: { txId, scheduledBy: plan.name }
          });
        }
      }

      if (demoTxns.length > 0) {
        await require('../models').Transaction.bulkCreate(demoTxns);
      }
    }

    await reconciliationService.triggerReconciliation(batch.id, false);
    await arbitrationService.applyAutoArbitration(batch.id);

    const completedAt = new Date();
    const durationMs = completedAt - execution.startedAt;

    await execution.update({
      status: 'completed',
      completedAt,
      executionDurationMs: durationMs,
      slaBreached: completedAt > slaDeadline
    });

    await plan.update({
      lastRunAt: now,
      lastExecutionStatus: 'completed',
      nextRunAt: calculateNextRunAt(plan)
    });

    console.log(`[Scheduler] 计划「${plan.name}」执行完成，耗时${(durationMs / 1000).toFixed(1)}秒`);
  } catch (err) {
    const completedAt = new Date();
    const durationMs = completedAt - execution.startedAt;

    await execution.update({
      status: 'failed',
      completedAt,
      executionDurationMs: durationMs,
      slaBreached: completedAt > slaDeadline
    });

    await plan.update({
      lastRunAt: now,
      lastExecutionStatus: 'failed',
      nextRunAt: calculateNextRunAt(plan)
    });

    console.error(`[Scheduler] 计划「${plan.name}」执行失败:`, err.message);
  } finally {
    releaseDataSourceLocks(plan.id);
    runningExecutions.delete(plan.id);
  }
}

async function checkSlaBreaches() {
  const now = new Date();

  const running = await ScheduleExecution.findAll({
    where: { status: 'running' },
    include: [{ model: SchedulePlan, as: 'plan' }]
  });

  for (const execution of running) {
    if (execution.slaDeadline && now > execution.slaDeadline && !execution.slaBreached) {
      await execution.update({ slaBreached: true, status: 'sla_breached' });

      const plan = execution.plan || await SchedulePlan.findByPk(execution.planId);
      if (plan) {
        const alert = await AlertEvent.create({
          type: 'sla_breach',
          severity: 'critical',
          title: '对账SLA违约告警',
          message: `调度计划「${plan.name}」对账已超过SLA目标(${plan.slaMinutes}分钟)，已运行${Math.round((now - execution.startedAt) / 60000)}分钟`,
          batchId: execution.batchId,
          metric: {
            planId: plan.id,
            planName: plan.name,
            slaMinutes: plan.slaMinutes,
            elapsedMinutes: Math.round((now - execution.startedAt) / 60000),
            startedAt: execution.startedAt,
            slaDeadline: execution.slaDeadline
          }
        });
        broadcastAlert(alert);
        console.log(`[Scheduler] SLA违约: 计划「${plan.name}」已超时`);
      }
    }
  }
}

async function tick() {
  const now = new Date();

  const plans = await SchedulePlan.findAll({
    where: {
      isActive: true,
      isPaused: false,
      isDeleted: false,
      nextRunAt: { [require('sequelize').Op.lte]: now }
    }
  });

  for (const plan of plans) {
    if (plan.timeWindowStart && plan.timeWindowEnd && !isWithinTimeWindow(now, plan)) {
      const nextInWindow = findNextInWindow(plan, now);
      await plan.update({ nextRunAt: nextInWindow });
      continue;
    }

    try {
      await executeScheduledReconciliation(plan, 'schedule');
    } catch (err) {
      console.error(`[Scheduler] 执行计划「${plan.name}」时出错:`, err.message);
      await plan.update({ nextRunAt: calculateNextRunAt(plan) });
    }
  }
}

async function start() {
  console.log('[Scheduler] 调度引擎启动中...');

  const plans = await SchedulePlan.findAll({
    where: { isActive: true, isPaused: false, isDeleted: false }
  });

  for (const plan of plans) {
    if (!plan.nextRunAt || plan.nextRunAt <= new Date()) {
      const nextRun = calculateNextRunAt(plan);
      await plan.update({ nextRunAt: nextRun });
      console.log(`[Scheduler] 恢复计划「${plan.name}」，下次执行: ${nextRun ? nextRun.toISOString() : 'N/A'}`);
    }
  }

  const staleExecutions = await ScheduleExecution.findAll({
    where: { status: 'running' }
  });

  for (const exec of staleExecutions) {
    await exec.update({
      status: 'failed',
      completedAt: new Date(),
      skipReason: '服务重启，执行中断'
    });
    const plan = await SchedulePlan.findByPk(exec.planId);
    if (plan) {
      releaseDataSourceLocks(plan.id);
    }
  }
  runningExecutions.clear();

  tickTimer = setInterval(async () => {
    try {
      await tick();
    } catch (err) {
      console.error('[Scheduler] tick error:', err.message);
    }
  }, TICK_INTERVAL_MS);

  slaCheckTimer = setInterval(async () => {
    try {
      await checkSlaBreaches();
    } catch (err) {
      console.error('[Scheduler] SLA check error:', err.message);
    }
  }, SLA_CHECK_INTERVAL_MS);

  console.log(`[Scheduler] 调度引擎已启动 (tick=${TICK_INTERVAL_MS}ms, sla_check=${SLA_CHECK_INTERVAL_MS}ms)`);
}

function stop() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (slaCheckTimer) {
    clearInterval(slaCheckTimer);
    slaCheckTimer = null;
  }
  dataSourceLocks.clear();
  runningExecutions.clear();
  console.log('[Scheduler] 调度引擎已停止');
}

async function createPlan(data) {
  const plan = await SchedulePlan.create(data);
  const nextRun = calculateNextRunAt(plan);
  await plan.update({ nextRunAt: nextRun });
  return plan;
}

async function updatePlan(planId, data) {
  const plan = await SchedulePlan.findByPk(planId);
  if (!plan) throw new Error('调度计划不存在');
  if (plan.isDeleted) throw new Error('已删除的计划不能修改');

  await plan.update(data);

  const scheduleChanged = data.scheduleType || data.cronExpression || data.intervalMinutes || data.timeWindowStart || data.timeWindowEnd;
  if (scheduleChanged) {
    const nextRun = calculateNextRunAt(plan);
    await plan.update({ nextRunAt: nextRun });
  }

  return plan;
}

async function deletePlan(planId) {
  const plan = await SchedulePlan.findByPk(planId);
  if (!plan) throw new Error('调度计划不存在');

  await plan.update({ isDeleted: true, isActive: false });
  return { message: '调度计划已删除，历史执行记录保留' };
}

async function pausePlan(planId) {
  const plan = await SchedulePlan.findByPk(planId);
  if (!plan) throw new Error('调度计划不存在');
  if (plan.isDeleted) throw new Error('已删除的计划不能暂停');
  if (plan.isPaused) throw new Error('计划已处于暂停状态');

  await plan.update({ isPaused: true });
  return plan;
}

async function resumePlan(planId) {
  const plan = await SchedulePlan.findByPk(planId);
  if (!plan) throw new Error('调度计划不存在');
  if (!plan.isPaused) throw new Error('计划未处于暂停状态');

  const nextRun = calculateNextRunAt(plan);
  await plan.update({ isPaused: false, nextRunAt: nextRun });
  return plan;
}

async function triggerNow(planId) {
  const plan = await SchedulePlan.findByPk(planId);
  if (!plan) throw new Error('调度计划不存在');
  if (plan.isDeleted) throw new Error('已删除的计划不能触发');
  if (!plan.isActive) throw new Error('未激活的计划不能触发');

  await executeScheduledReconciliation(plan, 'manual');

  const updatedPlan = await SchedulePlan.findByPk(planId);
  return updatedPlan;
}

async function getPlan(planId) {
  const plan = await SchedulePlan.findByPk(planId, {
    include: [{
      model: ScheduleExecution,
      as: 'executions',
      limit: 10,
      order: [['startedAt', 'DESC']]
    }]
  });
  if (!plan) throw new Error('调度计划不存在');
  return plan;
}

async function listPlans(filters = {}) {
  const where = {};
  if (filters.isActive !== undefined) where.isActive = filters.isActive === 'true';
  if (filters.isPaused !== undefined) where.isPaused = filters.isPaused === 'true';
  if (!filters.includeDeleted) where.isDeleted = false;

  const { count, rows } = await SchedulePlan.findAndCountAll({
    where,
    limit: Math.min(parseInt(filters.limit) || 100, 500),
    offset: parseInt(filters.offset) || 0,
    order: [['createdAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getExecutions(filters = {}) {
  const where = {};
  if (filters.planId) where.planId = filters.planId;
  if (filters.status) where.status = filters.status;

  const { count, rows } = await ScheduleExecution.findAndCountAll({
    where,
    include: [{ model: SchedulePlan, as: 'plan', attributes: ['id', 'name'] }],
    limit: Math.min(parseInt(filters.limit) || 100, 500),
    offset: parseInt(filters.offset) || 0,
    order: [['startedAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getSlaComplianceRate(planId) {
  const executions = await ScheduleExecution.findAll({
    where: {
      planId,
      status: { [require('sequelize').Op.in]: ['completed', 'failed', 'sla_breached'] }
    },
    order: [['startedAt', 'DESC']],
    limit: SLA_WINDOW_SIZE
  });

  if (executions.length === 0) {
    return { rate: null, total: 0, compliant: 0, windowSize: SLA_WINDOW_SIZE };
  }

  const compliant = executions.filter(e => !e.slaBreached).length;
  const rate = compliant / executions.length;

  return {
    rate: parseFloat(rate.toFixed(4)),
    total: executions.length,
    compliant,
    windowSize: SLA_WINDOW_SIZE
  };
}

async function getOverview() {
  const plans = await SchedulePlan.findAll({
    where: { isDeleted: false },
    order: [['createdAt', 'ASC']]
  });

  const overview = [];

  for (const plan of plans) {
    const slaInfo = await getSlaComplianceRate(plan.id);

    const lastExecution = await ScheduleExecution.findOne({
      where: { planId: plan.id },
      order: [['startedAt', 'DESC']]
    });

    const healthStatus = calculateHealthStatus(plan, slaInfo);

    overview.push({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      scheduleType: plan.scheduleType,
      cronExpression: plan.cronExpression,
      intervalMinutes: plan.intervalMinutes,
      timeWindowStart: plan.timeWindowStart,
      timeWindowEnd: plan.timeWindowEnd,
      slaMinutes: plan.slaMinutes,
      isActive: plan.isActive,
      isPaused: plan.isPaused,
      isPreset: plan.isPreset,
      nextRunAt: plan.nextRunAt,
      lastRunAt: plan.lastRunAt,
      lastExecutionStatus: plan.lastExecutionStatus,
      lastExecution: lastExecution ? {
        id: lastExecution.id,
        status: lastExecution.status,
        startedAt: lastExecution.startedAt,
        completedAt: lastExecution.completedAt,
        slaBreached: lastExecution.slaBreached,
        executionDurationMs: lastExecution.executionDurationMs
      } : null,
      slaCompliance: slaInfo,
      health: healthStatus
    });
  }

  return overview;
}

function calculateHealthStatus(plan, slaInfo) {
  if (!plan.isActive) return 'inactive';
  if (plan.isPaused) return 'paused';
  if (slaInfo.rate === null) return 'unknown';
  if (slaInfo.rate < plan.slaComplianceThreshold) return 'unhealthy';
  return 'healthy';
}

module.exports = {
  setWsBroadcast,
  start,
  stop,
  createPlan,
  updatePlan,
  deletePlan,
  pausePlan,
  resumePlan,
  triggerNow,
  getPlan,
  listPlans,
  getExecutions,
  getSlaComplianceRate,
  getOverview,
  calculateNextRunAt
};
