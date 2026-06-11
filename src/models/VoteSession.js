const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VoteSession = sequelize.define('VoteSession', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  appealId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  batchId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  round: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  status: {
    type: DataTypes.ENUM('active', 'completed', 'expired'),
    defaultValue: 'active'
  },
  startedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  deadlineAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  totalVoters: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  votesForUphold: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  votesForChange: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  votesForOther: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  outcome: {
    type: DataTypes.ENUM('uphold', 'change', 'other', 'no_consensus'),
    allowNull: true
  },
  outcomeDetails: {
    type: DataTypes.JSON,
    allowNull: true
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  tableName: 'vote_sessions',
  timestamps: true,
  indexes: [
    {
      name: 'idx_vote_session_appeal',
      fields: ['appealId']
    },
    {
      name: 'idx_vote_session_tenant_status',
      fields: ['tenantId', 'status']
    },
    {
      name: 'idx_vote_session_deadline',
      fields: ['status', 'deadlineAt']
    }
  ]
});

module.exports = VoteSession;
