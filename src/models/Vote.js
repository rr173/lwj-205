const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Vote = sequelize.define('Vote', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  voteSessionId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  appealId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  voterId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  voterRole: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'admin'
  },
  voteChoice: {
    type: DataTypes.ENUM('uphold', 'change', 'other'),
    allowNull: false
  },
  alternativeResolutionType: {
    type: DataTypes.ENUM('use_source', 'ignore', 'manual_review'),
    allowNull: true
  },
  alternativePrimarySourceId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  alternativeDescription: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  votedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'votes',
  timestamps: true,
  updatedAt: false,
  indexes: [
    {
      name: 'idx_vote_session_voter',
      fields: ['voteSessionId', 'voterId'],
      unique: true
    },
    {
      name: 'idx_vote_appeal',
      fields: ['appealId']
    },
    {
      name: 'idx_vote_tenant',
      fields: ['tenantId']
    }
  ]
});

module.exports = Vote;
