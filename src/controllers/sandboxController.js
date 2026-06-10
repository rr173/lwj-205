const sandboxService = require('../services/sandboxService');
const { Sandbox, ReconciliationBatch } = require('../models');

async function createSandbox(req, res) {
  try {
    const sandbox = await sandboxService.createSandbox({
      baseBatchId: req.body.baseBatchId,
      name: req.body.name,
      config: req.body.config,
      arbitrationRules: req.body.arbitrationRules,
      alertThresholds: req.body.alertThresholds,
      ttlHours: req.body.ttlHours,
      createdBy: req.user?.username || null
    });
    res.json({ success: true, data: sandbox });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function listSandboxes(req, res) {
  try {
    const result = await sandboxService.listSandboxes(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getSandbox(req, res) {
  try {
    const sandbox = await sandboxService.getSandbox(req.params.sandboxId);
    res.json({ success: true, data: sandbox });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
}

async function updateSandbox(req, res) {
  try {
    const sandbox = await sandboxService.updateSandboxConfig(req.params.sandboxId, req.body);
    res.json({ success: true, data: sandbox });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function deleteSandbox(req, res) {
  try {
    await sandboxService.deleteSandbox(req.params.sandboxId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function triggerReconciliation(req, res) {
  try {
    const sandbox = await sandboxService.runSandboxReconciliation(req.params.sandboxId);
    res.json({ success: true, data: sandbox });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function compareWithBaseline(req, res) {
  try {
    const result = await sandboxService.compareSandboxWithBaseline(req.params.sandboxId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function getDiscrepancies(req, res) {
  try {
    const result = await sandboxService.getSandboxDiscrepancies(req.params.sandboxId, req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getTickets(req, res) {
  try {
    const result = await sandboxService.getSandboxTickets(req.params.sandboxId, req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getActiveLimit(req, res) {
  try {
    const activeCount = await sandboxService.getActiveSandboxCount();
    res.json({
      success: true,
      data: {
        activeCount,
        maxLimit: sandboxService.MAX_ACTIVE_SANDBOXES,
        remaining: Math.max(0, sandboxService.MAX_ACTIVE_SANDBOXES - activeCount)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  createSandbox,
  listSandboxes,
  getSandbox,
  updateSandbox,
  deleteSandbox,
  triggerReconciliation,
  compareWithBaseline,
  getDiscrepancies,
  getTickets,
  getActiveLimit
};
