const { v4: uuidv4 } = require('uuid');
const {
  Sandbox,
  SandboxTransaction,
  SandboxDiscrepancy,
  SandboxArbitrationTicket,
  Transaction,
  ReconciliationBatch,
  Discrepancy,
  ArbitrationTicket,
  ArbitrationRule,
  DataSource,
  AlertRule
} = require('../models');
const { Op } = require('sequelize');

const MAX_ACTIVE_SANDBOXES = 5;
const DEFAULT_SANDBOX_TTL_HOURS = 24;
const MAX_RECORDS = 100000;

let wsBroadcast = null;
let cleanupTimer = null;
let started = false;

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

function broadcastSandboxUpdate(sandbox) {
  if (wsBroadcast) {
    wsBroadcast({
      type: 'sandbox',
      data: {
        sandboxId: sandbox.id,
        status: sandbox.status,
        name: sandbox.name,
        baseBatchId: sandbox.baseBatchId,
        matchedCount: sandbox.matchedCount,
        discrepancyCount: sandbox.discrepancyCount
      }
    });
  }
}

async function getActiveSandboxCount() {
  const now = new Date();
  return Sandbox.count({
    where: {
      status: { [Op.in]: ['creating', 'ready', 'running', 'completed', 'failed'] },
      expiresAt: { [Op.gt]: now }
    }
  });
}

async function cleanupExpiredSandboxes() {
  const now = new Date();
  const expired = await Sandbox.findAll({
    where: {
      status: { [Op.ne]: 'deleted' },
      expiresAt: { [Op.lte]: now }
    }
  });

  for (const sandbox of expired) {
    try {
      await deleteSandboxInternal(sandbox.id, true);
    } catch (err) {
      console.error(`清理过期沙盒失败 ${sandbox.id}:`, err.message);
    }
  }
}

async function deleteSandboxInternal(sandboxId, isExpired = false) {
  await SandboxArbitrationTicket.destroy({ where: { sandboxId } });
  await SandboxDiscrepancy.destroy({ where: { sandboxId } });
  await SandboxTransaction.destroy({ where: { sandboxId } });
  await Sandbox.update(
    { status: isExpired ? 'expired' : 'deleted' },
    { where: { id: sandboxId } }
  );
}

async function start() {
  if (started) return;
  started = true;
  await cleanupExpiredSandboxes();
  cleanupTimer = setInterval(cleanupExpiredSandboxes, 10 * 60 * 1000);
}

function stop() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  started = false;
}

async function createSandbox(options = {}) {
  const { baseBatchId, name, config, arbitrationRules, alertThresholds, ttlHours, createdBy, backtestPlanId, backtestExecutionIndex, sensitivityAnalysisId } = options;

  if (!baseBatchId) {
    throw new Error('必须指定基准批次ID');
  }

  const baseBatch = await ReconciliationBatch.findByPk(baseBatchId);
  if (!baseBatch) {
    throw new Error('基准批次不存在');
  }
  if (baseBatch.status !== 'completed') {
    throw new Error('基准批次未完成对账，不能创建沙盒');
  }

  const activeCount = await getActiveSandboxCount();
  if (activeCount >= MAX_ACTIVE_SANDBOXES && !backtestPlanId && !sensitivityAnalysisId) {
    throw new Error(`活跃沙盒数量已达上限 ${MAX_ACTIVE_SANDBOXES}，请等待旧沙盒过期或手动删除`);
  }

  const txCount = await Transaction.count({ where: { batchId: baseBatchId } });
  if (txCount === 0) {
    throw new Error('基准批次没有交易记录');
  }
  if (txCount > MAX_RECORDS) {
    throw new Error(`记录数量 ${txCount} 超过上限 ${MAX_RECORDS}`);
  }

  const ttl = ttlHours || DEFAULT_SANDBOX_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000);

  const sandboxName = name || `沙盒-${baseBatch.batchNo}-${Date.now()}`;

  const sandbox = await Sandbox.create({
    name: sandboxName,
    baseBatchId,
    baseBatchNo: baseBatch.batchNo,
    status: 'creating',
    config: config || baseBatch.config || {},
    arbitrationRules: arbitrationRules || null,
    alertThresholds: alertThresholds || null,
    expiresAt,
    createdBy: createdBy || null,
    backtestPlanId: backtestPlanId || null,
    backtestExecutionIndex: backtestExecutionIndex != null ? backtestExecutionIndex : null
  });

  try {
    const transactions = await Transaction.findAll({ where: { batchId: baseBatchId } });
    const sandboxTxs = transactions.map(tx => ({
      sandboxId: sandbox.id,
      dataSourceId: tx.dataSourceId,
      originalTransactionId: tx.id,
      transactionId: tx.transactionId,
      amount: tx.amount,
      currency: tx.currency,
      timestamp: tx.timestamp,
      counterparty: tx.counterparty,
      summary: tx.summary,
      rawData: tx.rawData
    }));

    const chunkSize = 1000;
    for (let i = 0; i < sandboxTxs.length; i += chunkSize) {
      await SandboxTransaction.bulkCreate(sandboxTxs.slice(i, i + chunkSize));
    }

    await sandbox.update({ status: 'ready' });
    broadcastSandboxUpdate(sandbox);
    return sandbox;
  } catch (err) {
    await sandbox.update({ status: 'failed', errorMessage: err.message });
    throw err;
  }
}

