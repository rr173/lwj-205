const auditService = require('../services/auditService');

async function getAuditLogs(req, res) {
  try {
    const result = await auditService.queryLogs(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getAuditLogs };
