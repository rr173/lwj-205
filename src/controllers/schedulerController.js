const schedulerService = require('../services/schedulerService');
const quotaService = require('../services/quotaService');
const { getCurrentTenantId } = require('../utils/tenantContext');

async function createPlan(req, res) {
  try {
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      return res.status(400).json({ error: '租户上下文不存在' });
    }

    const plan = await quotaService.withTenantWriteLock(tenantId, async () => {
      const quota = await quotaService.getTenantQuotas(tenantId);
      const { SchedulePlan } = require('../models');
      const currentCount = await SchedulePlan.count({
        where: { tenantId, isActive: true, isDeleted: false }
      });
      if (currentCount + 1 > quota.maxActiveSchedulePlans) {
        throw new quotaService.QuotaExceededError('maxActiveSchedulePlans', currentCount + 1, quota.maxActiveSchedulePlans);
      }
      return schedulerService.createPlan(req.body);
    });
    res.status(201).json(plan);
  } catch (err) {
    if (err instanceof quotaService.QuotaExceededError) {
      return res.status(429).json({
        error: '配额超限',
        quota: err.quotaName,
        used: err.used,
        limit: err.limit,
        message: err.message
      });
    }
    res.status(400).json({ error: err.message });
  }
}

async function updatePlan(req, res) {
  try {
    const plan = await schedulerService.updatePlan(req.params.planId, req.body);
    res.json(plan);
  } catch (err) {
    const status = err.message.includes('不存在') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function deletePlan(req, res) {
  try {
    const result = await schedulerService.deletePlan(req.params.planId);
    res.json(result);
  } catch (err) {
    const status = err.message.includes('不存在') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function getPlan(req, res) {
  try {
    const plan = await schedulerService.getPlan(req.params.planId);
    res.json(plan);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function listPlans(req, res) {
  try {
    const result = await schedulerService.listPlans(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function pausePlan(req, res) {
  try {
    const plan = await schedulerService.pausePlan(req.params.planId);
    res.json(plan);
  } catch (err) {
    const status = err.message.includes('不存在') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function resumePlan(req, res) {
  try {
    const plan = await schedulerService.resumePlan(req.params.planId);
    res.json(plan);
  } catch (err) {
    const status = err.message.includes('不存在') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function triggerNow(req, res) {
  try {
    const plan = await schedulerService.triggerNow(req.params.planId);
    res.json({ message: '对账已手动触发', plan });
  } catch (err) {
    const status = err.message.includes('不存在') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function getExecutions(req, res) {
  try {
    const result = await schedulerService.getExecutions(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getSlaCompliance(req, res) {
  try {
    const result = await schedulerService.getSlaComplianceRate(req.params.planId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getOverview(req, res) {
  try {
    const overview = await schedulerService.getOverview();
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  createPlan,
  updatePlan,
  deletePlan,
  getPlan,
  listPlans,
  pausePlan,
  resumePlan,
  triggerNow,
  getExecutions,
  getSlaCompliance,
  getOverview
};
