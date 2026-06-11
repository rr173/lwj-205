const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ProbeResult = sequelize.define('ProbeResult', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  probeId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  dataSourceId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('success', 'failure', 'timeout'),
    allowNull: false
  },
  responseTimeMs: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  previousState: {
    type: DataTypes.STRING,
    allowNull: true
  },
  newState: {
    type: DataTypes.STRING,
    allowNull: true
  },
  stateChanged: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  detail: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'probe_results',
  timestamps: true,
  indexes: [
    {
      name: 'idx_pr_tenant_probe',
      fields: ['tenantId', 'probeId']
    }
  ]
});

module.exports = ProbeResult;
