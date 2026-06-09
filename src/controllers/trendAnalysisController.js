const trendAnalysisService = require('../services/trendAnalysisService');

async function getDiscrepancyTrend(req, res) {
  try {
    const { startDate, endDate, dataSourceId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate 和 endDate 为必填参数' });
    }

    const result = await trendAnalysisService.getDiscrepancyTrend(
      startDate,
      endDate,
      dataSourceId
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function tagRootCause(req, res) {
  try {
    const { discrepancyId } = req.params;
    const { rootCause } = req.body;

    if (!rootCause) {
      return res.status(400).json({ error: 'rootCause 为必填参数' });
    }

    const discrepancy = await trendAnalysisService.tagDiscrepancyRootCause(
      discrepancyId,
      rootCause
    );
    res.json(discrepancy);
  } catch (err) {
    const status = err.message.includes('不存在') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
}

async function batchTagRootCause(req, res) {
  try {
    const { discrepancyIds, rootCause } = req.body;

    const result = await trendAnalysisService.batchTagRootCause(
      discrepancyIds,
      rootCause
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function getRootCauseAggregation(req, res) {
  try {
    const { startDate, endDate, dataSourceId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate 和 endDate 为必填参数' });
    }

    const result = await trendAnalysisService.getRootCauseAggregation(
      startDate,
      endDate,
      dataSourceId
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getTransactionChain(req, res) {
  try {
    const { transactionId } = req.params;

    const result = await trendAnalysisService.getTransactionDiscrepancyChain(transactionId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = {
  getDiscrepancyTrend,
  tagRootCause,
  batchTagRootCause,
  getRootCauseAggregation,
  getTransactionChain
};
