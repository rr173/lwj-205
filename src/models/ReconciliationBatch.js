const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ReconciliationBatch = sequelize.define('ReconciliationBatch', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  batchNo: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'running', 'completed', 'failed', 'queued'),
    defaultValue: 'pending'
  },
  totalRecords: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  matchedCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  discrepancyCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  uniqueTransactionCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  endTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  config: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {
      timeToleranceSeconds: 300,
      amountTolerance: 0.01,
      dataSourceIds: []
    }
  },
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  isArchived: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  archivedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  archiveLock: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '归档/回迁操作锁，防止并发冲突'
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: '批次创建人'
  }
}, {
  tableName: 'reconciliation_batches',
  timestamps: true,
  indexes: [
    {
      name: 'idx_batch_tenant_no',
      unique: true,
      fields: ['tenantId', 'batchNo']
    },
    {
      name: 'idx_batch_tenant_status',
      fields: ['tenantId', 'status']
    }
  ]
});

module.exports = ReconciliationBatch;
