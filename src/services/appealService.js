const { v4: uuidv4 } = require('uuid');
const {
  Discrepancy,
  ArbitrationTicket,
  AdjustmentInstruction,
  Appeal,
  VoteSession,
  Vote,
  AuditLog,
  sequelize
} = require('../models');
const { Op } = require('sequelize');
const { getCurrentTenantId } = require('../utils/tenantContext');
const arbitrationService = require('./arbitrationService');

const APPEAL_WINDOW_HOURS = 72;
const VOTE_ROUND1_HOURS = 24;
const VOTE_ROUND2_HOURS = 24;
const COOLDOWN_DAYS = 30;
const VOTE_CHECK_INTERVAL_MS = 60 * 1000;

let wsBroadcast = null;
let voteCheckInterval = null;

function setWsBroadcast(fn) {
  wsBroadcast = fn;
}

function broadcastMessage(message) {
  if (wsBroadcast) {
    wsBroadcast(message);
  }
}

async function recordAuditLog(entry) {
  try {
    await AuditLog.create({
      operator: entry.operator || 'system',
      role: entry.role || 'system',
      action: entry.action,
      targetType: entry.targetType || 'appeal',
      targetId: entry.targetId,
      beforeValue: entry.beforeValue || null,
      afterValue: entry.afterValue || null,
      tenantId: entry.tenantId || getCurrentTenantId(),
      ip: entry.ip || null
    });
  } catch (err) {
    console.error('申诉审计日志写入失败:', err.message);
  }
}

async function getTenantAdminUsers(tenantId) {
  const adminRecords = await AuditLog.findAll({
    attributes: ['operator', 'role'],
    where: {
      tenantId,
      role: { [Op.in]: ['admin', 'superadmin'] }
    },
    group: ['operator', 'role'],
    order: [['createdAt', 'DESC']]
  });

  const adminUserIds = [];
  const seen = new Set();
  for (const record of adminRecords) {
    if (!seen.has(record.operator)) {
      seen.add(record.operator);
      adminUserIds.push(record.operator);
    }
  }

  return adminUserIds;
}

