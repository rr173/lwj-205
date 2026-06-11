const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  DisposalPlan,
  DisposalPlanMatchLog,
  Discrepancy,
  ArbitrationTicket,
  DataSource
} = require('../models');
const auditService = require('./auditService');
const reviewService = require('./reviewService');
const arbitrationService = require('./arbitrationService');
const { getCurrentTenantId } = require('../utils/tenantContext');

async function _recordAudit(action, targetId, beforeValue, afterValue, operator, role) {
  try {
    await auditService.record({
      operator: operator || 'system',
      role: role || 'system',
      action,
      targetType: 'disposal_plan',
      targetId,
      beforeValue: beforeValue || null,
      afterValue: afterValue || null,
      tenantId: getCurrentTenantId()
    });
  } catch (err) {
    console.error('预案审计日志写入失败:', err.message);
  }
}

function _typeMap(discType) {
  const map = {
    unilateral: '单边',
    amount_mismatch: '金额',
    time_offset: '时间'
  };
  return map[discType] || discType;
}

async function createPlan(planData, operator, role) {
  const tenantId = getCurrentTenantId();

  const mc = planData.matchConditions;
  if (!mc || typeof mc !== 'object') {
    throw new Error('匹配条件不能为空');
  }
  const hasField = mc.discrepancyTypes ||
    (mc.amountDiffMin !== undefined && mc.amountDiffMin !== null) ||
    (mc.amountDiffMax !== undefined && mc.amountDiffMax !== null) ||
    mc.dataSourceNamePattern ||
    mc.summaryKeyword;
  if (!hasField) {
    throw new Error('匹配条件至少需要指定一个条件字段');
  }

  const act = planData.action;
  if (!act || !act.resolutionType) {
    throw new Error('处置动作必须指定处置方式');
  }
  const validTypes = ['use_source', 'ignore', 'manual_review'];
  if (!validTypes.includes(act.resolutionType)) {
    throw new Error(`处置方式必须为: ${validTypes.join('/')}`);
  }
  if (act.resolutionType === 'use_source' && !act.primarySourceId) {
    throw new Error('处置方式为"以某源为准"时必须指定优先数据源');
  }

  const plan = await DisposalPlan.create({
    id: uuidv4(),
    name: planData.name,
    description: planData.description || null,
    matchConditions: mc,
    action: act,
    priority: planData.priority ?? 100,
    isEnabled: planData.isEnabled !== undefined ? planData.isEnabled : true,
    tenantId
  });

  await _recordAudit('CREATE_DISPOSAL_PLAN', plan.id, null, plan.toJSON(), operator, role);

  return plan;
}

async function updatePlan(planId, planData, operator, role) {
  const plan = await DisposalPlan.findByPk(planId);
  if (!plan) throw new Error('预案不存在');
  if (plan.isDeleted) throw new Error('预案已删除，不能修改');

  const beforeValue = plan.toJSON();

  const updates = {};
  if (planData.name !== undefined) updates.name = planData.name;
  if (planData.description !== undefined) updates.description = planData.description;
  if (planData.priority !== undefined) updates.priority = planData.priority;
  if (planData.matchConditions !== undefined) {
    const mc = planData.matchConditions;
    if (!mc || typeof mc !== 'object') {
      throw new Error('匹配条件不能为空');
    }
    const hasField = mc.discrepancyTypes ||
      (mc.amountDiffMin !== undefined && mc.amountDiffMin !== null) ||
      (mc.amountDiffMax !== undefined && mc.amountDiffMax !== null) ||
      mc.dataSourceNamePattern ||
      mc.summaryKeyword;
    if (!hasField) {
      throw new Error('匹配条件至少需要指定一个条件字段');
    }
    updates.matchConditions = mc;
  }
  if (planData.action !== undefined) {
    const act = planData.action;
    if (!act || !act.resolutionType) {
      throw new Error('处置动作必须指定处置方式');
    }
    const validTypes = ['use_source', 'ignore', 'manual_review'];
    if (!validTypes.includes(act.resolutionType)) {
      throw new Error(`处置方式必须为: ${validTypes.join('/')}`);
    }
    if (act.resolutionType === 'use_source' && !act.primarySourceId) {
      throw new Error('处置方式为"以某源为准"时必须指定优先数据源');
    }
    updates.action = act;
  }

  await plan.update(updates);
  const afterValue = plan.toJSON();

  await _recordAudit('UPDATE_DISPOSAL_PLAN', planId, beforeValue, afterValue, operator, role);

  return plan;
}

