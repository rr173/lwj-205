const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
  Discrepancy,
  ArbitrationTicket,
  ReconciliationBatch,
  ReviewConfig,
  ReviewRecord,
  AuditLog,
  AlertEvent,
  sequelize
} = require('../models');
const { getCurrentTenantId } = require('../utils/tenantContext');

let wsBroadcast = null;
let timeoutCheckInterval = null;
const TIMEOUT_CHECK_INTERVAL_MS = 60 * 1000;

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
      targetType: entry.targetType || 'review',
      targetId: entry.targetId,
      beforeValue: entry.beforeValue || null,
      afterValue: entry.afterValue || null,
      tenantId: entry.tenantId || getCurrentTenantId(),
      ip: entry.ip || null
    });
  } catch (err) {
    console.error('复核审计日志写入失败:', err.message);
  }
}

async function getActiveReviewConfig(tenantId = null) {
  const tid = tenantId || getCurrentTenantId();
  let config = await ReviewConfig.findOne({
    where: { tenantId: tid, isActive: true },
    order: [['createdAt', 'DESC']]
  });

  if (!config) {
    config = await ensureDefaultConfig(tid);
  }

  return config;
}

async function ensureDefaultConfig(tenantId) {
  const existing = await ReviewConfig.findOne({
    where: { tenantId, isActive: true }
  });
  if (existing) return existing;

  return await ReviewConfig.create({
    id: uuidv4(),
    name: '默认复核配置',
    description: '系统默认复核配置',
    isActive: true,
    amountReviewThreshold: 1000,
    amountHighThreshold: 10000,
    timeOffsetSeverityMultiplier: 2,
    reviewTimeoutHours: 48,
    autoEscalateEnabled: true,
    tenantId
  });
}

async function createReviewConfig(configData, operator = 'system') {
  const tenantId = getCurrentTenantId();

  const result = await sequelize.transaction(async (t) => {
    await ReviewConfig.update(
      { isActive: false },
      { where: { tenantId, isActive: true }, transaction: t }
    );

    const config = await ReviewConfig.create({
      ...configData,
      tenantId,
      isActive: true
    }, { transaction: t });

    return config;
  });

  await recordAuditLog({
    operator,
    role: 'admin',
    action: 'CREATE_REVIEW_CONFIG',
    targetType: 'review_config',
    targetId: result.id,
    afterValue: result.toJSON(),
    tenantId
  });

  return result;
}

async function updateReviewConfig(configId, configData, operator = 'system') {
  const tenantId = getCurrentTenantId();
  const config = await ReviewConfig.findByPk(configId);
  if (!config) throw new Error('复核配置不存在');

  const beforeValue = config.toJSON();
  await config.update(configData);
  const afterValue = config.toJSON();

  await recordAuditLog({
    operator,
    role: 'admin',
    action: 'UPDATE_REVIEW_CONFIG',
    targetType: 'review_config',
    targetId: configId,
    beforeValue,
    afterValue,
    tenantId
  });

  return config;
}

async function listReviewConfigs(filters = {}) {
  const tenantId = getCurrentTenantId();
  const where = { tenantId };
  if (filters.isActive !== undefined) {
    where.isActive = filters.isActive === 'true';
  }

  const { count, rows } = await ReviewConfig.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(filters.limit) || 50, 200),
    offset: parseInt(filters.offset) || 0
  });

  return { total: count, data: rows };
}