async function fileAppeal(ticketId, appellantId, appellantRole, appealReason, requestedResolutionType, requestedPrimarySourceId) {
  const tenantId = getCurrentTenantId();

  const ticket = await ArbitrationTicket.findByPk(ticketId);
  if (!ticket) throw new Error('仲裁工单不存在');

  const discrepancy = await Discrepancy.findByPk(ticket.discrepancyId);
  if (!discrepancy) throw new Error('关联差异不存在');

  const resolvedStatuses = ['auto_resolved', 'manually_resolved', 'ignored', 'review_rejected'];
  if (!resolvedStatuses.includes(ticket.status)) {
    throw new Error(`该工单当前状态为 ${ticket.status}，仅已处置或已驳回的差异可申诉`);
  }

  if (!ticket.resolvedAt && !ticket.rejectedAt) {
    throw new Error('缺少处置时间，无法判断申诉窗口');
  }

  const disposedAt = ticket.resolvedAt || ticket.rejectedAt;
  const hoursSinceDisposed = (Date.now() - new Date(disposedAt).getTime()) / (1000 * 60 * 60);
  if (hoursSinceDisposed > APPEAL_WINDOW_HOURS) {
    throw new Error(`已超过处置后 ${APPEAL_WINDOW_HOURS} 小时的申诉窗口，不可申诉`);
  }

  const existingAppeal = await Appeal.findOne({
    where: { discrepancyId: discrepancy.id, status: { [Op.in]: ['pending', 'voting'] } }
  });
  if (existingAppeal) {
    throw new Error('该差异已有进行中的申诉，不可重复申诉');
  }

  const anyAppeal = await Appeal.findOne({
    where: { discrepancyId: discrepancy.id }
  });
  if (anyAppeal) {
    throw new Error('该差异已发起过申诉，每条差异最多允许发起一次');
  }

  const cooldown = await Appeal.findOne({
    where: {
      appellantId,
      batchId: ticket.batchId,
      status: 'resolved_rejected',
      cooldownUntil: { [Op.gt]: new Date() }
    }
  });
  if (cooldown) {
    throw new Error(`申诉冷却期内，${cooldown.cooldownUntil.toISOString()} 前不能对该批次的其他差异发起新申诉`);
  }

  const validRequestTypes = ['use_source', 'ignore', 'manual_review'];
  if (!validRequestTypes.includes(requestedResolutionType)) {
    throw new Error('无效的期望处置方式，可选：use_source / ignore / manual_review');
  }
  if (requestedResolutionType === 'use_source' && !requestedPrimarySourceId) {
    throw new Error('选择数据源为准时必须提供 requestedPrimarySourceId');
  }

  const result = await sequelize.transaction(async (t) => {
    const previousTicketStatus = ticket.status;
    const previousDiscStatus = discrepancy.status;

    const allAdmins = await getTenantAdminUsers(tenantId);
    const invitedVoters = allAdmins.filter(id => id !== appellantId);

    if (invitedVoters.length === 0) {
      throw new Error('该租户下没有可用的admin投票人，无法创建投票会话');
    }

    const appeal = await Appeal.create({
      id: uuidv4(),
      discrepancyId: discrepancy.id,
      arbitrationTicketId: ticketId,
      batchId: ticket.batchId,
      appealReason,
      requestedResolutionType,
      requestedPrimarySourceId: requestedPrimarySourceId || null,
      status: 'voting',
      appellantId,
      appellantRole: appellantRole || 'operator',
      originalResolutionType: ticket.resolutionType,
      originalPrimarySourceId: ticket.primarySourceId,
      originalNotes: ticket.notes,
      tenantId
    }, { transaction: t });

    await ticket.update({ status: 'appealing' }, { transaction: t });
    await discrepancy.update({ status: 'appealing' }, { transaction: t });

    await AdjustmentInstruction.update(
      { status: 'suspended' },
      {
        where: {
          arbitrationTicketId: ticketId,
          status: { [Op.in]: ['pending', 'executed'] }
        },
        transaction: t
      }
    );

    const voteSession = await VoteSession.create({
      id: uuidv4(),
      appealId: appeal.id,
      batchId: ticket.batchId,
      round: 1,
      status: 'active',
      startedAt: new Date(),
      deadlineAt: new Date(Date.now() + VOTE_ROUND1_HOURS * 60 * 60 * 1000),
      totalVoters: invitedVoters.length,
      invitedVoters: JSON.parse(JSON.stringify(invitedVoters)),
      votesForUphold: 0,
      votesForChange: 0,
      votesForOther: 0,
      tenantId
    }, { transaction: t });

    return { appeal, voteSession, previousTicketStatus, previousDiscStatus, invitedVoters };
  });

  await recordAuditLog({
    operator: appellantId,
    role: appellantRole,
    action: 'FILE_APPEAL',
    targetType: 'appeal',
    targetId: result.appeal.id,
    beforeValue: {
      ticketStatus: result.previousTicketStatus,
      discStatus: result.previousDiscStatus
    },
    afterValue: {
      appealId: result.appeal.id,
      appealReason,
      requestedResolutionType,
      requestedPrimarySourceId: requestedPrimarySourceId || null,
      voteSessionId: result.voteSession.id,
      ticketStatus: 'appealing',
      discStatus: 'appealing',
      totalVoters: result.voteSession.totalVoters,
      invitedVoters: result.invitedVoters
    },
    tenantId
  });

  broadcastMessage({
    type: 'appeal_filed',
    data: {
      appealId: result.appeal.id,
      voteSessionId: result.voteSession.id,
      discrepancyId: discrepancy.id,
      ticketId,
      batchId: ticket.batchId,
      appellantId,
      requestedResolutionType,
      deadlineAt: result.voteSession.deadlineAt
    }
  });

  return result;
}

