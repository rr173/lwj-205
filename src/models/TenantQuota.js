const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DEFAULT_QUOTAS = {
  maxDataSources: 50,
  maxRecordsPerBatch: 100000,
  maxActiveSchedulePlans: 20,
  maxConcurrentSandboxes: 10,
  maxApiCallsPerHour: 10000
};

const TenantQuota = sequelize.define('TenantQuota', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true
  },
  maxDataSources: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: DEFAULT_QUOTAS.maxDataSources,
    comment: '最大数据源数量'
  },
  maxRecordsPerBatch: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: DEFAULT_QUOTAS.maxRecordsPerBatch,
    comment: '单批次最大记录数'
  },
  maxActiveSchedulePlans: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: DEFAULT_QUOTAS.maxActiveSchedulePlans,
    comment: '最大活跃调度计划数'
  },
  maxConcurrentSandboxes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: DEFAULT_QUOTAS.maxConcurrentSandboxes,
    comment: '沙盒并发数上限'
  },
  maxApiCallsPerHour: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: DEFAULT_QUOTAS.maxApiCallsPerHour,
    comment: '每小时最大API调用次数'
  }
}, {
  tableName: 'tenant_quotas',
  timestamps: true,
  indexes: [
    {
      name: 'idx_quota_tenant',
      unique: true,
      fields: ['tenantId']
    }
  ]
});

TenantQuota.DEFAULT_QUOTAS = DEFAULT_QUOTAS;

module.exports = TenantQuota;
