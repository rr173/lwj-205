const arbitrationService = require('../services/arbitrationService');

async function resolveTicket(req, res) {
  try {
    const { ticketId } = req.params;
    const { resolutionType, primarySourceId, notes, resolvedBy } = req.body;

    if (!['use_source', 'manual_review', 'ignore', 'manually_resolved'].includes(resolutionType)) {
      return res.status(400).json({ error: '无效的处置类型' });
    }

    if (resolutionType === 'use_source' && !primarySourceId) {
      return res.status(400).json({ error: '选择数据源为准时必须提供 primarySourceId' });
    }

    const ticket = await arbitrationService.resolveDiscrepancy(ticketId, {
      resolutionType,
      primarySourceId,
      notes,
      resolvedBy: resolvedBy || 'manual'
    });

    res.json({
      message: '处置完成',
      ticket
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function applyAutoArbitration(req, res) {
  try {
    const { batchId } = req.params;
    const results = await arbitrationService.applyAutoArbitration(batchId);

    res.json({
      message: '自动仲裁完成',
      processed: results.length,
      resolved: results.filter(r => r.resolved).length,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getTickets(req, res) {
  try {
    const tickets = await arbitrationService.getTickets(req.query);
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getAdjustmentInstructions(req, res) {
  try {
    const instructions = await arbitrationService.getAdjustmentInstructions(req.query);
    res.json(instructions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getRules(req, res) {
  try {
    const rules = await arbitrationService.getRules();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createRule(req, res) {
  try {
    const rule = await arbitrationService.createRule(req.body);
    res.status(201).json(rule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = {
  resolveTicket,
  applyAutoArbitration,
  getTickets,
  getAdjustmentInstructions,
  getRules,
  createRule
};
