const disposalPlanService = require('../services/disposalPlanService');

async function createPlan(req, res) {
  try {
    const operator = req.user ? req.user.id : 'anonymous';
    const role = req.user ? req.user.role : 'viewer';
    const plan = await disposalPlanService.createPlan(req.body, operator, role);
    res.status(201).json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function listPlans(req, res) {
  try {
    const result = await disposalPlanService.listPlans(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPlan(req, res) {
  try {
    const plan = await disposalPlanService.getPlan(req.params.planId);
    res.json(plan);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function updatePlan(req, res) {
  try {
    const operator = req.user ? req.user.id : 'anonymous';
    const role = req.user ? req.user.role : 'viewer';
    const plan = await disposalPlanService.updatePlan(req.params.planId, req.body, operator, role);
    res.json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function enablePlan(req, res) {
  try {
    const operator = req.user ? req.user.id : 'anonymous';
    const role = req.user ? req.user.role : 'viewer';
    const plan = await disposalPlanService.enablePlan(req.params.planId, operator, role);
    res.json({ message: '预案已启用', plan });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function disablePlan(req, res) {
  try {
    const operator = req.user ? req.user.id : 'anonymous';
    const role = req.user ? req.user.role : 'viewer';
    const plan = await disposalPlanService.disablePlan(req.params.planId, operator, role);
    res.json({ message: '预案已禁用', plan });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function deletePlan(req, res) {
  try {
    const operator = req.user ? req.user.id : 'anonymous';
    const role = req.user ? req.user.role : 'viewer';
    await disposalPlanService.deletePlan(req.params.planId, operator, role);
    res.json({ message: '预案已删除' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function executeAutoDisposal(req, res) {
  try {
    const { batchId } = req.params;
    const result = await disposalPlanService.executeAutoDisposalForBatch(batchId);
    res.json({
      message: '预案自动处置完成',
      ...result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPlanEffectAnalysis(req, res) {
  try {
    const { startDate, endDate } = req.query;
    const result = await disposalPlanService.getPlanEffectAnalysis(startDate, endDate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function markInefficientPlans(req, res) {
  try {
    const result = await disposalPlanService.markInefficientPlans();
    res.json({
      message: '低效预案标记完成',
      ...result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  createPlan,
  listPlans,
  getPlan,
  updatePlan,
  enablePlan,
  disablePlan,
  deletePlan,
  executeAutoDisposal,
  getPlanEffectAnalysis,
  markInefficientPlans
};