async function determineReviewRequirement(batchId) {
  const tenantId = getCurrentTenantId();
  const config = await getActiveReviewConfig(tenantId);
  const batch = await ReconciliationBatch.findByPk(batchId);
  if (!batch) throw new Error('批次不存在');

  const discrepancies = await Discrepancy.findAll({
    where: {
      batchId,
      tenantId,
      reviewStatus: { [Op.in]: ['not_required'] }
    }
  });

  const tickets = await ArbitrationTicket.findAll({
    where: { batchId, tenantId }
  });
  const ticketMap = {};
  for (const ticket of tickets) {
    ticketMap[ticket.discrepancyId] = ticket;
  }

  const timeTolerance = batch.config?.timeToleranceSeconds || 300;
  const severeTimeThreshold = timeTolerance * (config.timeOffsetSeverityMultiplier || 2);

  const results = [];

  for (const disc of discrepancies) {
    const ticket = ticketMap[disc.id];
    if (!ticket) continue;

    let needReview = false;
    let reviewLevel = 1;
    let reviewReason = '';

    if (disc.type === 'amount_mismatch' && disc.amountDiff) {
      const amountDiff = parseFloat(disc.amountDiff);
      if (amountDiff >= parseFloat(config.amountHighThreshold)) {
        needReview = true;
        reviewLevel = 2;
        reviewReason = `金额差异${amountDiff}元，超过高额阈值${config.amountHighThreshold}元，需两级复核`;
      } else if (amountDiff >= parseFloat(config.amountReviewThreshold)) {
        needReview = true;
        reviewLevel = 1;
        reviewReason = `金额差异${amountDiff}元，超过复核阈值${config.amountReviewThreshold}元，需一级复核`;
      }
    }

    if (disc.type === 'time_offset' && disc.timeDiffSeconds) {
      if (disc.timeDiffSeconds >= severeTimeThreshold) {
        needReview = true;
        reviewLevel = 1;
        reviewReason = `时间偏移${disc.timeDiffSeconds}秒，超过严重偏移阈值${severeTimeThreshold}秒（阈值${timeTolerance}秒×${config.timeOffsetSeverityMultiplier}倍）`;
      }
    }

    if (needReview) {
      const deadlineAt = new Date(Date.now() + config.reviewTimeoutHours * 60 * 60 * 1000);

      await disc.update({
        reviewStatus: 'pending_review',
        reviewRequired: true,
        currentReviewLevel: 1,
        reviewLevelRequired: reviewLevel,
        reviewDeadlineAt: deadlineAt,
        status: 'reviewing'
      });

      await ticket.update({
        reviewStatus: 'pending_review',
        reviewRequired: true,
        currentReviewLevel: 1,
        reviewLevelRequired: reviewLevel,
        reviewDeadlineAt: deadlineAt,
        status: 'reviewing',
        createdBy: batch.createdBy || null
      });

      await ReviewRecord.create({
        id: uuidv4(),
        discrepancyId: disc.id,
        arbitrationTicketId: ticket.id,
        batchId,
        reviewLevel: 1,
        status: 'pending',
        deadlineAt,
        triggerType: 'auto',
        tenantId
      });

      results.push({
        discrepancyId: disc.id,
        ticketId: ticket.id,
        needReview: true,
        reviewLevel,
        reviewReason,
        deadlineAt
      });
    } else {
      await disc.update({
        reviewStatus: 'not_required',
        reviewRequired: false,
        currentReviewLevel: null,
        reviewLevelRequired: null,
        reviewDeadlineAt: null
      });

      await ticket.update({
        reviewStatus: 'not_required',
        reviewRequired: false,
        currentReviewLevel: null,
        reviewLevelRequired: null,
        reviewDeadlineAt: null,
        createdBy: batch.createdBy || null
      });

      results.push({
        discrepancyId: disc.id,
        ticketId: ticket.id,
        needReview: false
      });
    }
  }

  await recordAuditLog({
    operator: 'system',
    role: 'system',
    action: 'AUTO_REVIEW_DETERMINE',
    targetType: 'reconciliation_batch',
    targetId: batchId,
    afterValue: {
      batchNo: batch.batchNo,
      totalDiscrepancies: discrepancies.length,
      reviewRequired: results.filter(r => r.needReview).length,
      level1Review: results.filter(r => r.needReview && r.reviewLevel === 1).length,
      level2Review: results.filter(r => r.needReview && r.reviewLevel === 2).length
    },
    tenantId
  });

  return {
    batchId,
    batchNo: batch.batchNo,
    totalDiscrepancies: discrepancies.length,
    reviewRequired: results.filter(r => r.needReview).length,
    details: results
  };
}

