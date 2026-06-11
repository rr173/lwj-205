const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AdjustmentInstruction = sequelize.define('AdjustmentInstruction', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
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
    type: DataTypes.ENUM('pending', 'executed', 'cancelled', 'suspended'),
    defaultValue: 'pending'
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  executedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'adjustment_instructions',
  timestamps: true,
  indexes: [
    {
      name: 'idx_ai_tenant_batch',
      fields: ['tenantId', 'batchId']
    }
  ]
});

module.exports = AdjustmentInstruction;