async function enablePlan(planId, operator, role) {
  const plan = await DisposalPlan.findByPk(planId);
  if (!plan) throw new Error('预案不存在');
  if (plan.isDeleted) throw new Error('预案已删除，不能启用');

  const beforeValue = plan.toJSON();
  await plan.update({ isEnabled: true });
  const afterValue = plan.toJSON();

  await _recordAudit('ENABLE_DISPOSAL_PLAN', planId, beforeValue, afterValue, operator, role);

  return plan;
}

async function disablePlan(planId, operator, role) {
  const plan = await DisposalPlan.findByPk(planId);
  if (!plan) throw new Error('预案不存在');

  const beforeValue = plan.toJSON();
  await plan.update({ isEnabled: false });
  const afterValue = plan.toJSON();

  await _recordAudit('DISABLE_DISPOSAL_PLAN', planId, beforeValue, afterValue, operator, role);

  return plan;
}

async function deletePlan(planId, operator, role) {
  const plan = await DisposalPlan.findByPk(planId);
  if (!plan) throw new Error('预案不存在');

  const beforeValue = plan.toJSON();
  await plan.update({ isDeleted: true, isEnabled: false });
  const afterValue = plan.toJSON();

  await _recordAudit('DELETE_DISPOSAL_PLAN', planId, beforeValue, afterValue, operator, role);

  return plan;
}

async function listPlans(filters = {}) {
  const tenantId = getCurrentTenantId();
  const where = { tenantId, isDeleted: false };

  if (filters.isEnabled !== undefined) {
    where.isEnabled = filters.isEnabled === 'true';
  }
  if (filters.efficiencyTag) {
    where.efficiencyTag = filters.efficiencyTag;
  }

  const { count, rows } = await DisposalPlan.findAndCountAll({
    where,
    order: [['priority', 'ASC'], ['createdAt', 'DESC']],
    limit: Math.min(parseInt(filters.limit) || 100, 200),
    offset: parseInt(filters.offset) || 0
  });

  return { total: count, data: rows };
}

async function getPlan(planId) {
  const plan = await DisposalPlan.findByPk(planId, {
    include: [{ model: DisposalPlanMatchLog, as: 'matchLogs', limit: 10, order: [['matchedAt', 'DESC']] }]
  });
  if (!plan || plan.isDeleted) throw new Error('预案不存在');
  return plan;
}

async function _matchDiscrepancy(discrepancy, ticket, plans) {
  for (const plan of plans) {
    if (!plan.isEnabled || plan.isDeleted) continue;

    const mc = plan.matchConditions;

    if (mc.discrepancyTypes && Array.isArray(mc.discrepancyTypes)) {
      const mappedTypes = mc.discrepancyTypes.map(t => {
        const rmap = { '单边': 'unilateral', '金额': 'amount_mismatch', '时间': 'time_offset' };
        return rmap[t] || t;
      });
      if (!mappedTypes.includes(discrepancy.type)) continue;
    }

    if (mc.amountDiffMin !== undefined && mc.amountDiffMin !== null) {
      const diff = parseFloat(discrepancy.amountDiff || 0);
      if (diff < parseFloat(mc.amountDiffMin)) continue;
    }
    if (mc.amountDiffMax !== undefined && mc.amountDiffMax !== null) {
      const diff = parseFloat(discrepancy.amountDiff || 0);
      if (diff > parseFloat(mc.amountDiffMax)) continue;
    }

    if (mc.dataSourceNamePattern) {
      const sourceTxns = discrepancy.sourceTransactions || [];
      const sourceIds = sourceTxns.map(t => t.dataSourceId);
      const sources = await DataSource.findAll({
        where: { id: { [Op.in]: sourceIds } }
      });
      const nameMatched = sources.some(s =>
        s.name.includes(mc.dataSourceNamePattern)
      );
      if (!nameMatched) continue;
    }

    if (mc.summaryKeyword) {
      const desc = discrepancy.description || '';
      if (!desc.includes(mc.summaryKeyword)) continue;
    }

    return plan;
  }

  return null;
}

