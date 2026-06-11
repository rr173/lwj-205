const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ReviewRecord = sequelize.define('ReviewRecord', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  discrepancyId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: '关联的差异ID'
  },
  arbitrationTicketId: {
    type: DataTypes.UUID,
    allowNull: false,
    comment: '关联的仲裁工单ID'
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  reviewLevel: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: '复核级别，1=一级复核，2=二级复核'
  },
  status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'escalated', 'timeout'),
    allowNull: false,
    defaultValue: 'pending',
    comment: '复核状态：待处理、已批准、已驳回、已升级、超时'
  },
  reviewerId: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '复核人ID'
  },
  reviewerRole: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '复核人角色'
  },
  reviewComment: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '复核意见'
  },
  reviewedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '复核时间'
  },
  assignedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: '指派时间'
  },
  deadlineAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '截止时间'
  },
  escalated: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '是否已超时升级'
  },
  escalatedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '升级时间'
  },
  escalationReason: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '升级原因'
  },
  previousReviewerId: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '上一个复核人（升级前）'
  },
  triggerType: {
    type: DataTypes.ENUM('auto', 'manual', 'escalation'),
    allowNull: false,
    defaultValue: 'auto',
    comment: '触发类型：自动、手动指派、超时升级'
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'review_records',
  timestamps: true,
  indexes: [
    {
      name: 'idx_review_record_tenant',
      fields: ['tenantId']
    },
    {
      name: 'idx_review_record_discrepancy',
      fields: ['tenantId', 'discrepancyId']
    },
    {
      name: 'idx_review_record_ticket',
      fields: ['tenantId', 'arbitrationTicketId']
    },
    {
      name: 'idx_review_record_status',
      fields: ['tenantId', 'status']
    },
    {
      name: 'idx_review_record_reviewer',
      fields: ['tenantId', 'reviewerId', 'status']
    },
    {
      name: 'idx_review_record_batch',
      fields: ['tenantId', 'batchId']
    },
    {
      name: 'idx_review_record_deadline',
      fields: ['status', 'deadlineAt']
    }
  ]
});

module.exports = ReviewRecord;
