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
  description: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'alert_rules',
  timestamps: true,
  indexes: [
    { fields: ['ruleKey', 'scope'] },
    { fields: ['dataSourceId'] }
  ]
});

module.exports = AlertRule;
