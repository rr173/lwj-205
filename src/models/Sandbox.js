const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Sandbox = sequelize.define('Sandbox', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  baseBatchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  baseBatchNo: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('creating', 'ready', 'running', 'completed', 'failed', 'expired', 'deleted'),
    defaultValue: 'creating'
  },
  config: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  arbitrationRules: {
    type: DataTypes.JSON,
    allowNull: true
  },
  alertThresholds: {
    type: DataTypes.JSON,
    allowNull: true
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
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: true
  },
  backtestPlanId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  backtestExecutionIndex: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'sandboxes',
  timestamps: true,
  indexes: [
    { name: 'idx_sb_tenant_status', fields: ['tenantId', 'status'] },
    { name: 'idx_sb_tenant_expires', fields: ['tenantId', 'expiresAt'] },
    { name: 'idx_sb_tenant_bt', fields: ['tenantId', 'backtestPlanId'] }
  ]
});

module.exports = Sandbox;