async function castVote(voteSessionId, voterId, voterRole, voteChoice, alternativeDetails) {
  const tenantId = getCurrentTenantId();

  const session = await VoteSession.findByPk(voteSessionId, {
    include: [{ model: Appeal, as: 'appeal' }]
  });
  if (!session) throw new Error('投票会话不存在');
  if (session.status !== 'active') throw new Error('该投票会话已结束');
  if (new Date() > new Date(session.deadlineAt)) {
    throw new Error('投票已超时');
  }

  if (!['uphold', 'change', 'other'].includes(voteChoice)) {
    throw new Error('无效的投票选项，可选：uphold / change / other');
  }

  if (voteChoice === 'other') {
    if (!alternativeDetails || !alternativeDetails.resolutionType) {
      throw new Error('选择"驳回申诉但改为其他方式"时必须附带具体处置方式');
    }
    const validAltTypes = ['use_source', 'ignore', 'manual_review'];
    if (!validAltTypes.includes(alternativeDetails.resolutionType)) {
      throw new Error('无效的替代处置方式');
    }
    if (alternativeDetails.resolutionType === 'use_source' && !alternativeDetails.primarySourceId) {
      throw new Error('替代方式选择数据源为准时必须提供 primarySourceId');
    }
  }

  if (session.appeal && session.appeal.appellantId === voterId) {
    throw new Error('申诉发起人不能对自己的申诉投票');
  }

  const existingVote = await Vote.findOne({
    where: { voteSessionId, voterId }
  });
  if (existingVote) {
    throw new Error('您已在此投票会话中投过票，不可重复投票');
  }

  const currentInvited = Array.isArray(session.invitedVoters) ? session.invitedVoters : [];
  const isInvited = currentInvited.includes(voterId);

  if (!isInvited) {
    const allAdmins = await getTenantAdminUsers(tenantId);
    const appellantId = session.appeal?.appellantId;
    const validAdmins = allAdmins.filter(id => id !== appellantId);
    const isNewAdmin = validAdmins.includes(voterId);

    if (!isNewAdmin) {
      throw new Error('您不是该投票会话的邀请投票人，无投票权限');
    }

    const newInvited = [...new Set([...currentInvited, voterId])];
    await session.update({
      totalVoters: newInvited.length,
      invitedVoters: JSON.parse(JSON.stringify(newInvited))
    });

    await recordAuditLog({
      operator: 'system',
      role: 'system',
      action: 'NEW_ADMIN_JOINED_VOTE',
      targetType: 'vote_session',
      targetId: voteSessionId,
      afterValue: {
        newVoterId: voterId,
        newVoterRole: voterRole,
        totalVoters: newInvited.length,
        invitedVoters: newInvited
      },
      tenantId
    });
  }

  const refreshedSession = await VoteSession.findByPk(voteSessionId);

  const result = await sequelize.transaction(async (t) => {
    const vote = await Vote.create({
      id: uuidv4(),
      voteSessionId,
      appealId: session.appealId,
      voterId,
      voterRole: voterRole || 'admin',
      voteChoice,
      alternativeResolutionType: alternativeDetails?.resolutionType || null,
      alternativePrimarySourceId: alternativeDetails?.primarySourceId || null,
      alternativeDescription: alternativeDetails?.description || null,
      votedAt: new Date(),
      tenantId
    }, { transaction: t });

    const updates = {};
    if (voteChoice === 'uphold') updates.votesForUphold = refreshedSession.votesForUphold + 1;
    if (voteChoice === 'change') updates.votesForChange = refreshedSession.votesForChange + 1;
    if (voteChoice === 'other') updates.votesForOther = refreshedSession.votesForOther + 1;

    await refreshedSession.update(updates, { transaction: t });

    return { vote, updatedSession: await VoteSession.findByPk(voteSessionId, { transaction: t }) };
  });

  await recordAuditLog({
    operator: voterId,
    role: voterRole,
    action: 'CAST_VOTE',
    targetType: 'vote',
    targetId: result.vote.id,
    afterValue: {
      voteSessionId,
      appealId: session.appealId,
      voteChoice,
      alternativeDetails: alternativeDetails || null
    },
    tenantId
  });

  broadcastMessage({
    type: 'vote_cast',
    data: {
      voteSessionId,
      appealId: session.appealId,
      voterId,
      voteChoice,
      currentTotals: {
        totalVoters: result.updatedSession.totalVoters,
        uphold: result.updatedSession.votesForUphold,
        change: result.updatedSession.votesForChange,
        other: result.updatedSession.votesForOther
      }
    }
  });

  await evaluateVoteSession(voteSessionId, tenantId);

  return result;
}

