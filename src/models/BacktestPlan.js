const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BacktestPlan = sequelize.define('BacktestPlan', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'running', 'completed', 'failed', 'cancelled'),
    defaultValue: 'pending'
  },
  batchIds: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  },
  configSnapshot: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  arbitrationRulesSnapshot: {
    type: DataTypes.JSON,
    allowNull: true
  },
  alertThresholdsSnapshot: {
    type: DataTypes.JSON,
    allowNull: true
  },
  totalBatches: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  completedBatches: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  failedBatches: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  currentBatchIndex: {
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
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  summaryReport: {
    type: DataTypes.JSON,
    allowNull: true
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'backtest_plans',
  timestamps: true,
  indexes: [
    { fields: ['status'] },
    { fields: ['createdAt'] }
  ]
});

module.exports = BacktestPlan;
