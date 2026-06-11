const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ArbitrationRule = sequelize.define('ArbitrationRule', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  ruleType: {
    type: DataTypes.ENUM('amount_tolerance', 'prefer_source', 'ignore_pattern'),
    allowNull: false
  },
  condition: {
    type: DataTypes.JSON,
    allowNull: false
  },
  action: {
    type: DataTypes.JSON,
    allowNull: false
  },
  priority: {
    type: DataTypes.INTEGER,
    defaultValue: 100
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'arbitration_rules',
  timestamps: true,
  indexes: [
    {
      name: 'idx_ar_tenant_name',
      unique: true,
      fields: ['tenantId', 'name']
    }
  ]
});

module.exports = ArbitrationRule;
