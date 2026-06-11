const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DisposalPlanMatchLog = sequelize.define('DisposalPlanMatchLog', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  planId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  discrepancyId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  ticketId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  matchedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  autoExecuted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  executionStatus: {
    type: DataTypes.ENUM('success', 'failed', 'skipped'),
    allowNull: true
  },
  executionError: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  resolutionType: {
    type: DataTypes.STRING,
    allowNull: true
  },
  coveredAmount: {
    type: DataTypes.DECIMAL(18, 4),
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'disposal_plan_match_logs',
  timestamps: true,
  updatedAt: false,
  indexes: [
    {
      name: 'idx_dpml_plan_matched',
      fields: ['planId', 'matchedAt']
    },
    {
      name: 'idx_dpml_tenant_batch',
      fields: ['tenantId', 'batchId']
    },
    {
      name: 'idx_dpml_exec_status',
      fields: ['autoExecuted', 'executionStatus']
    }
  ]
});

module.exports = DisposalPlanMatchLog;
