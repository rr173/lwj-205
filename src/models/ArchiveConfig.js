const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ArchiveConfig = sequelize.define('ArchiveConfig', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  retentionDays: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 30,
    comment: '超过多少天的已完成批次自动归档',
    validate: {
      min: {
        args: [1],
        msg: '保留天数最少为1天'
      },
      max: {
        args: [3650],
        msg: '保留天数最多为3650天（10年）'
      },
      isInt: {
        msg: '保留天数必须为整数'
      }
    }
  },
  autoArchiveEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  dailyRunHour: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 4,
    comment: '每天几点执行自动归档（0-23）',
    validate: {
      min: {
        args: [0],
        msg: '执行时间必须在0-23之间'
      },
      max: {
        args: [23],
        msg: '执行时间必须在0-23之间'
      },
      isInt: {
        msg: '执行时间必须为整数'
      }
    }
  },
  batchStatusFilter: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: ['completed'],
    comment: '哪些状态的批次可以被归档'
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'archive_configs',
  timestamps: true,
  indexes: [
    {
      name: 'idx_ac_tenant_name',
      unique: true,
      fields: ['tenantId', 'name']
    }
  ]
});

module.exports = ArchiveConfig;