async function executeAutoDisposalForBatch(batchId, options = {}) {
  const tenantId = options.tenantId || getCurrentTenantId();
  if (!tenantId) {
    return { total: 0, autoDisposed: 0, skipped: 0, failed: 0, details: [{ status: 'error', reason: 'tenant context missing' }] };
  }

  const plans = await DisposalPlan.findAll({
    where: { tenantId, isEnabled: true, isDeleted: false },
    order: [['priority', 'ASC'], ['createdAt', 'ASC']]
  });

  if (plans.length === 0) {
    return { total: 0, autoDisposed: 0, skipped: 0, failed: 0, details: [] };
  }

  const tickets = await ArbitrationTicket.findAll({
    where: { batchId, status: 'pending' },
    include: [{ model: Discrepancy, as: 'Discrepancy' }]
  });

  const results = [];
  let autoDisposed = 0;
  let skipped = 0;
  let failed = 0;

  for (const ticket of tickets) {
    const disc = ticket.Discrepancy;
    if (!disc) {
      skipped++;
      results.push({ ticketId: ticket.id, status: 'skipped', reason: '关联差异不存在' });
      continue;
    }

    const matchedPlan = await _matchDiscrepancy(disc, ticket, plans);
    if (!matchedPlan) {
      skipped++;
      results.push({
        ticketId: ticket.id,
        discrepancyId: disc.id,
        status: 'no_match',
        reason: '未匹配到任何预案'
      });
      continue;
    }

    const disposeCheck = await reviewService.canDispose(ticket.id);
    if (!disposeCheck.canDispose) {
      await DisposalPlanMatchLog.create({
        id: uuidv4(),
        planId: matchedPlan.id,
        discrepancyId: disc.id,
        ticketId: ticket.id,
        batchId,
        autoExecuted: false,
        executionStatus: 'skipped',
        executionError: disposeCheck.reason,
        resolutionType: matchedPlan.action.resolutionType,
        coveredAmount: disc.amountDiff || 0,
        tenantId
      });

      await _updatePlanStats(matchedPlan, disc);

      skipped++;
      results.push({
        ticketId: ticket.id,
        discrepancyId: disc.id,
        planId: matchedPlan.id,
        planName: matchedPlan.name,
        status: 'skipped_review',
        reason: disposeCheck.reason
      });
      continue;
    }

    try {
      const act = matchedPlan.action;
      await arbitrationService.resolveDiscrepancy(ticket.id, {
        resolutionType: act.resolutionType,
        primarySourceId: act.primarySourceId || null,
        notes: `预案自动处置：${matchedPlan.name}${act.resolutionType === 'ignore' ? '（忽略）' : act.resolutionType === 'manual_review' ? '（标记人工）' : '（以数据源为准）'}`,
        ruleApplied: `disposal_plan:${matchedPlan.name}`,
        resolvedBy: 'disposal_plan_auto'
      });

      await DisposalPlanMatchLog.create({
        id: uuidv4(),
        planId: matchedPlan.id,
        discrepancyId: disc.id,
        ticketId: ticket.id,
        batchId,
        autoExecuted: true,
        executionStatus: 'success',
        resolutionType: act.resolutionType,
        coveredAmount: disc.amountDiff || 0,
        tenantId
      });

      await _updatePlanStats(matchedPlan, disc);

      autoDisposed++;
      results.push({
        ticketId: ticket.id,
        discrepancyId: disc.id,
        planId: matchedPlan.id,
        planName: matchedPlan.name,
        status: 'auto_disposed',
        resolutionType: act.resolutionType
      });
    } catch (err) {
      await DisposalPlanMatchLog.create({
        id: uuidv4(),
        planId: matchedPlan.id,
        discrepancyId: disc.id,
        ticketId: ticket.id,
        batchId,
        autoExecuted: true,
        executionStatus: 'failed',
        executionError: err.message,
        resolutionType: matchedPlan.action.resolutionType,
        coveredAmount: disc.amountDiff || 0,
        tenantId
      });

      await _updatePlanStats(matchedPlan, disc);

      failed++;
      results.push({
        ticketId: ticket.id,
        discrepancyId: disc.id,
        planId: matchedPlan.id,
        planName: matchedPlan.name,
        status: 'failed',
        error: err.message
      });
    }
  }

  return {
    total: tickets.length,
    autoDisposed,
    skipped,
    failed,
    details: results
  };
}

