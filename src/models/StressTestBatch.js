const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StressTestBatch = sequelize.define('StressTestBatch', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  stressTestPlanId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  batchIndex: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  sandboxId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'generating_data', 'running', 'completed', 'failed', 'cancelled'),
    defaultValue: 'pending'
  },
  recordCount: {
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
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'stress_test_batches',
  timestamps: true,
  indexes: [
    { name: 'idx_stb_plan_index', fields: ['stressTestPlanId', 'batchIndex'] },
    { name: 'idx_stb_tenant_status', fields: ['tenantId', 'status'] }
  ]
});

module.exports = StressTestBatch;
