const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ReportSubscription = sequelize.define('ReportSubscription', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  triggerMode: {
    type: DataTypes.ENUM('on_completion', 'cron'),
    allowNull: false,
    defaultValue: 'on_completion'
  },
  cronExpression: {
    type: DataTypes.STRING,
    allowNull: true
  },
  nextTriggerAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  filterDataSourceIds: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  },
  filterDiscrepancyRatioThreshold: {
    type: DataTypes.FLOAT,
    allowNull: true
  },
  isEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  lastTriggeredAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'report_subscriptions',
  timestamps: true,
  indexes: [
    { name: 'idx_sub_trigger_mode', fields: ['triggerMode'] },
    { name: 'idx_sub_enabled', fields: ['isEnabled'] },
    { name: 'idx_sub_next_trigger', fields: ['nextTriggerAt'] }
  ]
});

module.exports = ReportSubscription;
