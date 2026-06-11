const reconciliationService = require('../services/reconciliationService');
const arbitrationService = require('../services/arbitrationService');
const archiveService = require('../services/archiveService');
const { ReconciliationBatch, Discrepancy, DiscrepancyArchive } = require('../models');

async function createBatch(req, res) {
  try {
    const createdBy = req.user?.id || null;
    const batch = await reconciliationService.createBatch(req.body, createdBy);
    res.status(201).json(batch);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function triggerReconciliation(req, res) {
  try {
    const { batchId } = req.params;
    const { autoArbitrate = true, force = false } = req.body || {};

    await reconciliationService.triggerReconciliation(batchId, force);

    if (autoArbitrate) {
      await arbitrationService.applyAutoArbitration(batchId);
    }

    const batch = await reconciliationService.getBatchStatus(batchId);
    res.json({
      message: '对账任务已完成',
      batch
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function getBatchStatus(req, res) {
  try {
    const { batchId } = req.params;
    const batch = await reconciliationService.getBatchStatus(batchId);

    const result = batch.toJSON();
    if (result.isArchived) {
      const txCount = await require('../models').TransactionArchive.count({ where: { batchId } });
      const discCount = await DiscrepancyArchive.count({ where: { batchId } });
      const ticketCount = await require('../models').ArbitrationTicketArchive.count({ where: { batchId } });
      result.archiveInfo = {
        transactionCount: txCount,
        discrepancyCount: discCount,
        ticketCount,
        archivedAt: result.archivedAt
      };
    }

    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function getBatches(req, res) {
  try {
    const { status, limit = 50, offset = 0, includeArchived = 'false', isArchived } = req.query;
    const where = {};
    if (status) where.status = status;

    if (isArchived !== undefined) {
      where.isArchived = isArchived === 'true';
    } else if (includeArchived !== 'true') {
      where.isArchived = false;
    }

    const { count, rows } = await ReconciliationBatch.findAndCountAll({
      where,
      limit: Math.min(parseInt(limit), 200),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      total: count,
      data: rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getDiscrepancies(req, res) {
  try {
    const { batchId, type, status, dataSourceId, limit = 100, offset = 0, useArchive = 'false' } = req.query;
    const where = {};
    if (batchId) where.batchId = batchId;
    if (type) where.type = type;
    if (status) where.status = status;

    let Model = Discrepancy;
    if (useArchive === 'true') {
      Model = DiscrepancyArchive;
    }

    const { count, rows } = await Model.findAndCountAll({
      where,
      limit: Math.min(parseInt(limit), 500),
      offset: parseInt(offset),
      order: [[useArchive === 'true' ? 'archivedAt' : 'createdAt', 'DESC']]
    });

    res.json({
      total: count,
      data: rows,
      source: useArchive === 'true' ? 'archive' : 'main'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getQueueStatus(req, res) {
  try {
    const status = await reconciliationService.getQueueStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  createBatch,
  triggerReconciliation,
  getBatchStatus,
  getBatches,
  getDiscrepancies,
  getQueueStatus
};
