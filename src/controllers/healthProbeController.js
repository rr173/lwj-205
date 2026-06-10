const healthProbeService = require('../services/healthProbeService');

async function createProbe(req, res) {
  try {
    const probe = await healthProbeService.createProbe(req.body);
    res.status(201).json(probe);
  } catch (err) {
    const status = err.message.includes('不存在') || err.message.includes('已有') ? 409 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function updateProbe(req, res) {
  try {
    const probe = await healthProbeService.updateProbe(req.params.probeId, req.body);
    res.json(probe);
  } catch (err) {
    const status = err.message.includes('不存在') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function deleteProbe(req, res) {
  try {
    const result = await healthProbeService.deleteProbe(req.params.probeId);
    res.json(result);
  } catch (err) {
    const status = err.message.includes('不存在') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function getProbe(req, res) {
  try {
    const probe = await healthProbeService.getProbe(req.params.probeId);
    res.json(probe);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function listProbes(req, res) {
  try {
    const result = await healthProbeService.listProbes(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getProbeResults(req, res) {
  try {
    const result = await healthProbeService.getProbeResults(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getSelfHealingLogs(req, res) {
  try {
    const result = await healthProbeService.getSelfHealingLogs(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getDataSourceHealthHistory(req, res) {
  try {
    const result = await healthProbeService.getDataSourceHealthHistory(req.params.dataSourceId);
    res.json(result);
  } catch (err) {
    const status = err.message.includes('不存在') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function getHealthOverview(req, res) {
  try {
    const result = await healthProbeService.getHealthOverview();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  createProbe,
  updateProbe,
  deleteProbe,
  getProbe,
  listProbes,
  getProbeResults,
  getSelfHealingLogs,
  getDataSourceHealthHistory,
  getHealthOverview
};