async function _updatePlanStats(plan, discrepancy) {
  const newHitCount = (plan.hitCount || 0) + 1;
  const newCoveredAmount = parseFloat(plan.coveredAmount || 0) + parseFloat(discrepancy.amountDiff || 0);

  await plan.update({
    hitCount: newHitCount,
    lastHitAt: new Date(),
    coveredAmount: newCoveredAmount
  });
}

async function executeAutoDisposalForTicket(ticketId, batchId, options = {}) {
  const tenantId = options.tenantId || getCurrentTenantId();
  if (!tenantId) {
    return { success: false, reason: 'tenant context missing' };
  }

  const plans = await DisposalPlan.findAll({
    where: { tenantId, isEnabled: true, isDeleted: false },
    order: [['priority', 'ASC'], ['createdAt', 'ASC']]
  });

  if (plans.length === 0) {
    return { success: false, reason: 'no_plans' };
  }

  const ticket = await ArbitrationTicket.findByPk(ticketId, {
    include: [{ model: Discrepancy, as: 'Discrepancy' }]
  });
  if (!ticket) {
    return { success: false, reason: 'ticket_not_found' };
  }
  if (ticket.status !== 'pending') {
    return { success: false, reason: `ticket_status_${ticket.status}` };
  }

  const disc = ticket.Discrepancy;
  if (!disc) {
    return { success: false, reason: 'discrepancy_not_found' };
  }

  const matchedPlan = await _matchDiscrepancy(disc, ticket, plans);
  if (!matchedPlan) {
    return { success: false, reason: 'no_match' };
  }

  const disposeCheck = await reviewService.canDispose(ticketId);
  if (!disposeCheck.canDispose) {
    await DisposalPlanMatchLog.create({
      id: uuidv4(),
      planId: matchedPlan.id,
      discrepancyId: disc.id,
      ticketId: ticket.id,
      batchId,
      autoExecuted: false,
      executionStatus: 'skipped',
      executionError: disposeCheck.reason,
      resolutionType: matchedPlan.action.resolutionType,
      coveredAmount: disc.amountDiff || 0,
      tenantId
    });
    await _updatePlanStats(matchedPlan, disc);
    return { success: false, reason: disposeCheck.reason, planId: matchedPlan.id, planName: matchedPlan.name };
  }

  try {
    const act = matchedPlan.action;
    await arbitrationService.resolveDiscrepancy(ticketId, {
      resolutionType: act.resolutionType,
      primarySourceId: act.primarySourceId || null,
      notes: options.notes || `预案自动处置：${matchedPlan.name}`,
      ruleApplied: `disposal_plan:${matchedPlan.name}`,
      resolvedBy: 'disposal_plan_auto'
    });

    await DisposalPlanMatchLog.create({
      id: uuidv4(),
      planId: matchedPlan.id,
      discrepancyId: disc.id,
      ticketId: ticket.id,
      batchId,
      autoExecuted: true,
      executionStatus: 'success',
      resolutionType: act.resolutionType,
      coveredAmount: disc.amountDiff || 0,
      tenantId
    });

    await _updatePlanStats(matchedPlan, disc);

    return {
      success: true,
      planId: matchedPlan.id,
      planName: matchedPlan.name,
      resolutionType: act.resolutionType
    };
  } catch (err) {
    await DisposalPlanMatchLog.create({
      id: uuidv4(),
      planId: matchedPlan.id,
      discrepancyId: disc.id,
      ticketId: ticket.id,
      batchId,
      autoExecuted: true,
      executionStatus: 'failed',
      executionError: err.message,
      resolutionType: matchedPlan.action.resolutionType,
      coveredAmount: disc.amountDiff || 0,
      tenantId
    });

    await _updatePlanStats(matchedPlan, disc);

    return { success: false, reason: err.message, planId: matchedPlan.id, planName: matchedPlan.name, failed: true };
  }
}

