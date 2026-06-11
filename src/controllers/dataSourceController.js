const { DataSource } = require('../models');
const quotaService = require('../services/quotaService');
const { getCurrentTenantId } = require('../utils/tenantContext');

async function createDataSource(req, res) {
  try {
    const { name, description, fieldMapping } = req.body;
    if (!name) {
      return res.status(400).json({ error: '数据源名称不能为空' });
    }

    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      return res.status(400).json({ error: '租户上下文不存在' });
    }

    const result = await quotaService.withTenantWriteLock(tenantId, async () => {
      const existing = await DataSource.findOne({ where: { name } });
      if (existing) {
        throw Object.assign(new Error('数据源名称已存在'), { statusCode: 400 });
      }

      const quota = await quotaService.getTenantQuotas(tenantId);
      const currentCount = await DataSource.count({ where: { tenantId } });
      if (currentCount + 1 > quota.maxDataSources) {
        throw new quotaService.QuotaExceededError('maxDataSources', currentCount + 1, quota.maxDataSources);
      }

      const dataSource = await DataSource.create({
        name,
        description,
        fieldMapping: fieldMapping || {
          transactionId: 'transactionId',
          amount: 'amount',
          currency: 'currency',
          timestamp: 'timestamp',
          counterparty: 'counterparty',
          summary: 'summary'
        }
      });

      return dataSource;
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof quotaService.QuotaExceededError) {
      return res.status(429).json({
        error: '配额超限',
        quota: err.quotaName,
        used: err.used,
        limit: err.limit,
        message: err.message
      });
    }
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
}

async function getDataSources(req, res) {
  try {
    const dataSources = await DataSource.findAll({ order: [['createdAt', 'DESC']] });
    res.json(dataSources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getDataSource(req, res) {
  try {
    const { id } = req.params;
    const dataSource = await DataSource.findByPk(id);
    if (!dataSource) {
      return res.status(404).json({ error: '数据源不存在' });
    }
    res.json(dataSource);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateDataSource(req, res) {
  try {
    const { id } = req.params;
    const { description, fieldMapping, isActive } = req.body;

    const dataSource = await DataSource.findByPk(id);
    if (!dataSource) {
      return res.status(404).json({ error: '数据源不存在' });
    }

    await dataSource.update({ description, fieldMapping, isActive });
    res.json(dataSource);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  createDataSource,
  getDataSources,
  getDataSource,
  updateDataSource
};
