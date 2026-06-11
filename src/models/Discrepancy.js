const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Discrepancy = sequelize.define('Discrepancy', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM('unilateral', 'amount_mismatch', 'time_offset'),
    allowNull: false
  },
  transactionId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sourceTransactions: {
    type: DataTypes.JSON,
    allowNull: true
  },
  missingInSources: {
    type: DataTypes.JSON,
    allowNull: true
  },
  amountDiff: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: true
  },
  timeDiffSeconds: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('open', 'resolved', 'ignored', 'pending_review'),
    defaultValue: 'open'
  },
  rootCause: {
    type: DataTypes.STRING,
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  severity: {
    type: DataTypes.ENUM('normal', 'critical'),
    defaultValue: 'normal'
  }
}, {
  tableName: 'discrepancies',
  timestamps: true,
  indexes: [
    {
      name: 'idx_disc_tenant_batch_type',
      fields: ['tenantId', 'batchId', 'type']
    },
    {
      name: 'idx_disc_tenant_txnid',
      fields: ['tenantId', 'transactionId']
    },
    {
      name: 'idx_disc_tenant_rc',
      fields: ['tenantId', 'rootCause']
    }
  ]
});

module.exports = Discrepancy;
