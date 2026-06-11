const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StressTestMetric = sequelize.define('StressTestMetric', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  stressTestPlanId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  stressTestBatchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  batchIndex: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  phase: {
    type: DataTypes.STRING,
    allowNull: false
  },
  durationMs: {
    type: DataTypes.BIGINT,
    allowNull: false
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  endTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  memoryUsageBytes: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  dbQueryCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  maxQueryTimeMs: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  recordsProcessed: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'stress_test_metrics',
  timestamps: true,
  indexes: [
    { name: 'idx_stm_plan_batch', fields: ['stressTestPlanId', 'stressTestBatchId'] },
    { name: 'idx_stm_phase', fields: ['stressTestPlanId', 'phase'] }
  ]
});

module.exports = StressTestMetric;