async function evaluateVoteSession(voteSessionId, explicitTenantId) {
  const tenantId = explicitTenantId || getCurrentTenantId();
  const session = await VoteSession.findByPk(voteSessionId, {
    include: [{ model: Appeal, as: 'appeal' }]
  });
  if (!session || session.status !== 'active') return null;

  const totalVotes = session.votesForUphold + session.votesForChange + session.votesForOther;
  const totalVoters = session.totalVoters;

  if (totalVoters === 0) {
    return null;
  }

  const majorityThreshold = Math.ceil(totalVoters / 2);
  if (totalVotes < majorityThreshold) {
    return null;
  }

  const halfOfVotes = totalVotes / 2;
  let outcome = null;
  let outcomeDetails = null;

  if (session.round === 1) {
    if (session.votesForUphold > halfOfVotes) {
      outcome = 'uphold';
      outcomeDetails = {
        reason: '第一轮：维持原处置得票过半',
        totalVoters,
        totalVotes,
        majorityThreshold,
        votes: {
          uphold: session.votesForUphold,
          change: session.votesForChange,
          other: session.votesForOther
        }
      };
    } else if (session.votesForChange > halfOfVotes) {
      outcome = 'change';
      outcomeDetails = {
        reason: '第一轮：改为申诉方要求得票过半',
        totalVoters,
        totalVotes,
        majorityThreshold,
        votes: {
          uphold: session.votesForUphold,
          change: session.votesForChange,
          other: session.votesForOther
        }
      };
    } else if (session.votesForOther > halfOfVotes) {
      outcome = 'other';
      outcomeDetails = {
        reason: '第一轮：其他方式得票过半',
        totalVoters,
        totalVotes,
        majorityThreshold,
        votes: {
          uphold: session.votesForUphold,
          change: session.votesForChange,
          other: session.votesForOther
        }
      };
    }

    if (!outcome) return null;
  } else if (session.round === 2) {
    const simpleMajority = Math.floor(totalVotes / 2) + 1;

    if (session.votesForUphold >= simpleMajority) {
      outcome = 'uphold';
      outcomeDetails = {
        reason: '第二轮简单多数：维持原处置',
        totalVoters,
        totalVotes,
        simpleMajority,
        votes: {
          uphold: session.votesForUphold,
          change: session.votesForChange,
          other: session.votesForOther
        }
      };
    } else if (session.votesForChange >= simpleMajority) {
      outcome = 'change';
      outcomeDetails = {
        reason: '第二轮简单多数：改为申诉方要求',
        totalVoters,
        totalVotes,
        simpleMajority,
        votes: {
          uphold: session.votesForUphold,
          change: session.votesForChange,
          other: session.votesForOther
        }
      };
    } else if (session.votesForOther >= simpleMajority) {
      outcome = 'other';
      outcomeDetails = {
        reason: '第二轮简单多数：其他方式',
        totalVoters,
        totalVotes,
        simpleMajority,
        votes: {
          uphold: session.votesForUphold,
          change: session.votesForChange,
          other: session.votesForOther
        }
      };
    } else {
      outcome = 'no_consensus';
      outcomeDetails = {
        reason: '第二轮仍无结论，维持原处置',
        totalVoters,
        totalVotes,
        simpleMajority,
        votes: {
          uphold: session.votesForUphold,
          change: session.votesForChange,
          other: session.votesForOther
        }
      };
    }
  }

  if (outcome) {
    await session.update({
      status: 'completed',
      outcome,
      outcomeDetails,
      completedAt: new Date()
    });

    await executeVoteOutcome(session.appealId, outcome, session, tenantId);
  }

  return outcome;
}

