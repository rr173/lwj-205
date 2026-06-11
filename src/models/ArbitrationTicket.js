const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ArbitrationTicket = sequelize.define('ArbitrationTicket', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  discrepancyId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'auto_resolved', 'manually_resolved', 'ignored', 'pending_review', 'reviewing', 'review_rejected'),
    defaultValue: 'pending'
  },
  reviewStatus: {
    type: DataTypes.ENUM('not_required', 'pending_review', 'reviewing', 'approved', 'rejected'),
    defaultValue: 'not_required',
    comment: '复核状态：无需复核、待复核、复核中、已通过、已驳回'
  },
  reviewRequired: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '是否需要复核'
  },
  currentReviewLevel: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '当前复核级别，1=一级，2=二级'
  },
  reviewLevelRequired: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '需要的复核级别，1=一级，2=两级'
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '驳回原因'
  },
  rejectedBy: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '驳回人'
  },
  rejectedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '驳回时间'
  },
  finalApprovedBy: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '最终批准人'
  },
  finalApprovedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '最终批准时间'
  },
  reviewDeadlineAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '复核截止时间'
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '创建人（对账批次创建人）'
  },
  resolutionType: {
    type: DataTypes.ENUM('use_source', 'manual_review', 'ignore', null),
    allowNull: true
  },
  primarySourceId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  resolvedBy: {
    type: DataTypes.STRING,
    allowNull: true
  },
  resolvedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  ruleApplied: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'arbitration_tickets',
  timestamps: true,
  indexes: [
    {
      name: 'idx_ticket_tenant_batch',
      fields: ['tenantId', 'batchId']
    },
    {
      name: 'idx_ticket_tenant_status',
      fields: ['tenantId', 'status']
    }
  ]
});

module.exports = ArbitrationTicket;
