const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Discrepancy = sequelize.define('Discrepancy', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM('unilateral', 'amount_mismatch', 'time_offset'),
    allowNull: false
  },
  transactionId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sourceTransactions: {
    type: DataTypes.JSON,
    allowNull: true
  },
  missingInSources: {
    type: DataTypes.JSON,
    allowNull: true
  },
  amountDiff: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: true
  },
  timeDiffSeconds: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('open', 'resolved', 'ignored', 'pending_review', 'reviewing', 'review_rejected', 'appealing'),
    defaultValue: 'open'
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
  rootCause: {
    type: DataTypes.STRING,
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  severity: {
    type: DataTypes.ENUM('normal', 'critical'),
    defaultValue: 'normal'
  }
}, {
  tableName: 'discrepancies',
  timestamps: true,
  indexes: [
    {
      name: 'idx_disc_tenant_batch_type',
      fields: ['tenantId', 'batchId', 'type']
    },
    {
      name: 'idx_disc_tenant_txnid',
      fields: ['tenantId', 'transactionId']
    },
    {
      name: 'idx_disc_tenant_rc',
      fields: ['tenantId', 'rootCause']
    }
  ]
});

module.exports = Discrepancy;
