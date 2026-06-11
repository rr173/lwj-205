const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AlertEvent = sequelize.define('AlertEvent', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
    type: {
    type: DataTypes.ENUM('volume_spike', 'discrepancy_ratio', 'reconciliation_failed', 'sla_breach', 'trend_deterioration', 'datasource_degraded', 'datasource_down', 'datasource_recovered'),
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
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  triggeredRuleScope: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'alert_events',
  timestamps: true,
  indexes: [
    {
      name: 'idx_ae_tenant_read',
      fields: ['tenantId', 'isRead']
    },
    {
      name: 'idx_ae_tenant_created',
      fields: ['tenantId', 'createdAt']
    }
  ]
});

module.exports = AlertEvent;
