const { AlertRule, AlertRuleHistory, DataSource } = require('../models');
const { Op } = require('sequelize');

const DEFAULT_RULES = [
  {
    name: '导入突增倍数',
    ruleKey: 'volume_spike_multiplier',
    scope: 'global',
    parameters: { multiplier: 3 },
    description: '当5分钟内导入量超过历史均值的倍数时触发告警'
  },
  {
    name: '突增冷却时间(分钟)',
    ruleKey: 'volume_spike_cooldown',
    scope: 'global',
    parameters: { cooldownMinutes: 5 },
    description: '同一数据源两次突增告警之间的最小间隔时间'
  },
  {
    name: '单边挂账差异占比阈值',
    ruleKey: 'discrepancy_ratio_unilateral',
    scope: 'global',
    parameters: { threshold: 0.15 },
    description: '单边挂账差异占比超过此阈值时触发告警'
  },
  {
    name: '金额不符差异占比阈值',
    ruleKey: 'discrepancy_ratio_amount_mismatch',
    scope: 'global',
    parameters: { threshold: 0.10 },
    description: '金额不符差异占比超过此阈值时触发告警'
  },
  {
    name: '时间偏移差异占比阈值',
    ruleKey: 'discrepancy_ratio_time_offset',
    scope: 'global',
    parameters: { threshold: 0.10 },
    description: '时间偏移差异占比超过此阈值时触发告警'
  }
];

async function ensureDefaultRules() {
  for (const ruleDef of DEFAULT_RULES) {
    const existing = await AlertRule.findOne({
      where: { ruleKey: ruleDef.ruleKey, scope: 'global', dataSourceId: null }
    });
    if (!existing) {
      await AlertRule.create({
        name: ruleDef.name,
        ruleKey: ruleDef.ruleKey,
        scope: 'global',
        dataSourceId: null,
        enabled: true,
        parameters: ruleDef.parameters,
        description: ruleDef.description
      });
    }
  }
}

async function getRules(filters = {}) {
  const where = {};
  if (filters.scope) where.scope = filters.scope;
  if (filters.ruleKey) where.ruleKey = filters.ruleKey;
  if (filters.enabled !== undefined) where.enabled = filters.enabled === 'true';
  if (filters.dataSourceId) where.dataSourceId = filters.dataSourceId;

  const rules = await AlertRule.findAll({
    where,
    order: [['scope', 'ASC'], ['ruleKey', 'ASC'], ['createdAt', 'ASC']]
  });

  return rules;
}

async function getRuleById(ruleId) {
  return AlertRule.findByPk(ruleId);
}

async function createRule(ruleData, operator = 'system') {
  const rule = await AlertRule.create({
    name: ruleData.name,
    ruleKey: ruleData.ruleKey,
    scope: ruleData.scope || 'global',
    dataSourceId: ruleData.dataSourceId || null,
    enabled: ruleData.enabled !== undefined ? ruleData.enabled : true,
    parameters: ruleData.parameters,
    description: ruleData.description || null
  });

  await AlertRuleHistory.create({
    ruleId: rule.id,
    field: 'create',
    oldValue: null,
    newValue: JSON.stringify(ruleData.parameters),
    operator
  });

  return rule;
}

async function updateRule(ruleId, updates, operator = 'system') {
  const rule = await AlertRule.findByPk(ruleId);
  if (!rule) throw new Error('规则不存在');

  const historyEntries = [];

  if (updates.enabled !== undefined && updates.enabled !== rule.enabled) {
    historyEntries.push({
      ruleId: rule.id,
      field: 'enabled',
      oldValue: String(rule.enabled),
      newValue: String(updates.enabled),
      operator
    });
  }

  if (updates.name !== undefined && updates.name !== rule.name) {
    historyEntries.push({
      ruleId: rule.id,
      field: 'name',
      oldValue: rule.name,
      newValue: updates.name,
      operator
    });
  }

  if (updates.parameters !== undefined) {
    for (const [key, newVal] of Object.entries(updates.parameters)) {
      const oldVal = rule.parameters[key];
      if (oldVal !== newVal) {
        historyEntries.push({
          ruleId: rule.id,
          field: `parameters.${key}`,
          oldValue: oldVal !== undefined ? String(oldVal) : null,
          newValue: String(newVal),
          operator
        });
      }
    }
  }

  await rule.update({
    ...updates,
    ...(updates.name && { name: updates.name }),
    ...(updates.enabled !== undefined && { enabled: updates.enabled }),
    ...(updates.parameters && { parameters: { ...rule.parameters, ...updates.parameters } })
  });

  if (historyEntries.length > 0) {
    await AlertRuleHistory.bulkCreate(historyEntries);
  }

  return rule;
}

