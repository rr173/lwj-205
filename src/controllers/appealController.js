const appealService = require('../services/appealService');

async function fileAppeal(req, res) {
  try {
    const { ticketId } = req.params;
    const { appealReason, requestedResolutionType, requestedPrimarySourceId } = req.body;
    const appellantId = req.user.id;
    const appellantRole = req.user.role;

    if (!appealReason || !appealReason.trim()) {
      return res.status(400).json({ error: '申诉必须提供理由' });
    }

    if (!requestedResolutionType) {
      return res.status(400).json({ error: '申诉必须提供期望的新处置方式' });
    }

    const result = await appealService.fileAppeal(
      ticketId,
      appellantId,
      appellantRole,
      appealReason.trim(),
      requestedResolutionType,
      requestedPrimarySourceId
    );

    res.status(201).json({
      message: '申诉已提交，投票会话已创建',
      appeal: result.appeal,
      voteSession: result.voteSession
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function canFileAppeal(req, res) {
  try {
    const { ticketId } = req.params;
    const appellantId = req.user.id;
    const result = await appealService.canFileAppeal(ticketId, appellantId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function castVote(req, res) {
  try {
    const { voteSessionId } = req.params;
    const { voteChoice, alternativeResolutionType, alternativePrimarySourceId, alternativeDescription } = req.body;
    const voterId = req.user.id;
    const voterRole = req.user.role;

    if (!voteChoice) {
      return res.status(400).json({ error: '必须选择投票选项' });
    }

    const alternativeDetails = voteChoice === 'other' ? {
      resolutionType: alternativeResolutionType,
      primarySourceId: alternativePrimarySourceId,
      description: alternativeDescription
    } : null;

    const result = await appealService.castVote(
      voteSessionId,
      voterId,
      voterRole,
      voteChoice,
      alternativeDetails
    );

    res.json({
      message: '投票成功',
      vote: result.vote,
      sessionTotals: {
        totalVoters: result.updatedSession.totalVoters,
        uphold: result.updatedSession.votesForUphold,
        change: result.updatedSession.votesForChange,
        other: result.updatedSession.votesForOther
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function getAppeals(req, res) {
  try {
    const result = await appealService.getAppeals(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getAppealById(req, res) {
  try {
    const { appealId } = req.params;
    const appeal = await appealService.getAppealById(appealId);
    res.json(appeal);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
}

async function getVoteSessions(req, res) {
  try {
    const result = await appealService.getVoteSessions(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getActiveVoteSession(req, res) {
  try {
    const { appealId } = req.params;
    const session = await appealService.getActiveVoteSessionForAppeal(appealId);
    if (!session) {
      return res.json({ message: '该申诉没有进行中的投票会话', session: null });
    }
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function getAppealStats(req, res) {
  try {
    const stats = await appealService.getAppealStats(req.query);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  fileAppeal,
  canFileAppeal,
  castVote,
  getAppeals,
  getAppealById,
  getVoteSessions,
  getActiveVoteSession,
  getAppealStats
};
