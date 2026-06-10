const archiveService = require('../services/archiveService');

function friendlyError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  if (/SQLITE_BUSY|busy_timeout|database is locked/i.test(msg)) {
    return '该批次正在被其他操作占用，请稍后重试';
  }
  return msg;
}

async function createConfig(req, res) {
  try {
    const operator = req.user?.username || 'admin';
    const config = await archiveService.createConfig(req.body, operator);
    res.status(201).json(config);
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function updateConfig(req, res) {
  try {
    const { configId } = req.params;
    const operator = req.user?.username || 'admin';
    const config = await archiveService.updateConfig(configId, req.body, operator);
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function deleteConfig(req, res) {
  try {
    const { configId } = req.params;
    const operator = req.user?.username || 'admin';
    const result = await archiveService.deleteConfig(configId, operator);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function getConfig(req, res) {
  try {
    const { configId } = req.params;
    const config = await archiveService.getConfig(configId);
    res.json(config);
  } catch (err) {
    res.status(404).json({ error: friendlyError(err) });
  }
}

async function listConfigs(req, res) {
  try {
    const result = await archiveService.listConfigs(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

async function archiveBatch(req, res) {
  try {
    const { batchId } = req.params;
    const operator = req.user?.username || 'admin';
    const result = await archiveService.archiveBatch(batchId, operator);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function restoreBatch(req, res) {
  try {
    const { batchId } = req.params;
    const operator = req.user?.username || 'admin';
    const result = await archiveService.restoreBatch(batchId, operator);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function runAutoArchiveNow(req, res) {
  try {
    const result = await archiveService.runAutoArchive();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

async function getArchivedBatches(req, res) {
  try {
    const result = await archiveService.getArchivedBatches(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

async function getArchivedTransactions(req, res) {
  try {
    const result = await archiveService.getArchivedTransactions(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

async function getArchivedDiscrepancies(req, res) {
  try {
    const result = await archiveService.getArchivedDiscrepancies(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

async function getArchivedTickets(req, res) {
  try {
    const result = await archiveService.getArchivedTickets(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

async function getArchiveStats(req, res) {
  try {
    const stats = await archiveService.getArchiveStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

module.exports = {
  createConfig,
  updateConfig,
  deleteConfig,
  getConfig,
  listConfigs,
  archiveBatch,
  restoreBatch,
  runAutoArchiveNow,
  getArchivedBatches,
  getArchivedTransactions,
  getArchivedDiscrepancies,
  getArchivedTickets,
  getArchiveStats
};