async function updateSandboxConfig(sandboxId, updates = {}) {
  const sandbox = await Sandbox.findByPk(sandboxId);
  if (!sandbox) throw new Error('沙盒不存在');
  if (sandbox.status === 'expired' || sandbox.status === 'deleted') {
    throw new Error('沙盒已过期或已删除');
  }
  if (sandbox.status === 'running') {
    throw new Error('沙盒正在执行对账，不能修改参数');
  }

  const allowed = ['config', 'arbitrationRules', 'alertThresholds', 'name', 'expiresAt'];
  const data = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      data[key] = updates[key];
    }
  }

  await sandbox.update(data);
  return sandbox;
}

async function getSandbox(sandboxId) {
  const sandbox = await Sandbox.findByPk(sandboxId, {
    include: [
      { association: 'baseBatch', attributes: ['id', 'batchNo', 'status', 'matchedCount', 'discrepancyCount'] }
    ]
  });
  if (!sandbox) throw new Error('沙盒不存在');
  return sandbox;
}

async function listSandboxes(filters = {}) {
  const where = {};
  if (filters.status) where.status = filters.status;
  if (filters.baseBatchId) where.baseBatchId = filters.baseBatchId;
  if (filters.backtestPlanId) where.backtestPlanId = filters.backtestPlanId;

  const { count, rows } = await Sandbox.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(filters.limit) || 50, 100),
    offset: parseInt(filters.offset) || 0
  });

  return { total: count, data: rows };
}

async function deleteSandbox(sandboxId) {
  const sandbox = await Sandbox.findByPk(sandboxId);
  if (!sandbox) throw new Error('沙盒不存在');
  if (sandbox.status === 'running') {
    throw new Error('沙盒正在执行对账，不能删除');
  }
  await deleteSandboxInternal(sandboxId, false);
}

