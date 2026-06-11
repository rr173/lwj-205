const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DiscrepancyArchive = sequelize.define('DiscrepancyArchive', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true
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
  severity: {
    type: DataTypes.ENUM('normal', 'critical'),
    defaultValue: 'normal'
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
  tableName: 'discrepancy_archives',
  timestamps: true,
  indexes: [
    {
      name: 'idx_ad_tenant_batch_type',
      fields: ['tenantId', 'batchId', 'type']
    },
    {
      name: 'idx_ad_tenant_txnid',
      fields: ['tenantId', 'transactionId']
    }
  ]
});

module.exports = DiscrepancyArchive;
