const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ScheduleExecution = sequelize.define('ScheduleExecution', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  planId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'schedule_plans',
      key: 'id'
    }
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'reconciliation_batches',
      key: 'id'
    }
  },
  status: {
    type: DataTypes.ENUM('running', 'completed', 'failed', 'skipped', 'sla_breached'),
    allowNull: false,
    defaultValue: 'running'
  },
  startedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  slaDeadline: {
    type: DataTypes.DATE,
    allowNull: true
  },
  slaBreached: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  skipReason: {
    type: DataTypes.STRING,
    allowNull: true
  },
  executionDurationMs: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  triggeredBy: {
    type: DataTypes.ENUM('schedule', 'manual'),
    allowNull: false,
    defaultValue: 'schedule'
  }
}, {
  tableName: 'schedule_executions',
  timestamps: true,
  indexes: [
    { fields: ['planId'] },
    { fields: ['status'] },
    { fields: ['planId', 'status'] },
    { fields: ['startedAt'] }
  ]
});

module.exports = ScheduleExecution;
