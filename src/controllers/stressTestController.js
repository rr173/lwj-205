const stressTestService = require('../services/stressTestService');

async function createPlan(req, res) {
  try {
    const plan = await stressTestService.createStressTestPlan({
      name: req.body.name,
      description: req.body.description,
      dataSourceCount: req.body.dataSourceCount,
      recordsPerSource: req.body.recordsPerSource,
      discrepancyRatio: req.body.discrepancyRatio,
      discrepancyTypeWeights: req.body.discrepancyTypeWeights,
      concurrentBatches: req.body.concurrentBatches,
      config: req.body.config,
      createdBy: req.user?.username || null
    });
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function listPlans(req, res) {
  try {
    const result = await stressTestService.listStressTestPlans(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getPlan(req, res) {
  try {
    const plan = await stressTestService.getStressTestPlan(req.params.planId);
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
}

async function triggerPlan(req, res) {
  try {
    const plan = await stressTestService.triggerStressTestPlan(req.params.planId);
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function cancelPlan(req, res) {
  try {
    const plan = await stressTestService.cancelStressTestPlan(req.params.planId);
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function getCapacityReport(req, res) {
  try {
    const report = await stressTestService.getCapacityReport(req.params.planId);
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function getBatchMetrics(req, res) {
  try {
    const result = await stressTestService.getBatchMetrics(req.params.planId, req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getActiveStatus(req, res) {
  try {
    const status = stressTestService.getActiveStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  createPlan,
  listPlans,
  getPlan,
  triggerPlan,
  cancelPlan,
  getCapacityReport,
  getBatchMetrics,
  getActiveStatus
};
