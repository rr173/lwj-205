const alertService = require('../services/alertService');

async function getAlerts(req, res) {
  try {
    const result = await alertService.getAlerts(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function markAlertRead(req, res) {
  try {
    const { alertId } = req.params;
    const alert = await alertService.markAlertRead(alertId);
    res.json(alert);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function getImportTrend(req, res) {
  try {
    const minutes = parseInt(req.query.minutes) || 60;
    const result = await alertService.getImportTrend(minutes);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getBatchHealth(req, res) {
  try {
    const result = await alertService.getBatchHealthOverview();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getAlerts,
  markAlertRead,
  getImportTrend,
  getBatchHealth
};