async function runSandboxReconciliation(sandboxId) {
  const sandbox = await Sandbox.findByPk(sandboxId);
  if (!sandbox) throw new Error('沙盒不存在');
  if (sandbox.status === 'expired' || sandbox.status === 'deleted') {
    throw new Error('沙盒已过期或已删除');
  }
  if (sandbox.status === 'running') {
    throw new Error('沙盒正在执行对账');
  }

  await sandbox.update({ status: 'running', startTime: new Date(), errorMessage: null });
  broadcastSandboxUpdate(sandbox);

  try {
    await SandboxArbitrationTicket.destroy({ where: { sandboxId } });
    await SandboxDiscrepancy.destroy({ where: { sandboxId } });

    const transactions = await SandboxTransaction.findAll({ where: { sandboxId } });
    const dataSources = await DataSource.findAll({ where: { isActive: true } });
    const sourceIds = sandbox.config?.dataSourceIds?.length
      ? sandbox.config.dataSourceIds
      : dataSources.map(ds => ds.id);

    const timeTolerance = sandbox.config?.timeToleranceSeconds ?? 300;
    const amountTolerance = sandbox.config?.amountTolerance ?? 0.01;

    const byTransactionId = {};
    for (const tx of transactions) {
      if (!byTransactionId[tx.transactionId]) {
        byTransactionId[tx.transactionId] = [];
      }
      byTransactionId[tx.transactionId].push(tx);
    }

    const discrepancies = [];
    let matchedCount = 0;

    for (const [txId, txList] of Object.entries(byTransactionId)) {
      const sourceMap = {};
      for (const tx of txList) {
        sourceMap[tx.dataSourceId] = tx;
      }

      const presentSources = Object.keys(sourceMap);
      const missingSources = sourceIds.filter(id => !presentSources.includes(id));

      if (missingSources.length > 0) {
        discrepancies.push({
          id: uuidv4(),
          sandboxId,
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
          sandboxId,
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
          sandboxId,
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

    await SandboxDiscrepancy.bulkCreate(discrepancies);

    for (const disc of discrepancies) {
      await SandboxArbitrationTicket.create({
        sandboxId,
        discrepancyId: disc.id,
        status: 'pending'
      });
    }

    await applySandboxAutoArbitration(sandbox, discrepancies);

    const uniqueCount = matchedCount + discrepancies.length;
    await sandbox.update({
      status: 'completed',
      matchedCount,
      discrepancyCount: discrepancies.length,
      uniqueTransactionCount: uniqueCount,
      endTime: new Date()
    });
    broadcastSandboxUpdate(sandbox);
    return sandbox;
  } catch (err) {
    await sandbox.update({ status: 'failed', errorMessage: err.message, endTime: new Date() });
    broadcastSandboxUpdate(sandbox);
    throw err;
  }
}

async function applySandboxAutoArbitration(sandbox, discrepancies) {
  let rules;
  if (sandbox.arbitrationRules && Array.isArray(sandbox.arbitrationRules) && sandbox.arbitrationRules.length > 0) {
    rules = sandbox.arbitrationRules
      .filter(r => r.isActive !== false)
      .sort((a, b) => (a.priority || 100) - (b.priority || 100));
  } else {
    rules = await ArbitrationRule.findAll({
      where: { isActive: true },
      order: [['priority', 'ASC']]
    });
  }

  const tickets = await SandboxArbitrationTicket.findAll({
    where: { sandboxId: sandbox.id, status: 'pending' },
    include: [{ model: SandboxDiscrepancy, as: 'SandboxDiscrepancy' }]
  });

  for (const ticket of tickets) {
    const disc = ticket.SandboxDiscrepancy;
    if (!disc) continue;
    for (const rule of rules) {
      if (await applySandboxRule(sandbox.id, ticket, disc, rule)) {
        break;
      }
    }
  }
}

async function applySandboxRule(sandboxId, ticket, discrepancy, rule) {
  const condition = rule.condition;

  if (rule.ruleType === 'amount_tolerance') {
    if (discrepancy.type !== 'amount_mismatch') return false;
    const maxDiff = condition.maxDifference || 0.01;
    const amountDiff = parseFloat(discrepancy.amountDiff);
    if (amountDiff <= maxDiff + 0.000001) {
      await resolveSandboxDiscrepancy(sandboxId, ticket.id, {
        resolutionType: 'ignore',
        notes: `自动忽略：金额差异 ${amountDiff.toFixed(4)} 在容差 ${maxDiff} 以内`,
        ruleApplied: rule.name || rule.name
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

    await resolveSandboxDiscrepancy(sandboxId, ticket.id, {
      resolutionType: 'use_source',
      primarySourceId: dataSource.id,
      notes: `自动仲裁：以 ${preferSourceName} 数据为准`,
      ruleApplied: rule.name || rule.name
    });
    return true;
  }

  return false;
}

async function resolveSandboxDiscrepancy(sandboxId, ticketId, options) {
  const ticket = await SandboxArbitrationTicket.findByPk(ticketId, {
    include: [{ model: SandboxDiscrepancy, as: 'SandboxDiscrepancy' }]
  });
  if (!ticket) return;

  const discrepancy = ticket.SandboxDiscrepancy;
  if (!discrepancy) return;

  const allowedStatuses = ['pending', 'pending_review'];
  if (!allowedStatuses.includes(ticket.status)) return;

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

  await ticket.update(updates);

  let discStatus = 'resolved';
  if (options.resolutionType === 'ignore') discStatus = 'ignored';
  if (options.resolutionType === 'manual_review') discStatus = 'pending_review';
  await discrepancy.update({ status: discStatus });
}

async function compareSandboxWithBaseline(sandboxId) {
  const sandbox = await Sandbox.findByPk(sandboxId);
  if (!sandbox) throw new Error('沙盒不存在');
  if (sandbox.status !== 'completed') {
    throw new Error('沙盒对账未完成');
  }

  const baseBatchId = sandbox.baseBatchId;

  const baselineDiscs = await Discrepancy.findAll({
    where: { batchId: baseBatchId },
    include: [{ model: ArbitrationTicket, as: 'ArbitrationTicket' }]
  });
  const sandboxDiscs = await SandboxDiscrepancy.findAll({
    where: { sandboxId },
    include: [{ model: SandboxArbitrationTicket, as: 'SandboxArbitrationTicket' }]
  });

  const baselineMap = new Map();
  for (const d of baselineDiscs) {
    if (d.transactionId) baselineMap.set(d.transactionId, d);
  }
  const sandboxMap = new Map();
  for (const d of sandboxDiscs) {
    if (d.transactionId) sandboxMap.set(d.transactionId, d);
  }

  const disappeared = [];
  const newOnes = [];
  const dispositionChanged = [];

  for (const [txId, baseDisc] of baselineMap.entries()) {
    const sbDisc = sandboxMap.get(txId);
    if (!sbDisc) {
      disappeared.push({
        transactionId: txId,
        baselineType: baseDisc.type,
        baselineDescription: baseDisc.description,
        baselineAmountDiff: baseDisc.amountDiff,
        baselineStatus: baseDisc.status,
        baselineTicketStatus: baseDisc.ArbitrationTicket?.status,
        baselineResolutionType: baseDisc.ArbitrationTicket?.resolutionType,
        baselineRuleApplied: baseDisc.ArbitrationTicket?.ruleApplied
      });
    } else {
      const baseTicket = baseDisc.ArbitrationTicket;
      const sbTicket = sbDisc.SandboxArbitrationTicket;
      if (baseTicket || sbTicket) {
        const baseRes = baseTicket?.resolutionType;
        const sbRes = sbTicket?.resolutionType;
        const baseStatus = baseTicket?.status;
        const sbStatus = sbTicket?.status;
        if (baseRes !== sbRes || baseStatus !== sbStatus) {
          dispositionChanged.push({
            transactionId: txId,
            type: baseDisc.type,
            description: baseDisc.description,
            baselineResolutionType: baseRes,
            baselineTicketStatus: baseStatus,
            baselineRuleApplied: baseTicket?.ruleApplied,
            sandboxResolutionType: sbRes,
            sandboxTicketStatus: sbStatus,
            sandboxRuleApplied: sbTicket?.ruleApplied
          });
        }
      }
      sandboxMap.delete(txId);
    }
  }

  for (const [txId, sbDisc] of sandboxMap.entries()) {
    const sbTicket = sbDisc.SandboxArbitrationTicket;
    newOnes.push({
      transactionId: txId,
      sandboxType: sbDisc.type,
      sandboxDescription: sbDisc.description,
      sandboxAmountDiff: sbDisc.amountDiff,
      sandboxTimeDiffSeconds: sbDisc.timeDiffSeconds,
      sandboxStatus: sbDisc.status,
      sandboxTicketStatus: sbTicket?.status,
      sandboxResolutionType: sbTicket?.resolutionType,
      sandboxRuleApplied: sbTicket?.ruleApplied
    });
  }

  const baseBatch = await ReconciliationBatch.findByPk(baseBatchId);

  return {
    sandboxId,
    baseBatchId,
    baseline: {
      batchNo: baseBatch?.batchNo,
      matchedCount: baseBatch?.matchedCount || 0,
      discrepancyCount: baseBatch?.discrepancyCount || 0,
      uniqueTransactionCount: baseBatch?.uniqueTransactionCount || 0
    },
    sandbox: {
      matchedCount: sandbox.matchedCount,
      discrepancyCount: sandbox.discrepancyCount,
      uniqueTransactionCount: sandbox.uniqueTransactionCount
    },
    summary: {
      newDiscrepancies: {
        count: newOnes.length,
        items: newOnes.slice(0, 10)
      },
      disappearedDiscrepancies: {
        count: disappeared.length,
        items: disappeared.slice(0, 10)
      },
      dispositionChanges: {
        count: dispositionChanged.length,
        items: dispositionChanged.slice(0, 10)
      }
    }
  };
}

async function getSandboxDiscrepancies(sandboxId, filters = {}) {
  const where = { sandboxId };
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;

  const { count, rows } = await SandboxDiscrepancy.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(filters.limit) || 50, 200),
    offset: parseInt(filters.offset) || 0
  });
  return { total: count, data: rows };
}

async function getSandboxTickets(sandboxId, filters = {}) {
  const where = { sandboxId };
  if (filters.status) where.status = filters.status;

  const { count, rows } = await SandboxArbitrationTicket.findAndCountAll({
    where,
    include: [{ model: SandboxDiscrepancy, as: 'SandboxDiscrepancy' }],
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(filters.limit) || 50, 200),
    offset: parseInt(filters.offset) || 0
  });
  return { total: count, data: rows };
}

module.exports = {
  setWsBroadcast,
  start,
  stop,
  createSandbox,
  updateSandboxConfig,
  getSandbox,
  listSandboxes,
  deleteSandbox,
  deleteSandboxInternal,
  runSandboxReconciliation,
  compareSandboxWithBaseline,
  getSandboxDiscrepancies,
  getSandboxTickets,
  getActiveSandboxCount,
  cleanupExpiredSandboxes,
  MAX_ACTIVE_SANDBOXES
};
