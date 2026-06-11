const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ReconciliationReport = sequelize.define('ReconciliationReport', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  reportType: {
    type: DataTypes.ENUM('batch', 'time_range'),
    allowNull: false
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  timeRangeStart: {
    type: DataTypes.DATE,
    allowNull: true
  },
  timeRangeEnd: {
    type: DataTypes.DATE,
    allowNull: true
  },
  batchIds: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  },
  summary: {
    type: DataTypes.JSON,
    allowNull: true
  },
  discrepancyDetails: {
    type: DataTypes.JSON,
    allowNull: true
  },
  rootCauseDistribution: {
    type: DataTypes.JSON,
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  comparison: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'reconciliation_reports',
  timestamps: true,
  indexes: [
    { name: 'idx_rr_tenant_batch', fields: ['tenantId', 'batchId'], unique: true },
    { name: 'idx_rr_tenant_type', fields: ['tenantId', 'reportType'] }
  ]
});

module.exports = ReconciliationReport;
