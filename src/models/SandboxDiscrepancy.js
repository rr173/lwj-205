const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SandboxDiscrepancy = sequelize.define('SandboxDiscrepancy', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  sandboxId: {
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
  }
}, {
  tableName: 'sandbox_discrepancies',
  timestamps: true,
  indexes: [
    { fields: ['sandboxId'] },
    { fields: ['sandboxId', 'type'] },
    { fields: ['sandboxId', 'transactionId'] }
  ]
});

module.exports = SandboxDiscrepancy;