async function assignReviewer(recordId, reviewerId, reviewerRole = 'operator', assigner = 'system', assignerRole = 'admin') {
  const tenantId = getCurrentTenantId();
  const record = await ReviewRecord.findByPk(recordId);
  if (!record) throw new Error('复核记录不存在');
  if (record.status !== 'pending') {
    throw new Error(`当前复核记录状态为 ${record.status}，仅待处理状态可指派复核人`);
  }

  const disc = await Discrepancy.findByPk(record.discrepancyId);
  if (!disc) throw new Error('差异记录不存在');
  if (disc.reviewStatus === 'rejected' || disc.status === 'review_rejected') {
    throw new Error('该差异已被驳回，不能再指派复核人');
  }
  if (disc.reviewStatus === 'approved') {
    throw new Error('该差异复核已通过，不能再指派复核人');
  }

  const batch = await ReconciliationBatch.findByPk(record.batchId);
  if (batch && batch.createdBy && batch.createdBy === reviewerId) {
    throw new Error('不能指派对账批次创建人作为该批次差异的复核人（防止自审自批）');
  }

  const ticket = await ArbitrationTicket.findByPk(record.arbitrationTicketId);
  if (ticket && ticket.createdBy && ticket.createdBy === reviewerId) {
    throw new Error('不能指派对账批次创建人作为该批次差异的复核人（防止自审自批）');
  }

  const config = await getActiveReviewConfig(tenantId);
  const newDeadline = new Date(Date.now() + config.reviewTimeoutHours * 60 * 60 * 1000);

  const beforeValue = record.toJSON();

  await record.update({
    reviewerId,
    reviewerRole,
    assignedAt: new Date(),
    deadlineAt: newDeadline,
    triggerType: 'manual'
  });

  if (disc) {
    await disc.update({ reviewDeadlineAt: newDeadline });
  }
  if (ticket) {
    await ticket.update({ reviewDeadlineAt: newDeadline });
  }

  const afterValue = record.toJSON();

  await recordAuditLog({
    operator: assigner,
    role: assignerRole,
    action: 'ASSIGN_REVIEWER',
    targetType: 'review_record',
    targetId: recordId,
    beforeValue,
    afterValue,
    tenantId
  });

  broadcastMessage({
    type: 'review_assigned',
    data: {
      recordId: record.id,
      reviewerId,
      reviewerRole,
      discrepancyId: record.discrepancyId,
      ticketId: record.arbitrationTicketId,
      batchId: record.batchId,
      reviewLevel: record.reviewLevel
    }
  });

  return record;
}

async function approveReview(recordId, comment = '', approver, approverRole = 'operator') {
  const tenantId = getCurrentTenantId();

  const result = await sequelize.transaction(async (t) => {
    const record = await ReviewRecord.findByPk(recordId, { transaction: t });
    if (!record) throw new Error('复核记录不存在');
    if (record.status !== 'pending') {
      throw new Error(`当前复核记录状态为 ${record.status}，仅待处理状态可审批`);
    }

    const ticket = await ArbitrationTicket.findByPk(record.arbitrationTicketId, { transaction: t });
    if (!ticket) throw new Error('仲裁工单不存在');

    const disc = await Discrepancy.findByPk(record.discrepancyId, { transaction: t });
    if (!disc) throw new Error('差异记录不存在');

    const batch = await ReconciliationBatch.findByPk(record.batchId, { transaction: t });
    if (batch && batch.createdBy && batch.createdBy === approver) {
      throw new Error('不能复核自己创建的对账批次产生的差异（防止自审自批）');
    }
    if (ticket.createdBy && ticket.createdBy === approver) {
      throw new Error('不能复核自己创建的对账批次产生的差异（防止自审自批）');
    }

    if (record.reviewerId && record.reviewerId !== approver) {
      throw new Error('您不是该复核记录的指定复核人');
    }

    const reviewLevelRequired = ticket.reviewLevelRequired || disc.reviewLevelRequired || 1;
    const currentLevel = record.reviewLevel;

    const recordBefore = record.toJSON();
    await record.update({
      status: 'approved',
      reviewComment: comment,
      reviewedAt: new Date()
    }, { transaction: t });

    if (currentLevel < reviewLevelRequired) {
      const config = await getActiveReviewConfig(tenantId);
      const deadlineAt = new Date(Date.now() + config.reviewTimeoutHours * 60 * 60 * 1000);

      const nextRecord = await ReviewRecord.create({
        id: uuidv4(),
        discrepancyId: disc.id,
        arbitrationTicketId: ticket.id,
        batchId: record.batchId,
        reviewLevel: currentLevel + 1,
        status: 'pending',
        deadlineAt,
        triggerType: 'auto',
        tenantId
      }, { transaction: t });

      await ticket.update({
        reviewStatus: 'reviewing',
        currentReviewLevel: currentLevel + 1,
        reviewDeadlineAt: deadlineAt
      }, { transaction: t });

      await disc.update({
        reviewStatus: 'reviewing',
        currentReviewLevel: currentLevel + 1,
        reviewDeadlineAt: deadlineAt
      }, { transaction: t });

      return {
        record,
        nextRecord,
        flowStatus: 'escalated_to_next_level'
      };
    } else {
      await ticket.update({
        reviewStatus: 'approved',
        currentReviewLevel: currentLevel,
        status: 'pending',
        finalApprovedBy: approver,
        finalApprovedAt: new Date()
      }, { transaction: t });

      await disc.update({
        reviewStatus: 'approved',
        currentReviewLevel: currentLevel,
        status: 'open',
        finalApprovedBy: approver,
        finalApprovedAt: new Date()
      }, { transaction: t });

      return {
        record,
        nextRecord: null,
        flowStatus: 'fully_approved'
      };
    }
  });

  await recordAuditLog({
    operator: approver,
    role: approverRole,
    action: result.flowStatus === 'fully_approved' ? 'FINAL_APPROVE' : 'LEVEL_APPROVE',
    targetType: 'review_record',
    targetId: recordId,
    beforeValue: result.record.toJSON(),
    afterValue: {
      ...result.record.toJSON(),
      flowStatus: result.flowStatus,
      nextRecordId: result.nextRecord?.id || null
    },
    tenantId
  });

  broadcastMessage({
    type: 'review_approved',
    data: {
      recordId,
      flowStatus: result.flowStatus,
      reviewLevel: result.record.reviewLevel,
      discrepancyId: result.record.discrepancyId,
      ticketId: result.record.arbitrationTicketId,
      batchId: result.record.batchId,
      nextRecordId: result.nextRecord?.id || null,
      approver,
      comment
    }
  });

  return result;
}

