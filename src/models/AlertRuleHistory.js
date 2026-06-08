const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AlertRuleHistory = sequelize.define('AlertRuleHistory', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  ruleId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  field: {
    type: DataTypes.STRING,
    allowNull: false
  },
  oldValue: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  newValue: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  operator: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'alert_rule_histories',
  timestamps: true,
  updatedAt: false
});

module.exports = AlertRuleHistory;
