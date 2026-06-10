const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  operator: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'viewer'
  },
  action: {
    type: DataTypes.STRING,
    allowNull: false
  },
  targetType: {
    type: DataTypes.STRING,
    allowNull: false
  },
  targetId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  beforeValue: {
    type: DataTypes.JSON,
    allowNull: true
  },
  afterValue: {
    type: DataTypes.JSON,
    allowNull: true
  },
  ip: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'audit_logs',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['operator', 'createdAt'] },
    { fields: ['action'] },
    { fields: ['targetType'] },
    { fields: ['createdAt'] }
  ]
});

AuditLog.addHook('beforeUpdate', () => {
  throw new Error('Audit logs cannot be modified');
});

AuditLog.addHook('beforeDestroy', () => {
  throw new Error('Audit logs cannot be deleted');
});

module.exports = AuditLog;