async function rejectReview(recordId, reason, rejector, rejectorRole = 'operator') {
  if (!reason || !reason.trim()) {
    throw new Error('驳回必须提供驳回原因');
  }

  const tenantId = getCurrentTenantId();

  const result = await sequelize.transaction(async (t) => {
    const record = await ReviewRecord.findByPk(recordId, { transaction: t });
    if (!record) throw new Error('复核记录不存在');
    if (record.status !== 'pending') {
      throw new Error(`当前复核记录状态为 ${record.status}，仅待处理状态可驳回`);
    }

    const ticket = await ArbitrationTicket.findByPk(record.arbitrationTicketId, { transaction: t });
    if (!ticket) throw new Error('仲裁工单不存在');

    const disc = await Discrepancy.findByPk(record.discrepancyId, { transaction: t });
    if (!disc) throw new Error('差异记录不存在');

    const batch = await ReconciliationBatch.findByPk(record.batchId, { transaction: t });
    if (batch && batch.createdBy && batch.createdBy === rejector) {
      throw new Error('不能复核自己创建的对账批次产生的差异（防止自审自批）');
    }
    if (ticket.createdBy && ticket.createdBy === rejector) {
      throw new Error('不能复核自己创建的对账批次产生的差异（防止自审自批）');
    }

    if (record.reviewerId && record.reviewerId !== rejector) {
      throw new Error('您不是该复核记录的指定复核人');
    }

    const recordBefore = record.toJSON();
    await record.update({
      status: 'rejected',
      reviewComment: reason,
      reviewedAt: new Date()
    }, { transaction: t });

    await ticket.update({
      reviewStatus: 'rejected',
      status: 'review_rejected',
      rejectionReason: reason,
      rejectedBy: rejector,
      rejectedAt: new Date()
    }, { transaction: t });

    await disc.update({
      reviewStatus: 'rejected',
      status: 'review_rejected',
      rejectionReason: reason,
      rejectedBy: rejector,
      rejectedAt: new Date()
    }, { transaction: t });

    return { record, ticket, disc };
  });

  await recordAuditLog({
    operator: rejector,
    role: rejectorRole,
    action: 'REJECT_REVIEW',
    targetType: 'review_record',
    targetId: recordId,
    beforeValue: result.record.toJSON(),
    afterValue: {
      ...result.record.toJSON(),
      rejectionReason: reason
    },
    tenantId
  });

  broadcastMessage({
    type: 'review_rejected',
    data: {
      recordId,
      reviewLevel: result.record.reviewLevel,
      discrepancyId: result.record.discrepancyId,
      ticketId: result.record.arbitrationTicketId,
      batchId: result.record.batchId,
      rejector,
      reason
    }
  });

  return result;
}

