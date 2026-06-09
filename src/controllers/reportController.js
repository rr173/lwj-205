const reportService = require('../services/reportService');

async function generateReport(req, res) {
  try {
    const { batchId, startDate, endDate } = req.body;

    if (batchId) {
      const report = await reportService.generateBatchReport(batchId);
      return res.json(report);
    }

    if (startDate && endDate) {
      const report = await reportService.generateTimeRangeReport(startDate, endDate);
      return res.json(report);
    }

    res.status(400).json({ error: '请提供 batchId 或 startDate+endDate' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function getReport(req, res) {
  try {
    const report = await reportService.getReport(req.params.reportId);
    res.json(report);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function listReports(req, res) {
  try {
    const result = await reportService.listReports(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createSubscription(req, res) {
  try {
    const subscription = await reportService.createSubscription(req.body);
    res.status(201).json(subscription);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function getSubscription(req, res) {
  try {
    const subscription = await reportService.getSubscription(req.params.subscriptionId);
    res.json(subscription);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function listSubscriptions(req, res) {
  try {
    const result = await reportService.listSubscriptions(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateSubscription(req, res) {
  try {
    const subscription = await reportService.updateSubscription(req.params.subscriptionId, req.body);
    res.json(subscription);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function toggleSubscription(req, res) {
  try {
    const subscription = await reportService.toggleSubscription(req.params.subscriptionId);
    res.json(subscription);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function deleteSubscription(req, res) {
  try {
    const result = await reportService.deleteSubscription(req.params.subscriptionId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = {
  generateReport,
  getReport,
  listReports,
  createSubscription,
  getSubscription,
  listSubscriptions,
  updateSubscription,
  toggleSubscription,
  deleteSubscription
};
