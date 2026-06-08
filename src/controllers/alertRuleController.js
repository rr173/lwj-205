const alertRuleService = require('../services/alertRuleService');

async function getRules(req, res) {
  try {
    const rules = await alertRuleService.getRulesWithDataSourceInfo(req.query);
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getRuleById(req, res) {
  try {
    const rule = await alertRuleService.getRuleById(req.params.ruleId);
    if (!rule) return res.status(404).json({ error: '规则不存在' });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createRule(req, res) {
  try {
    const operator = req.body.operator || req.headers['x-operator'] || 'admin';
    const rule = await alertRuleService.createRule(req.body, operator);
    res.status(201).json(rule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function updateRule(req, res) {
  try {
    const operator = req.body.operator || req.headers['x-operator'] || 'admin';
    const rule = await alertRuleService.updateRule(req.params.ruleId, req.body, operator);
    res.json(rule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function toggleRule(req, res) {
  try {
    const operator = req.body.operator || req.headers['x-operator'] || 'admin';
    const rule = await alertRuleService.toggleRule(req.params.ruleId, operator);
    res.json(rule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function deleteRule(req, res) {
  try {
    const operator = req.body.operator || req.headers['x-operator'] || 'admin';
    const result = await alertRuleService.deleteRule(req.params.ruleId, operator);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function getRuleHistory(req, res) {
  try {
    const history = await alertRuleService.getRuleHistory(req.query);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function resolveEffectiveRules(req, res) {
  try {
    const { dataSourceId } = req.query;
    const rules = await alertRuleService.resolveAllEffectiveRules(dataSourceId || null);
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getRules,
  getRuleById,
  createRule,
  updateRule,
  toggleRule,
  deleteRule,
  getRuleHistory,
  resolveEffectiveRules
};
