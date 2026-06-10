const { Op } = require('sequelize');
const AuditLog = require('../models/AuditLog');

async function record(entry) {
  try {
    await AuditLog.create({
      operator: entry.operator,
      role: entry.role,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      beforeValue: entry.beforeValue,
      afterValue: entry.afterValue,
      ip: entry.ip
    });
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

async function queryLogs(filters) {
  const { operator, action, targetType, startDate, endDate, targetId, limit, offset } = filters;

  const where = {};

  if (operator) {
    where.operator = operator;
  }

  if (action) {
    where.action = action;
  }

  if (targetType) {
    where.targetType = targetType;
  }

  if (targetId) {
    where.targetId = targetId;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt[Op.gte] = new Date(startDate);
    }
    if (endDate) {
      where.createdAt[Op.lte] = new Date(endDate);
    }
  }

  const pageLimit = Math.min(parseInt(limit) || 50, 200);
  const pageOffset = parseInt(offset) || 0;

  const { count, rows } = await AuditLog.findAndCountAll({
    where,
    limit: pageLimit,
    offset: pageOffset,
    order: [['createdAt', 'DESC']]
  });

  return {
    total: count,
    data: rows
  };
}

module.exports = { record, queryLogs };
