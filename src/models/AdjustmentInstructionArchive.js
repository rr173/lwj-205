const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AdjustmentInstructionArchive = sequelize.define('AdjustmentInstructionArchive', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true
  },
  arbitrationTicketId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  discrepancyId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  targetDataSourceId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  transactionId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  adjustmentType: {
    type: DataTypes.ENUM('increase', 'decrease', 'add_record', 'remove_record'),
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: true
  },
  currency: {
    type: DataTypes.STRING(3),
    defaultValue: 'CNY'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'executed', 'cancelled'),
    defaultValue: 'pending'
  },
  executedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  archivedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'adjustment_instruction_archives',
  timestamps: true,
  indexes: [
    {
      name: 'idx_arch_ai_batch_id',
      fields: ['batchId']
    },
    {
      name: 'idx_arch_ai_ticket_id',
      fields: ['arbitrationTicketId']
    },
    {
      name: 'idx_arch_ai_archived_at',
      fields: ['archivedAt']
    }
  ]
});

module.exports = AdjustmentInstructionArchive;
