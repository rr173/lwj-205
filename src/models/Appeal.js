const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Appeal = sequelize.define('Appeal', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  discrepancyId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  arbitrationTicketId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  appealReason: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  requestedResolutionType: {
    type: DataTypes.ENUM('use_source', 'ignore', 'manual_review'),
    allowNull: false
  },
  requestedPrimarySourceId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'voting', 'resolved_upheld', 'resolved_changed', 'resolved_rejected', 'dismissed'),
    defaultValue: 'pending'
  },
  appellantId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  appellantRole: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'operator'
  },
  originalResolutionType: {
    type: DataTypes.STRING,
    allowNull: true
  },
  originalPrimarySourceId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  originalNotes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  resolvedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  resolutionOutcome: {
    type: DataTypes.STRING,
    allowNull: true
  },
  cooldownUntil: {
    type: DataTypes.DATE,
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'appeals',
  timestamps: true,
  indexes: [
    {
      name: 'idx_appeal_tenant_batch',
      fields: ['tenantId', 'batchId']
    },
    {
      name: 'idx_appeal_tenant_status',
      fields: ['tenantId', 'status']
    },
    {
      name: 'idx_appeal_discrepancy',
      fields: ['discrepancyId']
    },
    {
      name: 'idx_appeal_ticket',
      fields: ['arbitrationTicketId']
    },
    {
      name: 'idx_appeal_appellant_cooldown',
      fields: ['appellantId', 'batchId', 'cooldownUntil']
    }
  ]
});

module.exports = Appeal;
