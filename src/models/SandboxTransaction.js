const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SandboxTransaction = sequelize.define('SandboxTransaction', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  sandboxId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  dataSourceId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  originalTransactionId: {
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
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  rawData: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'sandbox_transactions',
  timestamps: true,
  indexes: [
    { name: 'idx_st_tenant_sandbox', fields: ['tenantId', 'sandboxId'] },
    { name: 'idx_st_tenant_sb_txnid', fields: ['tenantId', 'sandboxId', 'transactionId'] }
  ]
});

module.exports = SandboxTransaction;
