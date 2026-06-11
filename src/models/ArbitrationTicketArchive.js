const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ArbitrationTicketArchive = sequelize.define('ArbitrationTicketArchive', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true
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
    type: DataTypes.ENUM('pending', 'auto_resolved', 'manually_resolved', 'ignored', 'pending_review'),
    defaultValue: 'pending'
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
  ruleApplied: {
    type: DataTypes.STRING,
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  archivedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'arbitration_ticket_archives',
  timestamps: true,
  indexes: [
    {
      name: 'idx_aat_tenant_batch',
      fields: ['tenantId', 'batchId']
    }
  ]
});

module.exports = ArbitrationTicketArchive;
