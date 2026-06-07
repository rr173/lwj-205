const { v4: uuidv4 } = require('uuid');
const {
  Discrepancy,
  ArbitrationTicket,
  AdjustmentInstruction,
  ArbitrationRule,
  DataSource,
  Transaction
} = require('../models');
const { Op } = require('sequelize');

async function applyAutoArbitration(batchId) {
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
    if (parseFloat(discrepancy.amountDiff) <= maxDiff) {
      await resolveDiscrepancy(ticket.id, {
        resolutionType: 'ignore',
        notes: `自动忽略：金额差异 ${discrepancy.amountDiff} 在容差 ${maxDiff} 以内`,
        ruleApplied: rule.name
      });
      return true;
    }
  }

  if (rule.ruleType === 'prefer_source') {
    if (discrepancy.type === 'unilateral') return false;
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

  const discrepancy = ticket.Discrepancy;
  if (!discrepancy) throw new Error('关联差异不存在');

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

  return ArbitrationTicket.findAll({
    where,
    include: [{ model: Discrepancy, as: 'Discrepancy' }],
    order: [['createdAt', 'DESC']]
  });
}

async function getAdjustmentInstructions(filters = {}) {
  const where = {};
  if (filters.batchId) where.batchId = filters.batchId;
  if (filters.status) where.status = filters.status;
  if (filters.arbitrationTicketId) where.arbitrationTicketId = filters.arbitrationTicketId;

  return AdjustmentInstruction.findAll({
    where,
    order: [['createdAt', 'DESC']]
  });
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
  getTickets,
  getAdjustmentInstructions,
  getRules,
  createRule
};
