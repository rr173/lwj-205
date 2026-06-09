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
  comparison: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'reconciliation_reports',
  timestamps: true,
  indexes: [
    { name: 'idx_report_batch_id', fields: ['batchId'], unique: true },
    { name: 'idx_report_type', fields: ['reportType'] },
    { name: 'idx_report_created', fields: ['createdAt'] }
  ]
});

module.exports = ReconciliationReport;
