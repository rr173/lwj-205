const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TenantMetering = sequelize.define('TenantMetering', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  metricDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  recordsProcessed: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0,
    comment: '对账处理的记录数'
  },
  discrepanciesGenerated: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '产生的差异数'
  },
  apiCalls: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0,
    comment: 'API调用次数'
  },
  batchesCompleted: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '完成的对账批次数量'
  },
  ticketsResolved: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '已解决的仲裁工单数量'
  }
}, {
  tableName: 'tenant_metering',
  timestamps: false,
  indexes: [
    {
      name: 'idx_metering_tenant_date',
      unique: true,
      fields: ['tenantId', 'metricDate']
    },
    {
      name: 'idx_metering_date',
      fields: ['metricDate']
    }
  ]
});

module.exports = TenantMetering;