async function getPlanEffectAnalysis(startDate, endDate) {
  const tenantId = getCurrentTenantId();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();

  const plans = await DisposalPlan.findAll({
    where: { tenantId, isDeleted: false }
  });

  const planStats = [];
  for (const plan of plans) {
    const matchLogs = await DisposalPlanMatchLog.findAll({
      where: {
        planId: plan.id,
        matchedAt: { [Op.between]: [start, end] }
      }
    });

    const hitCount = matchLogs.length;
    const successCount = matchLogs.filter(l => l.executionStatus === 'success').length;
    const failedCount = matchLogs.filter(l => l.executionStatus === 'failed').length;
    const skippedCount = matchLogs.filter(l => l.executionStatus === 'skipped').length;
    const totalCoveredAmount = matchLogs.reduce((sum, l) => sum + parseFloat(l.coveredAmount || 0), 0);

    planStats.push({
      planId: plan.id,
      planName: plan.name,
      priority: plan.priority,
      isEnabled: plan.isEnabled,
      efficiencyTag: plan.efficiencyTag,
      hitCount,
      successCount,
      failedCount,
      skippedCount,
      totalCoveredAmount,
      hitRate: hitCount > 0 ? (successCount / hitCount * 100).toFixed(2) + '%' : '0%',
      lastHitAt: plan.lastHitAt
    });
  }

  planStats.sort((a, b) => b.hitCount - a.hitCount);

  const totalDiscrepancies = await Discrepancy.count({
    where: {
      tenantId,
      createdAt: { [Op.between]: [start, end] }
    }
  });

  const autoDisposedCount = await DisposalPlanMatchLog.count({
    where: {
      tenantId,
      autoExecuted: true,
      executionStatus: 'success',
      matchedAt: { [Op.between]: [start, end] }
    }
  });

  const coverageRate = totalDiscrepancies > 0
    ? (autoDisposedCount / totalDiscrepancies * 100).toFixed(2) + '%'
    : '0%';

  return {
    period: { start, end },
    totalDiscrepancies,
    autoDisposedCount,
    coverageRate,
    planRanking: planStats
  };
}

async function markInefficientPlans() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const plans = await DisposalPlan.findAll({
    where: {
      isEnabled: true,
      isDeleted: false,
      efficiencyTag: 'normal'
    }
  });

  let markedCount = 0;
  for (const plan of plans) {
    if (!plan.lastHitAt || new Date(plan.lastHitAt) < thirtyDaysAgo) {
      await plan.update({ efficiencyTag: 'low_efficiency' });
      markedCount++;
    }
  }

  return { checked: plans.length, marked: markedCount };
}

let inefficientCheckInterval = null;
const INEFFICIENT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function startInefficientCheck() {
  if (inefficientCheckInterval) {
    clearInterval(inefficientCheckInterval);
  }

  inefficientCheckInterval = setInterval(async () => {
    try {
      const result = await markInefficientPlans();
      if (result.marked > 0) {
        console.log(`[DisposalPlan] 标记了 ${result.marked} 个低效预案`);
      }
    } catch (err) {
      console.error('[DisposalPlan] 低效预案检查失败:', err.message);
    }
  }, INEFFICIENT_CHECK_INTERVAL_MS);

  console.log('[DisposalPlan] 低效预案检查任务已启动（每24小时执行一次）');
}

function stopInefficientCheck() {
  if (inefficientCheckInterval) {
    clearInterval(inefficientCheckInterval);
    inefficientCheckInterval = null;
    console.log('[DisposalPlan] 低效预案检查任务已停止');
  }
}

module.exports = {
  createPlan,
  updatePlan,
  enablePlan,
  disablePlan,
  deletePlan,
  listPlans,
  getPlan,
  executeAutoDisposalForBatch,
  executeAutoDisposalForTicket,
  getPlanEffectAnalysis,
  markInefficientPlans,
  startInefficientCheck,
  stopInefficientCheck
};
