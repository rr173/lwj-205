const { DataSource } = require('../models');

async function createDataSource(req, res) {
  try {
    const { name, description, fieldMapping } = req.body;
    if (!name) {
      return res.status(400).json({ error: '数据源名称不能为空' });
    }

    const existing = await DataSource.findOne({ where: { name } });
    if (existing) {
      return res.status(400).json({ error: '数据源名称已存在' });
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

    res.status(201).json(dataSource);
  } catch (err) {
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
