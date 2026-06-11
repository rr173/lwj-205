const { v4: uuidv4 } = require('uuid');
const {
  Discrepancy,
  ArbitrationTicket,
  AdjustmentInstruction,
  ArbitrationRule,
  DataSource,
  Transaction,
  ReconciliationBatch,
  ArbitrationTicketArchive,
  DiscrepancyArchive,
  AdjustmentInstructionArchive
} = require('../models');
const { Op } = require('sequelize');
const reviewService = require('./reviewService');

async function applyAutoArbitration(batchId) {
  const batch = await ReconciliationBatch.findByPk(batchId);
  if (!batch) throw new Error('批次不存在');
  if (batch.isArchived) throw new Error('该批次已归档，不能执行仲裁，请先回迁到主表');
  if (batch.archiveLock) throw new Error('该批次正在进行归档/回迁操作，请稍后重试');

  const rules = await ArbitrationRule.findAll({
    where: { isActive: true },
    order: [['priority', 'ASC']]
  });

  const tickets = await ArbitrationTicket.findAll({
    where: { batchId, status: 'pending' },
    include: [{ model: Discrepancy, as: 'Discrepancy' }]
  });

  const results = [];
  for (const ticket of tickets) {
    const disc = ticket.Discrepancy;
    if (!disc) continue;

    const disposeCheck = await reviewService.canDispose(ticket.id);
    if (!disposeCheck.canDispose) {
      results.push({ ticketId: ticket.id, resolved: false, skipped: true, reason: disposeCheck.reason });
      continue;
    }

    let resolved = false;
    for (const rule of rules) {
      if (await applyRule(ticket, disc, rule)) {
        resolved = true;
        break;
      }
    }
    results.push({ ticketId: ticket.id, resolved });
  }

  return results;
}

async function applyRule(ticket, discrepancy, rule) {
  const condition = rule.condition;

  if (rule.ruleType === 'amount_tolerance') {
    if (discrepancy.type !== 'amount_mismatch') return false;
    const maxDiff = condition.maxDifference || 0.01;
    const amountDiff = parseFloat(discrepancy.amountDiff);
    if (amountDiff <= maxDiff + 0.000001) {
      await resolveDiscrepancy(ticket.id, {
        resolutionType: 'ignore',
        notes: `自动忽略：金额差异 ${amountDiff.toFixed(4)} 在容差 ${maxDiff} 以内`,
        ruleApplied: rule.name
      });
      return true;
    }
  }

  if (rule.ruleType === 'prefer_source') {
    if (discrepancy.type !== 'amount_mismatch') return false;
    const preferSourceName = condition.preferDataSource;
    const dataSource = await DataSource.findOne({ where: { name: preferSourceName } });
    if (!dataSource) return false;

    const sourceTx = discrepancy.sourceTransactions?.find(
      t => t.dataSourceId === dataSource.id
    );
    if (!sourceTx) return false;

    await resolveDiscrepancy(ticket.id, {
      resolutionType: 'use_source',
      primarySourceId: dataSource.id,
      notes: `自动仲裁：以 ${preferSourceName} 数据为准`,
      ruleApplied: rule.name
    });
    return true;
  }

  return false;
}