async function startSecondRound(voteSessionId, tenantId) {
  const session = await VoteSession.findByPk(voteSessionId, {
    include: [{ model: Appeal, as: 'appeal' }]
  });
  if (!session || session.status !== 'active') return;

  await session.update({ status: 'expired' });

  const currentInvited = Array.isArray(session.invitedVoters) ? session.invitedVoters : [];
  const allAdmins = await getTenantAdminUsers(tenantId);
  const appellantId = session.appeal?.appellantId;
  const validAdmins = allAdmins.filter(id => id !== appellantId);
  const mergedVoters = [...new Set([...currentInvited, ...validAdmins])];

  const newSession = await VoteSession.create({
    id: uuidv4(),
    appealId: session.appealId,
    batchId: session.batchId,
    round: 2,
    status: 'active',
    startedAt: new Date(),
    deadlineAt: new Date(Date.now() + VOTE_ROUND2_HOURS * 60 * 60 * 1000),
    totalVoters: mergedVoters.length,
    invitedVoters: JSON.parse(JSON.stringify(mergedVoters)),
    votesForUphold: 0,
    votesForChange: 0,
    votesForOther: 0,
    tenantId
  });

  await recordAuditLog({
    operator: 'system',
    role: 'system',
    action: 'APPEAL_VOTE_SECOND_ROUND',
    targetType: 'vote_session',
    targetId: newSession.id,
    afterValue: {
      appealId: session.appealId,
      previousSessionId: voteSessionId,
      round: 2,
      deadlineAt: newSession.deadlineAt
    },
    tenantId
  });

  broadcastMessage({
    type: 'appeal_vote_second_round',
    data: {
      appealId: session.appealId,
      previousSessionId: voteSessionId,
      newSessionId: newSession.id,
      round: 2,
      deadlineAt: newSession.deadlineAt
    }
  });

  return newSession;
}

