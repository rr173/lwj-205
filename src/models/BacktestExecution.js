const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BacktestExecution = sequelize.define('BacktestExecution', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  backtestPlanId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  batchNo: {
    type: DataTypes.STRING,
    allowNull: true
  },
  sandboxId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  executionIndex: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'running', 'completed', 'failed', 'skipped'),
    defaultValue: 'pending'
  },
  baselineMetrics: {
    type: DataTypes.JSON,
    allowNull: true
  },
  sandboxMetrics: {
    type: DataTypes.JSON,
    allowNull: true
  },
  diffAnalysis: {
    type: DataTypes.JSON,
    allowNull: true
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
  }
}, {
  tableName: 'backtest_executions',
  timestamps: true,
  indexes: [
    { fields: ['backtestPlanId'] },
    { fields: ['backtestPlanId', 'executionIndex'] },
    { fields: ['status'] }
  ]
});

module.exports = BacktestExecution;
