const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StressTestPlan = sequelize.define('StressTestPlan', {
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
    type: DataTypes.ENUM('pending', 'generating_data', 'running', 'completed', 'failed', 'cancelled'),
    defaultValue: 'pending'
  },
  config: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  dataSourceCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 2
  },
  recordsPerSource: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1000
  },
  discrepancyRatio: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0.1
  },
  discrepancyTypeWeights: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: { unilateral: 0.4, amount: 0.4, time: 0.2 }
  },
  concurrentBatches: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  totalRecords: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  totalDiscrepancies: {
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
  capacityReport: {
    type: DataTypes.JSON,
    allowNull: true
  },
  sandboxCleaned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'stress_test_plans',
  timestamps: true,
  indexes: [
    { name: 'idx_stp_tenant_status', fields: ['tenantId', 'status'] }
  ]
});

module.exports = StressTestPlan;
