const reconciliationService = require('../services/reconciliationService');
const arbitrationService = require('../services/arbitrationService');
const { ReconciliationBatch, Discrepancy } = require('../models');

async function createBatch(req, res) {
  try {
    const batch = await reconciliationService.createBatch(req.body);
    res.status(201).json(batch);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function triggerReconciliation(req, res) {
  try {
    const { batchId } = req.params;
    const { autoArbitrate = true } = req.body || {};

    await reconciliationService.triggerReconciliation(batchId);

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
    res.json(batch);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function getBatches(req, res) {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const where = {};
    if (status) where.status = status;

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
    const { batchId, type, status, dataSourceId, limit = 100, offset = 0 } = req.query;
    const where = {};
    if (batchId) where.batchId = batchId;
    if (type) where.type = type;
    if (status) where.status = status;

    const { count, rows } = await Discrepancy.findAndCountAll({
      where,
      limit: Math.min(parseInt(limit), 500),
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
