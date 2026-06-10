const { Op } = require('sequelize');
const {
  sequelize,
  ReconciliationBatch,
  Transaction,
  Discrepancy,
  ArbitrationTicket,
  AdjustmentInstruction,
  TransactionArchive,
  DiscrepancyArchive,
  ArbitrationTicketArchive,
  AdjustmentInstructionArchive,
  ArchiveConfig,
  AuditLog,
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

async function ensureDefaultConfig() {
  const existing = await ArchiveConfig.count();
  if (existing > 0) return null;

  return await ArchiveConfig.create({
    id: require('uuid').v4(),
    name: '默认归档策略',
    description: '系统默认归档配置，超过30天的已完成批次自动归档',
    retentionDays: 30,
    autoArchiveEnabled: true,
    dailyRunHour: 4,
    batchStatusFilter: ['completed'],
    isActive: true
  });
}

async function createConfig(data, operator = 'system') {
  const config = await ArchiveConfig.create(data);
  await AuditLog.create({
    operator,
    role: 'admin',
    action: 'CREATE',
    targetType: 'archive_config',
    targetId: config.id,
    afterValue: config.toJSON()
  });
  return config;
}

async function updateConfig(configId, data, operator = 'system') {
  const config = await ArchiveConfig.findByPk(configId);
  if (!config) throw new Error('归档配置不存在');

  const beforeValue = config.toJSON();
  await config.update(data);
  const afterValue = config.toJSON();

  await AuditLog.create({
    operator,
    role: 'admin',
    action: 'UPDATE',
    targetType: 'archive_config',
    targetId: config.id,
    beforeValue,
    afterValue
  });
  return config;
}

async function deleteConfig(configId, operator = 'system') {
  const config = await ArchiveConfig.findByPk(configId);
  if (!config) throw new Error('归档配置不存在');

  const beforeValue = config.toJSON();
  await config.destroy();

  await AuditLog.create({
    operator,
    role: 'admin',
    action: 'DELETE',
    targetType: 'archive_config',
    targetId: config.id,
    beforeValue
  });
  return { message: '归档配置已删除' };
}

async function getConfig(configId) {
  const config = await ArchiveConfig.findByPk(configId);
  if (!config) throw new Error('归档配置不存在');
  return config;
}

async function listConfigs(filters = {}) {
  const where = {};
  if (filters.isActive !== undefined) where.isActive = filters.isActive === 'true';

  const { count, rows } = await ArchiveConfig.findAndCountAll({
    where,
    limit: Math.min(parseInt(filters.limit) || 100, 500),
    offset: parseInt(filters.offset) || 0,
    order: [['createdAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getActiveConfig() {
  const config = await ArchiveConfig.findOne({
    where: { isActive: true, autoArchiveEnabled: true },
    order: [['createdAt', 'DESC']]
  });
  return config;
}

async function acquireBatchLock(batchId) {
  const batch = await ReconciliationBatch.findByPk(batchId);
  if (!batch) throw new Error('批次不存在');

  if (batch.archiveLock) {
    throw new Error('该批次正在进行归档/回迁操作，请稍后重试');
  }

  const [affectedCount] = await ReconciliationBatch.update(
    { archiveLock: true },
    {
      where: { id: batchId, archiveLock: false }
    }
  );

  if (affectedCount === 0) {
    throw new Error('该批次正在进行归档/回迁操作，请稍后重试');
  }

  const lockedBatch = await ReconciliationBatch.findByPk(batchId);
  return lockedBatch;
}

async function releaseBatchLock(batchId) {
  await ReconciliationBatch.update(
    { archiveLock: false },
    { where: { id: batchId } }
  );
}

async function archiveBatch(batchId, operator = 'system') {
  const transaction = await sequelize.transaction();
  let batch = null;

  try {
    batch = await acquireBatchLock(batchId);

    if (batch.isArchived) {
      throw new Error('该批次已归档，无需重复操作');
    }

    if (batch.status === 'running') {
      throw new Error('批次正在对账中，不能归档');
    }

    const archivedAt = new Date();

    const transactions = await Transaction.findAll({ where: { batchId }, transaction });
    const discrepancies = await Discrepancy.findAll({ where: { batchId }, transaction });
    const tickets = await ArbitrationTicket.findAll({ where: { batchId }, transaction });
    const adjustments = await AdjustmentInstruction.findAll({ where: { batchId }, transaction });

    if (transactions.length > 0) {
      const txArchiveData = transactions.map(t => {
        const json = t.toJSON();
        delete json.createdAt;
        delete json.updatedAt;
        return { ...json, archivedAt };
      });
      await TransactionArchive.bulkCreate(txArchiveData, { transaction });
    }

    if (discrepancies.length > 0) {
      const discArchiveData = discrepancies.map(d => {
        const json = d.toJSON();
        delete json.createdAt;
        delete json.updatedAt;
        return { ...json, archivedAt };
      });
      await DiscrepancyArchive.bulkCreate(discArchiveData, { transaction });
    }

    if (tickets.length > 0) {
      const ticketArchiveData = tickets.map(t => {
        const json = t.toJSON();
        delete json.createdAt;
        delete json.updatedAt;
        return { ...json, archivedAt };
      });
      await ArbitrationTicketArchive.bulkCreate(ticketArchiveData, { transaction });
    }

    if (adjustments.length > 0) {
      const adjArchiveData = adjustments.map(a => {
        const json = a.toJSON();
        delete json.createdAt;
        delete json.updatedAt;
        return { ...json, archivedAt };
      });
      await AdjustmentInstructionArchive.bulkCreate(adjArchiveData, { transaction });
    }

    if (adjustments.length > 0) await AdjustmentInstruction.destroy({ where: { batchId }, transaction });
    if (tickets.length > 0) await ArbitrationTicket.destroy({ where: { batchId }, transaction });
    if (discrepancies.length > 0) await Discrepancy.destroy({ where: { batchId }, transaction });
    if (transactions.length > 0) await Transaction.destroy({ where: { batchId }, transaction });

    await ReconciliationBatch.update(
      { isArchived: true, archivedAt, archiveLock: false },
      { where: { id: batchId }, transaction }
    );

    await AuditLog.create({
      operator,
      role: operator === 'system' ? 'system' : 'admin',
      action: 'ARCHIVE',
      targetType: 'reconciliation_batch',
      targetId: batchId,
      beforeValue: { batchNo: batch.batchNo, isArchived: false },
      afterValue: { batchNo: batch.batchNo, isArchived: true, archivedAt }
    }, { transaction });

    await transaction.commit();

    const alert = await AlertEvent.create({
      type: 'archive_complete',
      severity: 'info',
      title: '批次归档完成',
      message: `对账批次「${batch.batchNo}」已成功归档，包含 ${transactions.length} 条交易记录，${discrepancies.length} 条差异记录`,
      batchId,
      batchNo: batch.batchNo,
      metric: {
        transactionCount: transactions.length,
        discrepancyCount: discrepancies.length,
        ticketCount: tickets.length,
        adjustmentCount: adjustments.length,
        archivedAt
      }
    });

    broadcastMessage({
      type: 'alert',
      data: alert.toJSON()
    });

    broadcastMessage({
      type: 'archive_complete',
      data: {
        batchId,
        batchNo: batch.batchNo,
        archivedAt,
        transactionCount: transactions.length,
        discrepancyCount: discrepancies.length
      }
    });

    const updatedBatch = await ReconciliationBatch.findByPk(batchId);
    return {
      message: '归档成功',
      batch: updatedBatch,
      stats: {
        transactionCount: transactions.length,
        discrepancyCount: discrepancies.length,
        ticketCount: tickets.length,
        adjustmentCount: adjustments.length
      }
    };

  } catch (err) {
    await transaction.rollback();
    if (batch) {
      await releaseBatchLock(batchId);
    }
    console.error(`[Archive] 归档批次 ${batchId} 失败:`, err.message);
    throw err;
  }
}

async function restoreBatch(batchId, operator = 'system') {
  const transaction = await sequelize.transaction();
  let batch = null;

  try {
    batch = await acquireBatchLock(batchId);

    if (!batch.isArchived) {
      throw new Error('该批次未归档，无需回迁');
    }

    const archivedTransactions = await TransactionArchive.findAll({ where: { batchId }, transaction });
    const archivedDiscrepancies = await DiscrepancyArchive.findAll({ where: { batchId }, transaction });
    const archivedTickets = await ArbitrationTicketArchive.findAll({ where: { batchId }, transaction });
    const archivedAdjustments = await AdjustmentInstructionArchive.findAll({ where: { batchId }, transaction });

    if (archivedTransactions.length > 0) {
      const txRestoreData = archivedTransactions.map(t => {
        const json = t.toJSON();
        delete json.archivedAt;
        return json;
      });
      await Transaction.bulkCreate(txRestoreData, { transaction });
    }

    if (archivedDiscrepancies.length > 0) {
      const discRestoreData = archivedDiscrepancies.map(d => {
        const json = d.toJSON();
        delete json.archivedAt;
        return json;
      });
      await Discrepancy.bulkCreate(discRestoreData, { transaction });
    }

    if (archivedTickets.length > 0) {
      const ticketRestoreData = archivedTickets.map(t => {
        const json = t.toJSON();
        delete json.archivedAt;
        return json;
      });
      await ArbitrationTicket.bulkCreate(ticketRestoreData, { transaction });
    }

    if (archivedAdjustments.length > 0) {
      const adjRestoreData = archivedAdjustments.map(a => {
        const json = a.toJSON();
        delete json.archivedAt;
        return json;
      });
      await AdjustmentInstruction.bulkCreate(adjRestoreData, { transaction });
    }

    if (archivedAdjustments.length > 0) await AdjustmentInstructionArchive.destroy({ where: { batchId }, transaction });
    if (archivedTickets.length > 0) await ArbitrationTicketArchive.destroy({ where: { batchId }, transaction });
    if (archivedDiscrepancies.length > 0) await DiscrepancyArchive.destroy({ where: { batchId }, transaction });
    if (archivedTransactions.length > 0) await TransactionArchive.destroy({ where: { batchId }, transaction });

    await ReconciliationBatch.update(
      { isArchived: false, archivedAt: null, archiveLock: false },
      { where: { id: batchId }, transaction }
    );

    await AuditLog.create({
      operator,
      role: operator === 'system' ? 'system' : 'admin',
      action: 'RESTORE',
      targetType: 'reconciliation_batch',
      targetId: batchId,
      beforeValue: { batchNo: batch.batchNo, isArchived: true },
      afterValue: { batchNo: batch.batchNo, isArchived: false }
    }, { transaction });

    await transaction.commit();

    const alert = await AlertEvent.create({
      type: 'restore_complete',
      severity: 'info',
      title: '批次回迁完成',
      message: `对账批次「${batch.batchNo}」已成功回迁到主表`,
      batchId,
      batchNo: batch.batchNo,
      metric: {
        transactionCount: archivedTransactions.length,
        discrepancyCount: archivedDiscrepancies.length,
        ticketCount: archivedTickets.length,
        adjustmentCount: archivedAdjustments.length,
        restoredAt: new Date()
      }
    });

    broadcastMessage({
      type: 'alert',
      data: alert.toJSON()
    });

    const updatedBatch = await ReconciliationBatch.findByPk(batchId);
    return {
      message: '回迁成功',
      batch: updatedBatch,
      stats: {
        transactionCount: archivedTransactions.length,
        discrepancyCount: archivedDiscrepancies.length,
        ticketCount: archivedTickets.length,
        adjustmentCount: archivedAdjustments.length
      }
    };

  } catch (err) {
    await transaction.rollback();
    if (batch) {
      await releaseBatchLock(batchId);
    }
    console.error(`[Archive] 回迁批次 ${batchId} 失败:`, err.message);
    throw err;
  }
}

async function findBatchesToArchive() {
  const config = await getActiveConfig();
  if (!config) return [];

  const retentionDays = config.retentionDays || 30;
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const statusFilter = config.batchStatusFilter || ['completed'];

  const batches = await ReconciliationBatch.findAll({
    where: {
      isArchived: false,
      archiveLock: false,
      status: { [Op.in]: statusFilter },
      createdAt: { [Op.lte]: cutoffDate }
    },
    order: [['createdAt', 'ASC']]
  });

  return batches;
}

async function runAutoArchive() {
  const batches = await findBatchesToArchive();
  if (batches.length === 0) {
    console.log('[Archive] 没有需要自动归档的批次');
    return { archived: 0, total: 0 };
  }

  console.log(`[Archive] 发现 ${batches.length} 个待归档批次`);
  const results = [];

  for (const batch of batches) {
    try {
      const result = await archiveBatch(batch.id, 'system');
      results.push({ batchId: batch.id, batchNo: batch.batchNo, success: true, ...result.stats });
      console.log(`[Archive] 自动归档批次 ${batch.batchNo} 完成`);
    } catch (err) {
      results.push({ batchId: batch.id, batchNo: batch.batchNo, success: false, error: err.message });
      console.error(`[Archive] 自动归档批次 ${batch.batchNo} 失败:`, err.message);
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`[Archive] 自动归档执行完成，成功 ${successCount}/${batches.length}`);

  return {
    archived: successCount,
    total: batches.length,
    details: results
  };
}

async function getArchivedBatches(filters = {}) {
  const where = { isArchived: true };
  if (filters.batchNo) where.batchNo = { [Op.like]: `%${filters.batchNo}%` };

  if (filters.startDate || filters.endDate) {
    where.archivedAt = {};
    if (filters.startDate) where.archivedAt[Op.gte] = new Date(filters.startDate);
    if (filters.endDate) where.archivedAt[Op.lte] = new Date(filters.endDate);
  }

  if (filters.dataSourceId) {
    const batchIds = await TransactionArchive.findAll({
      where: { dataSourceId: filters.dataSourceId },
      attributes: ['batchId'],
      group: ['batchId']
    });
    const ids = batchIds.map(b => b.batchId);
    if (ids.length === 0) {
      return { total: 0, data: [] };
    }
    where.id = { [Op.in]: ids };
  }

  const { count, rows } = await ReconciliationBatch.findAndCountAll({
    where,
    limit: Math.min(parseInt(filters.limit) || 50, 200),
    offset: parseInt(filters.offset) || 0,
    order: [['archivedAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getArchivedTransactions(filters = {}) {
  const where = {};
  if (filters.batchId) where.batchId = filters.batchId;
  if (filters.dataSourceId) where.dataSourceId = filters.dataSourceId;
  if (filters.transactionId) where.transactionId = filters.transactionId;

  if (filters.startDate || filters.endDate) {
    where.archivedAt = {};
    if (filters.startDate) where.archivedAt[Op.gte] = new Date(filters.startDate);
    if (filters.endDate) where.archivedAt[Op.lte] = new Date(filters.endDate);
  }

  const include = [];
  if (filters.includeBatch) {
    include.push({ model: ReconciliationBatch, as: 'batch' });
  }

  const { count, rows } = await TransactionArchive.findAndCountAll({
    where,
    include,
    limit: Math.min(parseInt(filters.limit) || 100, 1000),
    offset: parseInt(filters.offset) || 0,
    order: [['archivedAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getArchivedDiscrepancies(filters = {}) {
  const where = {};
  if (filters.batchId) where.batchId = filters.batchId;
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;

  if (filters.startDate || filters.endDate) {
    where.archivedAt = {};
    if (filters.startDate) where.archivedAt[Op.gte] = new Date(filters.startDate);
    if (filters.endDate) where.archivedAt[Op.lte] = new Date(filters.endDate);
  }

  const { count, rows } = await DiscrepancyArchive.findAndCountAll({
    where,
    limit: Math.min(parseInt(filters.limit) || 100, 500),
    offset: parseInt(filters.offset) || 0,
    order: [['archivedAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getArchivedTickets(filters = {}) {
  const where = {};
  if (filters.batchId) where.batchId = filters.batchId;
  if (filters.status) where.status = filters.status;

  if (filters.startDate || filters.endDate) {
    where.archivedAt = {};
    if (filters.startDate) where.archivedAt[Op.gte] = new Date(filters.startDate);
    if (filters.endDate) where.archivedAt[Op.lte] = new Date(filters.endDate);
  }

  const { count, rows } = await ArbitrationTicketArchive.findAndCountAll({
    where,
    limit: Math.min(parseInt(filters.limit) || 100, 500),
    offset: parseInt(filters.offset) || 0,
    order: [['archivedAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getArchiveStats() {
  const archivedBatchCount = await ReconciliationBatch.count({ where: { isArchived: true } });
  const activeBatchCount = await ReconciliationBatch.count({ where: { isArchived: false } });
  const archivedTxCount = await TransactionArchive.count();
  const archivedDiscCount = await DiscrepancyArchive.count();
  const archivedTicketCount = await ArbitrationTicketArchive.count();
  const activeTxCount = await Transaction.count();
  const activeDiscCount = await Discrepancy.count();
  const activeTicketCount = await ArbitrationTicket.count();

  const config = await getActiveConfig();

  return {
    batches: {
      archived: archivedBatchCount,
      active: activeBatchCount,
      archiveRatio: archivedBatchCount + activeBatchCount > 0
        ? (archivedBatchCount / (archivedBatchCount + activeBatchCount)).toFixed(4)
        : 0
    },
    transactions: {
      archived: archivedTxCount,
      active: activeTxCount
    },
    discrepancies: {
      archived: archivedDiscCount,
      active: activeDiscCount
    },
    tickets: {
      archived: archivedTicketCount,
      active: activeTicketCount
    },
    activeConfig: config ? {
      name: config.name,
      retentionDays: config.retentionDays,
      dailyRunHour: config.dailyRunHour,
      autoArchiveEnabled: config.autoArchiveEnabled
    } : null
  };
}

module.exports = {
  setWsBroadcast,
  ensureDefaultConfig,
  createConfig,
  updateConfig,
  deleteConfig,
  getConfig,
  listConfigs,
  getActiveConfig,
  archiveBatch,
  restoreBatch,
  findBatchesToArchive,
  runAutoArchive,
  getArchivedBatches,
  getArchivedTransactions,
  getArchivedDiscrepancies,
  getArchivedTickets,
  getArchiveStats
};
