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
  }
}, {
  tableName: 'discrepancies',
  timestamps: true,
  indexes: [
    {
      name: 'idx_batch_type',
      fields: ['batchId', 'type']
    }
  ]
});

module.exports = Discrepancy;