async function getReviewRecords(filters = {}) {
  const tenantId = getCurrentTenantId();
  const where = { tenantId };

  if (filters.batchId) where.batchId = filters.batchId;
  if (filters.discrepancyId) where.discrepancyId = filters.discrepancyId;
  if (filters.arbitrationTicketId) where.arbitrationTicketId = filters.arbitrationTicketId;
  if (filters.status) where.status = filters.status;
  if (filters.reviewLevel) where.reviewLevel = parseInt(filters.reviewLevel);
  if (filters.reviewerId) where.reviewerId = filters.reviewerId;

  const { count, rows } = await ReviewRecord.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(filters.limit) || 50, 200),
    offset: parseInt(filters.offset) || 0
  });

  return { total: count, data: rows };
}

async function getReviewProgress(discrepancyId) {
  const tenantId = getCurrentTenantId();
  const disc = await Discrepancy.findByPk(discrepancyId);
  if (!disc) throw new Error('差异记录不存在');

  const records = await ReviewRecord.findAll({
    where: { discrepancyId, tenantId },
    order: [['reviewLevel', 'ASC'], ['createdAt', 'ASC']]
  });

  const ticket = await ArbitrationTicket.findOne({
    where: { discrepancyId, tenantId }
  });

  return {
    discrepancyId,
    reviewStatus: disc.reviewStatus,
    reviewRequired: disc.reviewRequired,
    reviewLevelRequired: disc.reviewLevelRequired,
    currentReviewLevel: disc.currentReviewLevel,
    reviewDeadlineAt: disc.reviewDeadlineAt,
    ticketStatus: ticket?.status,
    records: records.map(r => ({
      id: r.id,
      reviewLevel: r.reviewLevel,
      status: r.status,
      reviewerId: r.reviewerId,
      reviewerRole: r.reviewerRole,
      reviewComment: r.reviewComment,
      reviewedAt: r.reviewedAt,
      assignedAt: r.assignedAt,
      deadlineAt: r.deadlineAt,
      escalated: r.escalated,
      escalatedAt: r.escalatedAt,
      triggerType: r.triggerType
    }))
  };
}

async function canDispose(ticketId) {
  const ticket = await ArbitrationTicket.findByPk(ticketId);
  if (!ticket) return { canDispose: false, reason: '仲裁工单不存在' };

  if (ticket.reviewStatus === 'rejected') {
    return { canDispose: false, reason: '该差异已被驳回，不能处置' };
  }

  if (ticket.reviewRequired && ticket.reviewStatus !== 'approved') {
    return { canDispose: false, reason: '该差异需要复核，复核通过后才能处置' };
  }

  return { canDispose: true, reason: '' };
}

async function canArchiveBatch(batchId) {
  const pendingReviewCount = await ReviewRecord.count({
    where: {
      batchId,
      status: { [Op.in]: ['pending', 'escalated'] }
    }
  });

  if (pendingReviewCount > 0) {
    return {
      canArchive: false,
      reason: `该批次有 ${pendingReviewCount} 条待复核的差异，复核完成后才能归档`
    };
  }

  return { canArchive: true, reason: '' };
}

async function checkAndHandleTimeouts() {
  const now = new Date();

  const pendingRecords = await ReviewRecord.findAll({
    where: {
      status: 'pending',
      deadlineAt: { [Op.lte]: now },
      escalated: false
    }
  });

  if (pendingRecords.length === 0) return { handled: 0 };

  let handled = 0;

  for (const record of pendingRecords) {
    try {
      await escalateReview(record.id, 'timeout', 'system', record.tenantId);
      handled++;
    } catch (err) {
      console.error(`处理复核超时失败，记录ID: ${record.id}`, err.message);
    }
  }

  return { handled, total: pendingRecords.length };
}

