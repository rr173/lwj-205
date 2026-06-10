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
    comment: '超过多少天的已完成批次自动归档'
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
    comment: '每天几点执行自动归档（0-23）'
  },
  batchStatusFilter: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: ['completed'],
    comment: '哪些状态的批次可以被归档'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'archive_configs',
  timestamps: true
});

module.exports = ArchiveConfig;
