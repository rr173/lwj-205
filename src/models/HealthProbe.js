const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const HealthProbe = sequelize.define('HealthProbe', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  dataSourceId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  probeType: {
    type: DataTypes.ENUM('check_recent_records', 'http_check', 'sql_check'),
    allowNull: false,
    defaultValue: 'check_recent_records'
  },
  probeConfig: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {}
  },
  intervalSeconds: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 30
  },
  timeoutMs: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 5000
  },
  currentState: {
    type: DataTypes.ENUM('healthy', 'degraded', 'down'),
    allowNull: false,
    defaultValue: 'healthy'
  },
  consecutiveFailures: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  consecutiveSuccesses: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  lastProbeAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastStateChangeAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  wentDownAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  isPreset: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }
}, {
  tableName: 'health_probes',
  timestamps: true
});

module.exports = HealthProbe;
