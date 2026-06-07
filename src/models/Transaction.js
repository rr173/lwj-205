const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Transaction = sequelize.define('Transaction', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
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
  }
}, {
  tableName: 'transactions',
  timestamps: true,
  indexes: [
    {
      name: 'idx_batch_source',
      fields: ['batchId', 'dataSourceId']
    },
    {
      name: 'idx_transaction_id',
      fields: ['transactionId']
    }
  ]
});

module.exports = Transaction;
