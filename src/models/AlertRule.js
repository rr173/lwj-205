const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AlertRule = sequelize.define('AlertRule', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  ruleKey: {
    type: DataTypes.STRING,
    allowNull: false
  },
  scope: {
    type: DataTypes.ENUM('global', 'datasource'),
    allowNull: false,
    defaultValue: 'global'
  },
  dataSourceId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  parameters: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'alert_rules',
  timestamps: true,
  indexes: [
    { name: 'idx_alr_tenant_keyscope', fields: ['tenantId', 'ruleKey', 'scope'] },
    { name: 'idx_alr_tenant_ds', fields: ['tenantId', 'dataSourceId'] }
  ]
});

module.exports = AlertRule;