async function resolveDiscrepancy(ticketId, options) {
  const ticket = await ArbitrationTicket.findByPk(ticketId, {
    include: [{ model: Discrepancy, as: 'Discrepancy' }]
  });
  if (!ticket) throw new Error('仲裁工单不存在');

  const disposeCheck = await reviewService.canDispose(ticketId);
  if (!disposeCheck.canDispose) {
    throw new Error(disposeCheck.reason);
  }

  const discrepancy = ticket.Discrepancy;
  if (!discrepancy) throw new Error('关联差异不存在');

  const allowedStatuses = ['pending', 'pending_review'];
  if (!allowedStatuses.includes(ticket.status)) {
    if (ticket.status === 'appealing') {
      throw new Error('该工单正在申诉中，不能处置');
    }
    throw new Error(`该工单当前状态为 ${ticket.status}，仅 pending 和 pending_review 状态可处置，不能重复处置`);
  }

  const updates = {
    status: options.resolutionType === 'manual_review' ? 'pending_review' :
            options.resolutionType === 'ignore' ? 'ignored' : 'auto_resolved',
    resolutionType: options.resolutionType,
    primarySourceId: options.primarySourceId || null,
    resolvedBy: options.resolvedBy || 'system',
    resolvedAt: new Date(),
    notes: options.notes || null,
    ruleApplied: options.ruleApplied || null
  };

  if (options.resolutionType === 'manually_resolved') {
    updates.status = 'manually_resolved';
  }

  await ticket.update(updates);

  let discStatus = 'resolved';
  if (options.resolutionType === 'ignore') discStatus = 'ignored';
  if (options.resolutionType === 'manual_review') discStatus = 'pending_review';
  await discrepancy.update({ status: discStatus });

  if (options.resolutionType === 'use_source' && options.primarySourceId) {
    await AdjustmentInstruction.destroy({ where: { arbitrationTicketId: ticketId } });
    await generateAdjustmentInstructions(ticket, discrepancy, options.primarySourceId);
  }

  return ticket;
}

async function generateAdjustmentInstructions(ticket, discrepancy, primarySourceId) {
  const sourceTx = discrepancy.sourceTransactions?.find(
    t => t.dataSourceId === primarySourceId
  );
  if (!sourceTx) return;

  const primaryAmount = parseFloat(sourceTx.amount);

  for (const tx of discrepancy.sourceTransactions || []) {
    if (tx.dataSourceId === primarySourceId) continue;

    const currentAmount = parseFloat(tx.amount);
    const diff = primaryAmount - currentAmount;

    if (Math.abs(diff) < 0.0001) continue;

    await AdjustmentInstruction.create({
      id: uuidv4(),
      arbitrationTicketId: ticket.id,
      discrepancyId: discrepancy.id,
      batchId: discrepancy.batchId,
      targetDataSourceId: tx.dataSourceId,
      transactionId: discrepancy.transactionId,
      adjustmentType: diff > 0 ? 'increase' : 'decrease',
      amount: Math.abs(diff),
      currency: 'CNY',
      description: `调账：${diff > 0 ? '调增' : '调减'} ${Math.abs(diff)}，以主数据源为准`,
      status: 'pending'
    });
  }
}

async function getTickets(filters = {}) {
  const where = {};
  if (filters.batchId) where.batchId = filters.batchId;
  if (filters.status) where.status = filters.status;
  if (filters.discrepancyId) where.discrepancyId = filters.discrepancyId;

  const useArchive = filters.useArchive === 'true';
  const TicketModel = useArchive ? ArbitrationTicketArchive : ArbitrationTicket;
  const DiscModel = useArchive ? DiscrepancyArchive : Discrepancy;

  const rows = await TicketModel.findAll({
    where,
    include: useArchive ? [] : [{ model: Discrepancy, as: 'Discrepancy' }],
    order: [[useArchive ? 'archivedAt' : 'createdAt', 'DESC']]
  });

  return {
    total: rows.length,
    data: rows,
    source: useArchive ? 'archive' : 'main'
  };
}

async function getAdjustmentInstructions(filters = {}) {
  const where = {};
  if (filters.batchId) where.batchId = filters.batchId;
  if (filters.status) where.status = filters.status;
  if (filters.arbitrationTicketId) where.arbitrationTicketId = filters.arbitrationTicketId;

  const useArchive = filters.useArchive === 'true';
  const Model = useArchive ? AdjustmentInstructionArchive : AdjustmentInstruction;

  const rows = await Model.findAll({
    where,
    order: [[useArchive ? 'archivedAt' : 'createdAt', 'DESC']]
  });

  return {
    total: rows.length,
    data: rows,
    source: useArchive ? 'archive' : 'main'
  };
}

async function getRules() {
  return ArbitrationRule.findAll({ order: [['priority', 'ASC']] });
}

async function createRule(ruleData) {
  return ArbitrationRule.create(ruleData);
}

module.exports = {
  applyAutoArbitration,
  resolveDiscrepancy,
  generateAdjustmentInstructions,
  getTickets,
  getAdjustmentInstructions,
  getRules,
  createRule
};
