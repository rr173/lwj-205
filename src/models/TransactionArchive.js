const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TransactionArchive = sequelize.define('TransactionArchive', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true
  },
  dataSourceId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  transactionId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: false
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: 'CNY'
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false
  },
  counterparty: {
    type: DataTypes.STRING,
    allowNull: true
  },
  summary: {
    type: DataTypes.STRING,
    allowNull: true
  },
  rawData: {
    type: DataTypes.JSON,
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  archivedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'transaction_archives',
  timestamps: true,
  indexes: [
    {
      name: 'idx_atx_tenant_batch',
      fields: ['tenantId', 'batchId', 'dataSourceId']
    },
    {
      name: 'idx_atx_tenant_txnid',
      fields: ['tenantId', 'transactionId']
    }
  ]
});

module.exports = TransactionArchive;
