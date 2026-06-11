const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SelfHealingLog = sequelize.define('SelfHealingLog', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  dataSourceId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  probeId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  actionType: {
    type: DataTypes.ENUM('pause_plans', 'resume_plans', 'compensating_reconciliation', 'alert'),
    allowNull: false
  },
  actionDetail: {
    type: DataTypes.JSON,
    allowNull: true
  },
  affectedPlanIds: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  },
  triggerState: {
    type: DataTypes.STRING,
    allowNull: false
  },
  result: {
    type: DataTypes.ENUM('success', 'failure'),
    allowNull: false,
    defaultValue: 'success'
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  errorMessage: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'self_healing_logs',
  timestamps: true,
  indexes: [
    {
      name: 'idx_shl_tenant_ds',
      fields: ['tenantId', 'dataSourceId']
    }
  ]
});

module.exports = SelfHealingLog;
