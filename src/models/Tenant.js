const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Tenant = sequelize.define('Tenant', {
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
  displayName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('active', 'frozen', 'disabled'),
    allowNull: false,
    defaultValue: 'active'
  },
  frozenAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  frozenBy: {
    type: DataTypes.STRING,
    allowNull: true
  },
  frozenReason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'tenants',
  timestamps: true,
  indexes: [
    {
      name: 'idx_tenant_name',
      unique: true,
      fields: ['name']
    },
    {
      name: 'idx_tenant_status',
      fields: ['status']
    }
  ]
});

module.exports = Tenant;
