const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ReviewConfig = sequelize.define('ReviewConfig', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '默认复核配置'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  amountReviewThreshold: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: false,
    defaultValue: 1000,
    comment: '金额复核阈值（元），超过此金额的金额差异需要复核'
  },
  amountHighThreshold: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: false,
    defaultValue: 10000,
    comment: '高额阈值（元），超过此金额需要两级签核'
  },
  timeOffsetSeverityMultiplier: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 2,
    comment: '时间偏移严重倍数，超过阈值*此倍数视为严重偏移需要复核'
  },
  reviewTimeoutHours: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 48,
    comment: '复核超时时间（小时）'
  },
  autoEscalateEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: '是否启用超时自动升级'
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'review_configs',
  timestamps: true,
  indexes: [
    {
      name: 'idx_review_config_tenant',
      fields: ['tenantId']
    },
    {
      name: 'idx_review_config_tenant_active',
      fields: ['tenantId', 'isActive']
    }
  ]
});

module.exports = ReviewConfig;