async function executeVoteOutcome(appealId, outcome, voteSession, tenantId) {
  const appeal = await Appeal.findByPk(appealId, {
    include: [
      { model: ArbitrationTicket, as: 'arbitrationTicket' },
      { model: Discrepancy, as: 'discrepancy' }
    ]
  });
  if (!appeal) throw new Error('申诉不存在');

  const ticket = appeal.arbitrationTicket;
  const discrepancy = appeal.discrepancy;
  const effectiveOutcome = outcome === 'no_consensus' ? 'uphold' : outcome;

  await sequelize.transaction(async (t) => {
    if (effectiveOutcome === 'uphold') {
      const originalStatus = mapOriginalResolutionToTicketStatus(appeal.originalResolutionType);
      const originalDiscStatus = mapOriginalResolutionToDiscStatus(appeal.originalResolutionType);

      await ticket.update({ status: originalStatus }, { transaction: t });
      await discrepancy.update({ status: originalDiscStatus }, { transaction: t });

      await AdjustmentInstruction.update(
        { status: 'pending' },
        {
          where: {
            arbitrationTicketId: ticket.id,
            status: 'suspended'
          },
          transaction: t
        }
      );

      await appeal.update({
        status: 'resolved_upheld',
        resolvedAt: new Date(),
        resolutionOutcome: 'upheld'
      }, { transaction: t });

    } else if (effectiveOutcome === 'change') {
      await AdjustmentInstruction.destroy({
        where: { arbitrationTicketId: ticket.id },
        transaction: t,
        force: true
      });

      await ticket.update({
        status: 'auto_resolved',
        resolutionType: appeal.requestedResolutionType,
        primarySourceId: appeal.requestedPrimarySourceId,
        resolvedBy: 'appeal_vote',
        resolvedAt: new Date(),
        notes: `申诉投票结果：改为申诉方要求的方式。原处置：${appeal.originalResolutionType}。申诉理由：${appeal.appealReason}`
      }, { transaction: t });

      const discStatus = mapOriginalResolutionToDiscStatus(appeal.requestedResolutionType);
      await discrepancy.update({ status: discStatus }, { transaction: t });

      if (appeal.requestedResolutionType === 'use_source' && appeal.requestedPrimarySourceId) {
        await arbitrationService.generateAdjustmentInstructions(
          ticket,
          discrepancy,
          appeal.requestedPrimarySourceId,
          { transaction: t }
        );
      }

      await appeal.update({
        status: 'resolved_changed',
        resolvedAt: new Date(),
        resolutionOutcome: 'change'
      }, { transaction: t });

    } else if (effectiveOutcome === 'other') {
      const otherVotes = await Vote.findAll({
        where: {
          voteSessionId: voteSession.id,
          voteChoice: 'other',
          alternativeResolutionType: { [Op.ne]: null }
        },
        order: [['votedAt', 'ASC']]
      });

      const winningOther = otherVotes[0];
      if (!winningOther) {
        await AdjustmentInstruction.update(
          { status: 'pending' },
          {
            where: {
              arbitrationTicketId: ticket.id,
              status: 'suspended'
            },
            transaction: t
          }
        );

        const originalStatus = mapOriginalResolutionToTicketStatus(appeal.originalResolutionType);
        const originalDiscStatus = mapOriginalResolutionToDiscStatus(appeal.originalResolutionType);
        await ticket.update({ status: originalStatus }, { transaction: t });
        await discrepancy.update({ status: originalDiscStatus }, { transaction: t });

        await appeal.update({
          status: 'resolved_upheld',
          resolvedAt: new Date(),
          resolutionOutcome: 'uphold_fallback_no_alt'
        }, { transaction: t });
      } else {
        await AdjustmentInstruction.destroy({
          where: { arbitrationTicketId: ticket.id },
          transaction: t,
          force: true
        });

        await ticket.update({
          status: 'auto_resolved',
          resolutionType: winningOther.alternativeResolutionType,
          primarySourceId: winningOther.alternativePrimarySourceId,
          resolvedBy: 'appeal_vote_other',
          resolvedAt: new Date(),
          notes: `申诉投票结果：驳回申诉但改为其他方式。${winningOther.alternativeDescription || ''}`
        }, { transaction: t });

        const discStatus = mapOriginalResolutionToDiscStatus(winningOther.alternativeResolutionType);
        await discrepancy.update({ status: discStatus }, { transaction: t });

        if (winningOther.alternativeResolutionType === 'use_source' && winningOther.alternativePrimarySourceId) {
          await arbitrationService.generateAdjustmentInstructions(
            ticket,
            discrepancy,
            winningOther.alternativePrimarySourceId,
            { transaction: t }
          );
        }

        await appeal.update({
          status: 'resolved_rejected',
          resolvedAt: new Date(),
          resolutionOutcome: 'other',
          cooldownUntil: new Date(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
        }, { transaction: t });
      }
    }
  });

  await recordAuditLog({
    operator: 'system',
    role: 'system',
    action: 'APPEAL_RESOLVED',
    targetType: 'appeal',
    targetId: appealId,
    afterValue: {
      outcome: effectiveOutcome,
      originalOutcome: outcome,
      appealStatus: appeal.status,
      ticketStatus: ticket.status,
      discStatus: discrepancy.status,
      voteSessionId: voteSession.id,
      voteSessionRound: voteSession.round
    },
    tenantId
  });

  broadcastMessage({
    type: 'appeal_resolved',
    data: {
      appealId,
      outcome: effectiveOutcome,
      originalOutcome: outcome,
      ticketId: ticket.id,
      discrepancyId: discrepancy.id,
      batchId: ticket.batchId
    }
  });
}

function mapOriginalResolutionToTicketStatus(resolutionType) {
  switch (resolutionType) {
    case 'ignore': return 'ignored';
    case 'manual_review': return 'pending_review';
    case 'use_source': return 'auto_resolved';
    case 'manually_resolved': return 'manually_resolved';
    default: return 'auto_resolved';
  }
}

function mapOriginalResolutionToDiscStatus(resolutionType) {
  switch (resolutionType) {
    case 'ignore': return 'ignored';
    case 'manual_review': return 'pending_review';
    case 'use_source': return 'resolved';
    case 'manually_resolved': return 'resolved';
    default: return 'resolved';
  }
}

async function checkAndHandleExpiredVoteSessions() {
  const now = new Date();

  const expiredSessions = await VoteSession.findAll({
    where: {
      status: 'active',
      deadlineAt: { [Op.lte]: now }
    }
  });

  let handled = 0;

  for (const session of expiredSessions) {
    try {
      const totalVotes = session.votesForUphold + session.votesForChange + session.votesForOther;
      const totalVoters = session.totalVoters;

      if (totalVoters === 0) {
        console.warn(`投票会话 ${session.id} 的 totalVoters 为0，跳过处理`);
        continue;
      }

      if (session.round === 1) {
        if (totalVotes > 0) {
          const halfOfVotes = totalVotes / 2;
          let outcome = null;

          if (session.votesForUphold > halfOfVotes) {
            outcome = 'uphold';
          } else if (session.votesForChange > halfOfVotes) {
            outcome = 'change';
          } else if (session.votesForOther > halfOfVotes) {
            outcome = 'other';
          }

          if (outcome) {
            await session.update({
              status: 'completed',
              outcome,
              outcomeDetails: {
                reason: '第一轮超时但已有选项得票过半',
                totalVoters,
                totalVotes,
                votes: {
                  uphold: session.votesForUphold,
                  change: session.votesForChange,
                  other: session.votesForOther
                }
              },
              completedAt: new Date()
            });
            await executeVoteOutcome(session.appealId, outcome, session, session.tenantId);
            handled++;
            continue;
          }
        }

        await startSecondRound(session.id, session.tenantId);
        handled++;
      } else if (session.round === 2) {
        const simpleMajority = totalVotes > 0 ? Math.floor(totalVotes / 2) + 1 : 0;
        let outcome = 'no_consensus';
        let reason = '第二轮仍无结论，维持原处置';

        if (simpleMajority > 0) {
          if (session.votesForUphold >= simpleMajority) {
            outcome = 'uphold';
            reason = '第二轮超时但维持原处置达简单多数';
          } else if (session.votesForChange >= simpleMajority) {
            outcome = 'change';
            reason = '第二轮超时但改为申诉方要求达简单多数';
          } else if (session.votesForOther >= simpleMajority) {
            outcome = 'other';
            reason = '第二轮超时但其他方式达简单多数';
          }
        }

        await session.update({
          status: 'completed',
          outcome,
          outcomeDetails: {
            reason,
            totalVoters,
            totalVotes,
            simpleMajority,
            votes: {
              uphold: session.votesForUphold,
              change: session.votesForChange,
              other: session.votesForOther
            }
          },
          completedAt: new Date()
        });
        await executeVoteOutcome(session.appealId, outcome, session, session.tenantId);
        handled++;
      }
    } catch (err) {
      console.error(`处理过期投票会话失败，会话ID: ${session.id}`, err.message);
    }
  }

  return { handled, total: expiredSessions.length };
}

function startVoteExpiryCheck() {
  if (voteCheckInterval) {
    clearInterval(voteCheckInterval);
  }

  voteCheckInterval = setInterval(async () => {
    try {
      const result = await checkAndHandleExpiredVoteSessions();
      if (result.handled > 0) {
        console.log(`[Appeal] 处理了 ${result.handled} 个过期投票会话`);
      }
    } catch (err) {
      console.error('[Appeal] 投票过期检查失败:', err.message);
    }
  }, VOTE_CHECK_INTERVAL_MS);

  console.log('[Appeal] 投票过期检查任务已启动');
}

function stopVoteExpiryCheck() {
  if (voteCheckInterval) {
    clearInterval(voteCheckInterval);
    voteCheckInterval = null;
    console.log('[Appeal] 投票过期检查任务已停止');
  }
}

async function getAppeals(filters = {}) {
  const tenantId = getCurrentTenantId();
  const where = { tenantId };

  if (filters.batchId) where.batchId = filters.batchId;
  if (filters.status) where.status = filters.status;
  if (filters.discrepancyId) where.discrepancyId = filters.discrepancyId;
  if (filters.arbitrationTicketId) where.arbitrationTicketId = filters.arbitrationTicketId;
  if (filters.appellantId) where.appellantId = filters.appellantId;

  const { count, rows } = await Appeal.findAndCountAll({
    where,
    include: [
      { model: VoteSession, as: 'voteSessions', include: [{ model: Vote, as: 'votes' }] }
    ],
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(filters.limit) || 50, 200),
    offset: parseInt(filters.offset) || 0
  });

  return { total: count, data: rows };
}

