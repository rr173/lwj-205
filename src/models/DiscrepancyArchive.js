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
      name: 'idx_arch_disc_batch_type',
      fields: ['batchId', 'type']
    },
    {
      name: 'idx_arch_disc_transaction_id',
      fields: ['transactionId']
    },
    {
      name: 'idx_arch_disc_root_cause',
      fields: ['rootCause']
    },
    {
      name: 'idx_arch_disc_archived_at',
      fields: ['archivedAt']
    }
  ]
});

module.exports = DiscrepancyArchive;
