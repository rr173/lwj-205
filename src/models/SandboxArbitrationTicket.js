const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SandboxArbitrationTicket = sequelize.define('SandboxArbitrationTicket', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  sandboxId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  discrepancyId: {
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
  }
}, {
  tableName: 'sandbox_arbitration_tickets',
  timestamps: true,
  indexes: [
    { fields: ['sandboxId'] },
    { fields: ['sandboxId', 'status'] },
    { fields: ['discrepancyId'] }
  ]
});

module.exports = SandboxArbitrationTicket;
