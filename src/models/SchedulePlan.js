const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SchedulePlan = sequelize.define('SchedulePlan', {
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
    type: DataTypes.STRING,
    allowNull: true
  },
  dataSourceIds: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: [],
    validate: {
      isValidArray(value) {
        if (!Array.isArray(value)) {
          throw new Error('dataSourceIds must be an array');
        }
      }
    }
  },
  scheduleType: {
    type: DataTypes.ENUM('cron', 'interval'),
    allowNull: false,
    defaultValue: 'interval'
  },
  cronExpression: {
    type: DataTypes.STRING,
    allowNull: true
  },
  intervalMinutes: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  timeWindowStart: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isValidTime(value) {
        if (value && !/^\d{2}:\d{2}$/.test(value)) {
          throw new Error('timeWindowStart must be in HH:mm format');
        }
      }
    }
  },
  timeWindowEnd: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isValidTime(value) {
        if (value && !/^\d{2}:\d{2}$/.test(value)) {
          throw new Error('timeWindowEnd must be in HH:mm format');
        }
      }
    }
  },
  slaMinutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 30
  },
  slaComplianceThreshold: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0.8
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  isPaused: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  isDeleted: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  nextRunAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastRunAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastExecutionStatus: {
    type: DataTypes.STRING,
    allowNull: true
  },
  reconciliationConfig: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      timeToleranceSeconds: 300,
      amountTolerance: 0.01
    }
  },
  isPreset: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  pausedByProbe: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }
}, {
  tableName: 'schedule_plans',
  timestamps: true,
  indexes: [
    {
      name: 'idx_sp_tenant_active',
      fields: ['tenantId', 'isActive', 'isDeleted']
    }
  ]
});

module.exports = SchedulePlan;
