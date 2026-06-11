const reviewService = require('../services/reviewService');

function friendlyError(err) {
  const msg = (err && err.message) ? err.message : String(err);
  if (/SQLITE_BUSY|busy_timeout|database is locked/i.test(msg)) {
    return '数据库繁忙，请稍后重试';
  }
  return msg;
}

async function getConfigs(req, res) {
  try {
    const result = await reviewService.listReviewConfigs(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

async function getActiveConfig(req, res) {
  try {
    const config = await reviewService.getActiveReviewConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

async function createConfig(req, res) {
  try {
    const operator = req.user?.id || 'admin';
    const config = await reviewService.createReviewConfig(req.body, operator);
    res.status(201).json(config);
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function updateConfig(req, res) {
  try {
    const { configId } = req.params;
    const operator = req.user?.id || 'admin';
    const config = await reviewService.updateReviewConfig(configId, req.body, operator);
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function determineReview(req, res) {
  try {
    const { batchId } = req.params;
    const result = await reviewService.determineReviewRequirement(batchId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function assignReviewer(req, res) {
  try {
    const { recordId } = req.params;
    const { reviewerId, reviewerRole } = req.body;
    const assigner = req.user?.id || 'admin';
    const assignerRole = req.user?.role || 'admin';

    if (!reviewerId) {
      return res.status(400).json({ error: '必须指定复核人ID' });
    }

    const result = await reviewService.assignReviewer(
      recordId,
      reviewerId,
      reviewerRole || 'operator',
      assigner,
      assignerRole
    );
    res.json({ message: '指派成功', record: result });
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function approveReview(req, res) {
  try {
    const { recordId } = req.params;
    const { comment } = req.body;
    const approver = req.user?.id;
    const approverRole = req.user?.role || 'operator';

    if (!approver) {
      return res.status(401).json({ error: '未获取到用户信息，请检查请求头' });
    }

    const result = await reviewService.approveReview(
      recordId,
      comment || '',
      approver,
      approverRole
    );

    const message = result.flowStatus === 'fully_approved'
      ? '复核通过，差异已进入可处置状态'
      : '一级复核通过，已流转至下一级复核';

    res.json({
      message,
      flowStatus: result.flowStatus,
      record: result.record,
      nextRecord: result.nextRecord
    });
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function rejectReview(req, res) {
  try {
    const { recordId } = req.params;
    const { reason } = req.body;
    const rejector = req.user?.id;
    const rejectorRole = req.user?.role || 'operator';

    if (!rejector) {
      return res.status(401).json({ error: '未获取到用户信息，请检查请求头' });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: '驳回必须提供驳回原因' });
    }

    const result = await reviewService.rejectReview(
      recordId,
      reason,
      rejector,
      rejectorRole
    );

    res.json({
      message: '驳回成功',
      record: result.record
    });
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function getRecords(req, res) {
  try {
    const result = await reviewService.getReviewRecords(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

async function getProgress(req, res) {
  try {
    const { discrepancyId } = req.params;
    const progress = await reviewService.getReviewProgress(discrepancyId);
    res.json(progress);
  } catch (err) {
    res.status(404).json({ error: friendlyError(err) });
  }
}

async function getStats(req, res) {
  try {
    const stats = await reviewService.getReviewStats(req.query);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

async function escalateReview(req, res) {
  try {
    const { recordId } = req.params;
    const { reason } = req.body;
    const operator = req.user?.id || 'admin';

    const result = await reviewService.escalateReview(
      recordId,
      reason || 'manual_escalation',
      operator
    );

    if (result.skipped) {
      return res.status(400).json({ error: result.reason });
    }

    res.json({
      message: '升级成功',
      originalRecord: result.originalRecord,
      escalatedRecord: result.escalatedRecord
    });
  } catch (err) {
    res.status(400).json({ error: friendlyError(err) });
  }
}

async function canDispose(req, res) {
  try {
    const { ticketId } = req.params;
    const result = await reviewService.canDispose(ticketId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
}

module.exports = {
  getConfigs,
  getActiveConfig,
  createConfig,
  updateConfig,
  determineReview,
  assignReviewer,
  approveReview,
  rejectReview,
  getRecords,
  getProgress,
  getStats,
  escalateReview,
  canDispose
};
