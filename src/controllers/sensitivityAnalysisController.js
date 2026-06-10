const sensitivityAnalysisService = require('../services/sensitivityAnalysisService');

async function submitAnalysis(req, res) {
  try {
    const analysis = await sensitivityAnalysisService.submitAnalysis({
      baseBatchId: req.body.baseBatchId,
      type: req.body.type,
      params: req.body.params,
      baseConfig: req.body.baseConfig,
      createdBy: req.user?.username || null
    });
    res.json({ success: true, data: analysis });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

async function listAnalyses(req, res) {
  try {
    const result = await sensitivityAnalysisService.listAnalyses(req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getAnalysis(req, res) {
  try {
    const analysis = await sensitivityAnalysisService.getAnalysis(req.params.taskId);
    res.json({ success: true, data: analysis });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
}

async function cancelAnalysis(req, res) {
  try {
    const analysis = await sensitivityAnalysisService.cancelAnalysis(req.params.taskId);
    res.json({ success: true, data: analysis });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

module.exports = {
  submitAnalysis,
  listAnalyses,
  getAnalysis,
  cancelAnalysis
};
