const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DataSource = sequelize.define('DataSource', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true
  },
  fieldMapping: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {
      transactionId: 'transactionId',
      amount: 'amount',
      currency: 'currency',
      timestamp: 'timestamp',
      counterparty: 'counterparty',
      summary: 'summary'
    }
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'data_sources',
  timestamps: true,
  indexes: [
    {
      name: 'idx_ds_tenant',
      unique: true,
      fields: ['tenantId', 'name']
    }
  ]
});

module.exports = DataSource;
