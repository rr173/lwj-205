const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DisposalPlan = sequelize.define('DisposalPlan', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  matchConditions: {
    type: DataTypes.JSON,
    allowNull: false,
    validate: {
      isValidConditions(value) {
        if (!value || typeof value !== 'object') {
          throw new Error('匹配条件不能为空');
        }
        const hasField = value.discrepancyTypes ||
          (value.amountDiffMin !== undefined && value.amountDiffMin !== null) ||
          (value.amountDiffMax !== undefined && value.amountDiffMax !== null) ||
          value.dataSourceNamePattern ||
          value.summaryKeyword;
        if (!hasField) {
          throw new Error('匹配条件至少需要指定一个条件字段');
        }
      }
    }
  },
  action: {
    type: DataTypes.JSON,
    allowNull: false,
    validate: {
      isValidAction(value) {
        if (!value || !value.resolutionType) {
          throw new Error('处置动作必须指定处置方式');
        }
        const validTypes = ['use_source', 'ignore', 'manual_review'];
        if (!validTypes.includes(value.resolutionType)) {
          throw new Error(`处置方式必须为: ${validTypes.join('/')}`);
        }
        if (value.resolutionType === 'use_source' && !value.primarySourceId) {
          throw new Error('处置方式为"以某源为准"时必须指定优先数据源');
        }
      }
    }
  },
  priority: {
    type: DataTypes.INTEGER,
    defaultValue: 100
  },
  isEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  isDeleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  efficiencyTag: {
    type: DataTypes.ENUM('normal', 'low_efficiency'),
    defaultValue: 'normal'
  },
  hitCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lastHitAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  coveredAmount: {
    type: DataTypes.DECIMAL(18, 4),
    defaultValue: 0
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'disposal_plans',
  timestamps: true,
  indexes: [
    {
      name: 'idx_dp_tenant_priority',
      fields: ['tenantId', 'priority', 'isEnabled']
    },
    {
      name: 'idx_dp_tenant_efficiency',
      fields: ['tenantId', 'efficiencyTag']
    }
  ]
});

module.exports = DisposalPlan;
