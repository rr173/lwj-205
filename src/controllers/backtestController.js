const backtestService = require('../services/backtestService');

async function createPlan(req, res) {
  try {
    const plan = await backtestService.createBacktestPlan({
      name: req.body.name,
      description: req.body.description,
      batchIds: req.body.batchIds,
      configSnapshot: req.body.configSnapshot,
      arbitrationRulesSnapshot: req.body.arbitrationRulesSnapshot,
      alertThresholdsSnapshot: req.body.alertThresholdsSnapshot,
      createdBy: req.user?.username || null
    });
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function listPlans(req, res) {
  try {
    const result = await backtestService.listBacktestPlans(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getPlan(req, res) {
  try {
    const plan = await backtestService.getBacktestPlan(req.params.planId);
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
}

async function triggerPlan(req, res) {
  try {
    const plan = await backtestService.triggerBacktestPlan(req.params.planId);
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function cancelPlan(req, res) {
  try {
    const plan = await backtestService.cancelBacktestPlan(req.params.planId);
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function getSummary(req, res) {
  try {
    const summary = await backtestService.getBacktestSummary(req.params.planId);
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function getExecutions(req, res) {
  try {
    const result = await backtestService.getBacktestExecutions(req.params.planId, req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getExecutionDetail(req, res) {
  try {
    const execution = await backtestService.getBacktestExecutionDetail(req.params.executionId);
    res.json({ success: true, data: execution });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
}

module.exports = {
  createPlan,
  listPlans,
  getPlan,
  triggerPlan,
  cancelPlan,
  getSummary,
  getExecutions,
  getExecutionDetail
};