async function getAppealById(appealId) {
  const tenantId = getCurrentTenantId();
  const appeal = await Appeal.findOne({
    where: { id: appealId, tenantId },
    include: [
      { model: VoteSession, as: 'voteSessions', include: [{ model: Vote, as: 'votes' }] },
      { model: Discrepancy, as: 'discrepancy' },
      { model: ArbitrationTicket, as: 'arbitrationTicket' }
    ]
  });
  if (!appeal) throw new Error('申诉不存在');
  return appeal;
}

async function getVoteSessions(filters = {}) {
  const tenantId = getCurrentTenantId();
  const where = { tenantId };

  if (filters.appealId) where.appealId = filters.appealId;
  if (filters.status) where.status = filters.status;
  if (filters.round) where.round = parseInt(filters.round);

  const { count, rows } = await VoteSession.findAndCountAll({
    where,
    include: [{ model: Vote, as: 'votes' }],
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(filters.limit) || 50, 200),
    offset: parseInt(filters.offset) || 0
  });

  return { total: count, data: rows };
}

async function getActiveVoteSessionForAppeal(appealId) {
  const tenantId = getCurrentTenantId();
  return VoteSession.findOne({
    where: { appealId, status: 'active', tenantId },
    include: [{ model: Vote, as: 'votes' }]
  });
}

