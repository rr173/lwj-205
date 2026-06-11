const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SensitivityAnalysis = sequelize.define('SensitivityAnalysis', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  baseBatchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM('single', 'grid'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('queued', 'running', 'completed', 'failed', 'cancelled'),
    defaultValue: 'queued'
  },
  params: {
    type: DataTypes.JSON,
    allowNull: false
  },
  baseConfig: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  totalPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  completedPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  failedPoints: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  results: {
    type: DataTypes.JSON,
    allowNull: true
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: true
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  endTime: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'sensitivity_analyses',
  timestamps: true,
  indexes: [
    { name: 'idx_sa_tenant_batch', fields: ['tenantId', 'baseBatchId'] },
    { name: 'idx_sa_tenant_status', fields: ['tenantId', 'status'] }
  ]
});

module.exports = SensitivityAnalysis;