async function toggleRule(ruleId, operator = 'system') {
  const rule = await AlertRule.findByPk(ruleId);
  if (!rule) throw new Error('规则不存在');
  return updateRule(ruleId, { enabled: !rule.enabled }, operator);
}

async function deleteRule(ruleId, operator = 'system') {
  const rule = await AlertRule.findByPk(ruleId);
  if (!rule) throw new Error('规则不存在');

  await AlertRuleHistory.create({
    ruleId: rule.id,
    field: 'delete',
    oldValue: JSON.stringify(rule.parameters),
    newValue: null,
    operator
  });

  await rule.destroy();
  return { deleted: true };
}

async function resolveEffectiveRule(ruleKey, dataSourceId = null) {
  if (dataSourceId) {
    const dsRule = await AlertRule.findOne({
      where: { ruleKey, scope: 'datasource', dataSourceId, enabled: true }
    });
    if (dsRule) {
      return { rule: dsRule, scope: 'datasource', ruleId: dsRule.id };
    }
  }

  const globalRule = await AlertRule.findOne({
    where: { ruleKey, scope: 'global', dataSourceId: null, enabled: true }
  });

  if (globalRule) {
    return { rule: globalRule, scope: 'global', ruleId: globalRule.id };
  }

  return { rule: null, scope: null, ruleId: null };
}

async function resolveAllEffectiveRules(dataSourceId = null) {
  const ruleKeys = [
    'volume_spike_multiplier',
    'volume_spike_cooldown',
    'discrepancy_ratio_unilateral',
    'discrepancy_ratio_amount_mismatch',
    'discrepancy_ratio_time_offset'
  ];

  const result = {};
  for (const ruleKey of ruleKeys) {
    const resolved = await resolveEffectiveRule(ruleKey, dataSourceId);
    result[ruleKey] = resolved;
  }
  return result;
}

async function getRuleHistory(filters = {}) {
  const where = {};
  if (filters.ruleId) where.ruleId = filters.ruleId;
  if (filters.field) where.field = filters.field;

  const limit = Math.min(parseInt(filters.limit) || 100, 500);
  const offset = parseInt(filters.offset) || 0;

  const { count, rows } = await AlertRuleHistory.findAndCountAll({
    where,
    limit,
    offset,
    order: [['createdAt', 'DESC']]
  });

  return { total: count, data: rows };
}

async function getRulesWithDataSourceInfo(filters = {}) {
  const rules = await getRules(filters);
  const dsIds = [...new Set(rules.map(r => r.dataSourceId).filter(Boolean))];

  const dsMap = {};
  if (dsIds.length > 0) {
    const dataSources = await DataSource.findAll({
      where: { id: { [Op.in]: dsIds } }
    });
    for (const ds of dataSources) {
      dsMap[ds.id] = ds.name;
    }
  }

  return rules.map(r => ({
    ...r.toJSON(),
    dataSourceName: r.dataSourceId ? (dsMap[r.dataSourceId] || '未知数据源') : null
  }));
}

module.exports = {
  ensureDefaultRules,
  getRules,
  getRuleById,
  createRule,
  updateRule,
  toggleRule,
  deleteRule,
  resolveEffectiveRule,
  resolveAllEffectiveRules,
  getRuleHistory,
  getRulesWithDataSourceInfo
};
