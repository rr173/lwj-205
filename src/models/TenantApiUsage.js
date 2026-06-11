const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TenantApiUsage = sequelize.define('TenantApiUsage', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  hourBucket: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '小时级别的时间桶（整点）'
  },
  callCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '该小时内的调用次数'
  }
}, {
  tableName: 'tenant_api_usage',
  timestamps: false,
  indexes: [
    {
      name: 'idx_api_usage_tenant_hour',
      unique: true,
      fields: ['tenantId', 'hourBucket']
    }
  ]
});

module.exports = TenantApiUsage;