async function escalateReview(recordId, reason = 'timeout', operator = 'system', explicitTenantId = null) {
  const tenantId = explicitTenantId || getCurrentTenantId();

  const result = await sequelize.transaction(async (t) => {
    const record = await ReviewRecord.findByPk(recordId, { transaction: t });
    if (!record) throw new Error('复核记录不存在');
    if (record.escalated) throw new Error('该复核记录已升级过');

    const ticket = await ArbitrationTicket.findByPk(record.arbitrationTicketId, { transaction: t });
    if (!ticket) throw new Error('仲裁工单不存在');

    const disc = await Discrepancy.findByPk(record.discrepancyId, { transaction: t });
    if (!disc) throw new Error('差异记录不存在');

    const config = await getActiveReviewConfig(record.tenantId);
    if (!config.autoEscalateEnabled) {
      return { skipped: true, reason: '自动升级未启用' };
    }

    const recordBefore = record.toJSON();
    await record.update({
      status: 'escalated',
      escalated: true,
      escalatedAt: new Date(),
      escalationReason: reason,
      previousReviewerId: record.reviewerId
    }, { transaction: t });

    const deadlineAt = new Date(Date.now() + config.reviewTimeoutHours * 60 * 60 * 1000);

    const escalatedRecord = await ReviewRecord.create({
      id: uuidv4(),
      discrepancyId: disc.id,
      arbitrationTicketId: ticket.id,
      batchId: record.batchId,
      reviewLevel: record.reviewLevel,
      status: 'pending',
      reviewerId: null,
      reviewerRole: 'admin',
      deadlineAt,
      triggerType: 'escalation',
      tenantId: record.tenantId
    }, { transaction: t });

    await ticket.update({
      reviewDeadlineAt: deadlineAt
    }, { transaction: t });

    await disc.update({
      reviewDeadlineAt: deadlineAt
    }, { transaction: t });

    await AlertEvent.create({
      type: 'review_timeout',
      severity: 'warning',
      title: '复核超时升级告警',
      message: `差异复核已超时，已自动升级给管理员处理。差异ID: ${disc.id}，级别: ${record.reviewLevel}级`,
      batchId: record.batchId,
      discrepancyId: disc.id,
      metric: {
        reviewLevel: record.reviewLevel,
        originalReviewer: record.reviewerId,
        timeoutReason: reason,
        deadlineAt: record.deadlineAt
      }
    }, { transaction: t });

    return {
      originalRecord: record,
      escalatedRecord,
      ticket,
      disc
    };
  });

  if (result.skipped) return result;

  await recordAuditLog({
    operator,
    role: 'system',
    action: 'ESCALATE_REVIEW',
    targetType: 'review_record',
    targetId: recordId,
    beforeValue: result.originalRecord.toJSON(),
    afterValue: result.escalatedRecord.toJSON(),
    tenantId: result.originalRecord.tenantId
  });

  broadcastMessage({
    type: 'review_timeout_escalated',
    data: {
      originalRecordId: recordId,
      escalatedRecordId: result.escalatedRecord.id,
      reviewLevel: result.originalRecord.reviewLevel,
      discrepancyId: result.originalRecord.discrepancyId,
      ticketId: result.originalRecord.arbitrationTicketId,
      batchId: result.originalRecord.batchId,
      reason,
      deadlineAt: result.escalatedRecord.deadlineAt
    }
  });

  return result;
}

function startTimeoutCheck() {
  if (timeoutCheckInterval) {
    clearInterval(timeoutCheckInterval);
  }

  timeoutCheckInterval = setInterval(async () => {
    try {
      const result = await checkAndHandleTimeouts();
      if (result.handled > 0) {
        console.log(`[Review] 处理了 ${result.handled} 条超时复核记录`);
      }
    } catch (err) {
      console.error('[Review] 超时检查失败:', err.message);
    }
  }, TIMEOUT_CHECK_INTERVAL_MS);

  console.log('[Review] 复核超时检查任务已启动');
}

function stopTimeoutCheck() {
  if (timeoutCheckInterval) {
    clearInterval(timeoutCheckInterval);
    timeoutCheckInterval = null;
    console.log('[Review] 复核超时检查任务已停止');
  }
}

async function getReviewStats(filters = {}) {
  const tenantId = getCurrentTenantId();
  const where = { tenantId };

  if (filters.batchId) where.batchId = filters.batchId;

  const [pendingCount, approvedCount, rejectedCount, escalatedCount] = await Promise.all([
    ReviewRecord.count({ where: { ...where, status: 'pending' } }),
    ReviewRecord.count({ where: { ...where, status: 'approved' } }),
    ReviewRecord.count({ where: { ...where, status: 'rejected' } }),
    ReviewRecord.count({ where: { ...where, status: 'escalated' } })
  ]);

  return {
    pending: pendingCount,
    approved: approvedCount,
    rejected: rejectedCount,
    escalated: escalatedCount,
    total: pendingCount + approvedCount + rejectedCount + escalatedCount
  };
}

module.exports = {
  setWsBroadcast,
  ensureDefaultConfig,
  getActiveReviewConfig,
  createReviewConfig,
  updateReviewConfig,
  listReviewConfigs,
  determineReviewRequirement,
  assignReviewer,
  approveReview,
  rejectReview,
  getReviewRecords,
  getReviewProgress,
  canDispose,
  canArchiveBatch,
  checkAndHandleTimeouts,
  escalateReview,
  startTimeoutCheck,
  stopTimeoutCheck,
  getReviewStats
};
