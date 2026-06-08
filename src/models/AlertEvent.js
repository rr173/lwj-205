const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AlertEvent = sequelize.define('AlertEvent', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  type: {
    type: DataTypes.ENUM('volume_spike', 'discrepancy_ratio', 'reconciliation_failed'),
    allowNull: false
  },
  severity: {
    type: DataTypes.ENUM('warning', 'critical'),
    allowNull: false,
    defaultValue: 'warning'
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  dataSourceId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  dataSourceName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  batchNo: {
    type: DataTypes.STRING,
    allowNull: true
  },
  metric: {
    type: DataTypes.JSON,
    allowNull: true
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  triggeredRuleId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  triggeredRuleScope: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'alert_events',
  timestamps: true
});

module.exports = AlertEvent;
