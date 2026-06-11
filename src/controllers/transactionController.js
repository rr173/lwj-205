const { Transaction, DataSource, ReconciliationBatch } = require('../models');
const alertService = require('../services/alertService');
const quotaService = require('../services/quotaService');
const { getTenantId } = require('../utils/tenantContext');

async function importTransactions(req, res) {
  try {
    const tenantId = getTenantId();
    const { dataSourceId, batchId, records } = req.body;

    if (!dataSourceId || !batchId || !records || !Array.isArray(records)) {
      return res.status(400).json({ error: '缺少必要参数: dataSourceId, batchId, records(数组)' });
    }

    const dataSource = await DataSource.findByPk(dataSourceId);
    if (!dataSource) {
      return res.status(404).json({ error: '数据源不存在' });
    }

    const batch = await ReconciliationBatch.findByPk(batchId);
    if (!batch) {
      return res.status(404).json({ error: '批次不存在' });
    }

    if (batch.isArchived) {
      return res.status(400).json({ error: '该批次已归档，不能导入数据，请先回迁到主表' });
    }

    if (batch.archiveLock) {
      return res.status(400).json({ error: '该批次正在进行归档/回迁操作，请稍后重试' });
    }

    if (batch.status === 'running') {
      return res.status(400).json({ error: '该批次正在对账中，请等待完成后再导入数据' });
    }

    const currentCount = await Transaction.count({ where: { batchId } });
    const totalAfterImport = currentCount + records.length;

    if (tenantId) {
      try {
        await quotaService.checkRecordsPerBatch(tenantId, totalAfterImport);
      } catch (e) {
        return res.status(429).json({
          error: e.message,
          code: 'QUOTA_EXCEEDED'
        });
      }
    }

    const fieldMapping = dataSource.fieldMapping || {};
    const mappedRecords = records.map(record => {
      return {
        dataSourceId,
        batchId,
        transactionId: record[fieldMapping.transactionId || 'transactionId'],
        amount: parseFloat(record[fieldMapping.amount || 'amount']),
        currency: record[fieldMapping.currency || 'currency'] || 'CNY',
        timestamp: new Date(record[fieldMapping.timestamp || 'timestamp']),
        counterparty: record[fieldMapping.counterparty || 'counterparty'],
        summary: record[fieldMapping.summary || 'summary'],
        rawData: record
      };
    });

    const invalidRecords = mappedRecords.filter(r => !r.transactionId || isNaN(r.amount) || isNaN(r.timestamp.getTime()));
    if (invalidRecords.length > 0) {
      return res.status(400).json({
        error: `有 ${invalidRecords.length} 条记录格式不正确`,
        invalidCount: invalidRecords.length
      });
    }

    const created = await Transaction.bulkCreate(mappedRecords);

    alertService.checkVolumeSpike(dataSourceId, created.length).catch(err => {
      console.error('导入量检测失败:', err.message);
    });

    res.status(201).json({
      message: `成功导入 ${created.length} 条记录`,
      count: created.length,
      batchId,
      dataSourceId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getTransactions(req, res) {
  try {
    const { batchId, dataSourceId, transactionId, limit = 100, offset = 0 } = req.query;
    const where = {};
    if (batchId) where.batchId = batchId;
    if (dataSourceId) where.dataSourceId = dataSourceId;
    if (transactionId) where.transactionId = transactionId;

    const { count, rows } = await Transaction.findAndCountAll({
      where,
      limit: Math.min(parseInt(limit), 1000),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    res.json({
      total: count,
      data: rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  importTransactions,
  getTransactions
};
