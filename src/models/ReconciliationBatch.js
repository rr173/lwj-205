const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ReconciliationBatch = sequelize.define('ReconciliationBatch', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  batchNo: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'running', 'completed', 'failed', 'queued'),
    defaultValue: 'pending'
  },
  totalRecords: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  matchedCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  discrepancyCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  uniqueTransactionCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  endTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  config: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      timeToleranceSeconds: 300,
      amountTolerance: 0.01,
      dataSourceIds: []
    }
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'reconciliation_batches',
  timestamps: true
});

module.exports = ReconciliationBatch;