async function canFileAppeal(ticketId, appellantId) {
  const ticket = await ArbitrationTicket.findByPk(ticketId);
  if (!ticket) return { canAppeal: false, reason: '仲裁工单不存在' };

  const resolvedStatuses = ['auto_resolved', 'manually_resolved', 'ignored', 'review_rejected'];
  if (!resolvedStatuses.includes(ticket.status)) {
    return { canAppeal: false, reason: `当前状态 ${ticket.status} 不可申诉，仅已处置或已驳回的差异可申诉` };
  }

  const disposedAt = ticket.resolvedAt || ticket.rejectedAt;
  if (!disposedAt) return { canAppeal: false, reason: '缺少处置时间' };

  const hoursSinceDisposed = (Date.now() - new Date(disposedAt).getTime()) / (1000 * 60 * 60);
  if (hoursSinceDisposed > APPEAL_WINDOW_HOURS) {
    return { canAppeal: false, reason: `已超过 ${APPEAL_WINDOW_HOURS} 小时申诉窗口` };
  }

  const existingAppeal = await Appeal.findOne({
    where: { discrepancyId: ticket.discrepancyId }
  });
  if (existingAppeal) {
    return { canAppeal: false, reason: '该差异已发起过申诉，每条差异最多允许一次' };
  }

  const cooldown = await Appeal.findOne({
    where: {
      appellantId,
      batchId: ticket.batchId,
      status: 'resolved_rejected',
      cooldownUntil: { [Op.gt]: new Date() }
    }
  });
  if (cooldown) {
    return { canAppeal: false, reason: `申诉冷却期内，${cooldown.cooldownUntil.toISOString()} 前不能对该批次发起新申诉` };
  }

  return { canAppeal: true, reason: '' };
}

async function getAppealStats(filters = {}) {
  const tenantId = getCurrentTenantId();
  const where = { tenantId };
  if (filters.batchId) where.batchId = filters.batchId;

  const [pendingCount, votingCount, upheldCount, changedCount, rejectedCount, dismissedCount] = await Promise.all([
    Appeal.count({ where: { ...where, status: 'pending' } }),
    Appeal.count({ where: { ...where, status: 'voting' } }),
    Appeal.count({ where: { ...where, status: 'resolved_upheld' } }),
    Appeal.count({ where: { ...where, status: 'resolved_changed' } }),
    Appeal.count({ where: { ...where, status: 'resolved_rejected' } }),
    Appeal.count({ where: { ...where, status: 'dismissed' } })
  ]);

  return {
    pending: pendingCount,
    voting: votingCount,
    upheld: upheldCount,
    changed: changedCount,
    rejected: rejectedCount,
    dismissed: dismissedCount,
    total: pendingCount + votingCount + upheldCount + changedCount + rejectedCount + dismissedCount
  };
}

module.exports = {
  setWsBroadcast,
  fileAppeal,
  castVote,
  evaluateVoteSession,
  startSecondRound,
  executeVoteOutcome,
  checkAndHandleExpiredVoteSessions,
  startVoteExpiryCheck,
  stopVoteExpiryCheck,
  getAppeals,
  getAppealById,
  getVoteSessions,
  getActiveVoteSessionForAppeal,
  canFileAppeal,
  getAppealStats,
  APPEAL_WINDOW_HOURS,
  VOTE_ROUND1_HOURS,
  VOTE_ROUND2_HOURS,
  COOLDOWN_DAYS
};
