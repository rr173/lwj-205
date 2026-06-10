const { v4: uuidv4 } = require('uuid');
const {
  sequelize,
  DataSource,
  Transaction,
  ReconciliationBatch,
  ArbitrationRule,
  AlertEvent,
  SchedulePlan,
  HealthProbe,
  Discrepancy,
  ArbitrationTicket,
  AdjustmentInstruction,
  TransactionArchive,
  DiscrepancyArchive,
  ArbitrationTicketArchive,
  AdjustmentInstructionArchive,
  AuditLog
} = require('../src/models');
const { Op } = require('sequelize');

async function checkAndInit() {
  const existingSources = await DataSource.count();
  if (existingSources > 0) {
    return false;
  }

  await initDemoData();
  return true;
}

async function initDemoData() {
  const orderSystem = await DataSource.create({
    id: uuidv4(),
    name: '订单系统',
    description: '业务订单系统，记录订单交易信息',
    isActive: true
  });

  const paymentGateway = await DataSource.create({
    id: uuidv4(),
    name: '支付网关',
    description: '第三方支付网关，记录实际支付信息',
    isActive: true
  });

  const financeLedger = await DataSource.create({
    id: uuidv4(),
    name: '财务总账',
    description: '公司财务总账系统，记录入账信息',
    isActive: true
  });

  await ArbitrationRule.bulkCreate([
    {
      id: uuidv4(),
      name: '小额差异自动忽略',
      description: '金额差异在0.01元以内自动忽略',
      ruleType: 'amount_tolerance',
      condition: { maxDifference: 0.01 },
      action: { type: 'ignore' },
      priority: 1,
      isActive: true
    },
    {
      id: uuidv4(),
      name: '支付网关优先原则',
      description: '支付网关金额与其他源不一致时以网关为准',
      ruleType: 'prefer_source',
      condition: { preferDataSource: '支付网关' },
      action: { type: 'use_source', source: '支付网关' },
      priority: 2,
      isActive: true
    }
  ]);

  const batch = await ReconciliationBatch.create({
    id: uuidv4(),
    batchNo: 'BATCH-DEMO-001',
    status: 'pending',
    config: {
      timeToleranceSeconds: 300,
      amountTolerance: 0.01,
      dataSourceIds: [orderSystem.id, paymentGateway.id, financeLedger.id]
    }
  });

  const baseTime = new Date('2024-01-15T10:00:00');
  const normalTransactions = [];
  const counterparties = ['阿里巴巴', '腾讯科技', '百度公司', '京东商城', '字节跳动', '美团点评', '拼多多', '小米科技'];
  const summaries = ['商品采购', '服务费用', '技术服务费', '广告投放费', '会员充值', '订单支付'];

  for (let i = 1; i <= 40; i++) {
    const txId = `TXN${String(i).padStart(6, '0')}`;
    const amount = (Math.random() * 10000 + 100).toFixed(2);
    const timeOffset = i * 60 * 1000;
    const timestamp = new Date(baseTime.getTime() + timeOffset);
    const counterparty = counterparties[i % counterparties.length];
    const summary = summaries[i % summaries.length];

    for (const source of [orderSystem, paymentGateway, financeLedger]) {
      normalTransactions.push({
        id: uuidv4(),
        dataSourceId: source.id,
        batchId: batch.id,
        transactionId: txId,
        amount: parseFloat(amount),
        currency: 'CNY',
        timestamp: timestamp,
        counterparty,
        summary,
        rawData: { txId, source: source.name }
      });
    }
  }

  const unilateralTransactions = [];
  for (let i = 41; i <= 45; i++) {
    const txId = `TXN${String(i).padStart(6, '0')}`;
    const amount = (Math.random() * 5000 + 500).toFixed(2);
    const timeOffset = i * 60 * 1000;
    const timestamp = new Date(baseTime.getTime() + timeOffset);
    const counterparty = counterparties[i % counterparties.length];
    const summary = summaries[i % summaries.length];

    const sources = [orderSystem, paymentGateway, financeLedger];
    const missingIndex = (i - 41) % 3;

    for (let j = 0; j < sources.length; j++) {
      if (j === missingIndex) continue;
      unilateralTransactions.push({
        id: uuidv4(),
        dataSourceId: sources[j].id,
        batchId: batch.id,
        transactionId: txId,
        amount: parseFloat(amount),
        currency: 'CNY',
        timestamp: timestamp,
        counterparty,
        summary,
        rawData: { txId, source: sources[j].name, unilateral: true }
      });
    }
  }

  const amountMismatchTransactions = [];
  for (let i = 46; i <= 48; i++) {
    const txId = `TXN${String(i).padStart(6, '0')}`;
    const baseAmount = parseFloat((Math.random() * 3000 + 200).toFixed(2));
    const timeOffset = i * 60 * 1000;
    const timestamp = new Date(baseTime.getTime() + timeOffset);
    const counterparty = counterparties[i % counterparties.length];
    const summary = summaries[i % summaries.length];

    amountMismatchTransactions.push({
      id: uuidv4(),
      dataSourceId: orderSystem.id,
      batchId: batch.id,
      transactionId: txId,
      amount: baseAmount,
      currency: 'CNY',
      timestamp: timestamp,
      counterparty,
      summary,
      rawData: { txId, source: '订单系统' }
    });

    amountMismatchTransactions.push({
      id: uuidv4(),
      dataSourceId: paymentGateway.id,
      batchId: batch.id,
      transactionId: txId,
      amount: parseFloat((baseAmount + (i - 45) * 0.5).toFixed(2)),
      currency: 'CNY',
      timestamp: timestamp,
      counterparty,
      summary,
      rawData: { txId, source: '支付网关' }
    });

    amountMismatchTransactions.push({
      id: uuidv4(),
      dataSourceId: financeLedger.id,
      batchId: batch.id,
      transactionId: txId,
      amount: parseFloat((baseAmount + (i - 45) * 1.2).toFixed(2)),
      currency: 'CNY',
      timestamp: timestamp,
      counterparty,
      summary,
      rawData: { txId, source: '财务总账' }
    });
  }

  {
    const i = 51;
    const txId = `TXN${String(i).padStart(6, '0')}`;
    const baseAmount = parseFloat((Math.random() * 3000 + 200).toFixed(2));
    const timeOffset = i * 60 * 1000;
    const timestamp = new Date(baseTime.getTime() + timeOffset);
    const counterparty = counterparties[i % counterparties.length];
    const summary = summaries[i % summaries.length];

    amountMismatchTransactions.push({
      id: uuidv4(),
      dataSourceId: orderSystem.id,
      batchId: batch.id,
      transactionId: txId,
      amount: baseAmount,
      currency: 'CNY',
      timestamp: timestamp,
      counterparty,
      summary,
      rawData: { txId, source: '订单系统' }
    });

    amountMismatchTransactions.push({
      id: uuidv4(),
      dataSourceId: paymentGateway.id,
      batchId: batch.id,
      transactionId: txId,
      amount: parseFloat((baseAmount + 0.005).toFixed(3)),
      currency: 'CNY',
      timestamp: timestamp,
      counterparty,
      summary,
      rawData: { txId, source: '支付网关' }
    });

    amountMismatchTransactions.push({
      id: uuidv4(),
      dataSourceId: financeLedger.id,
      batchId: batch.id,
      transactionId: txId,
      amount: baseAmount,
      currency: 'CNY',
      timestamp: timestamp,
      counterparty,
      summary,
      rawData: { txId, source: '财务总账' }
    });
  }

  const timeOffsetTransactions = [];
  for (let i = 49; i <= 50; i++) {
    const txId = `TXN${String(i).padStart(6, '0')}`;
    const amount = (Math.random() * 2000 + 300).toFixed(2);
    const baseTimestamp = new Date(baseTime.getTime() + i * 60 * 1000);
    const counterparty = counterparties[i % counterparties.length];
    const summary = summaries[i % summaries.length];

    timeOffsetTransactions.push({
      id: uuidv4(),
      dataSourceId: orderSystem.id,
      batchId: batch.id,
      transactionId: txId,
      amount: parseFloat(amount),
      currency: 'CNY',
      timestamp: baseTimestamp,
      counterparty,
      summary,
      rawData: { txId, source: '订单系统' }
    });

    timeOffsetTransactions.push({
      id: uuidv4(),
      dataSourceId: paymentGateway.id,
      batchId: batch.id,
      transactionId: txId,
      amount: parseFloat(amount),
      currency: 'CNY',
      timestamp: new Date(baseTimestamp.getTime() + 400 * 1000),
      counterparty,
      summary,
      rawData: { txId, source: '支付网关' }
    });

    timeOffsetTransactions.push({
      id: uuidv4(),
      dataSourceId: financeLedger.id,
      batchId: batch.id,
      transactionId: txId,
      amount: parseFloat(amount),
      currency: 'CNY',
      timestamp: new Date(baseTimestamp.getTime() + 600 * 1000),
      counterparty,
      summary,
      rawData: { txId, source: '财务总账' }
    });
  }

  const allTransactions = [
    ...normalTransactions,
    ...unilateralTransactions,
    ...amountMismatchTransactions,
    ...timeOffsetTransactions
  ];

  await Transaction.bulkCreate(allTransactions);

  await AlertEvent.bulkCreate([
    {
      id: uuidv4(),
      type: 'volume_spike',
      severity: 'critical',
      title: '数据导入量突增预警',
      message: '数据源「支付网关」在5分钟内导入450条记录，超过正常均值(30.0条/5分钟)的15.0倍',
      dataSourceId: paymentGateway.id,
      dataSourceName: '支付网关',
      metric: { recentCount: 450, avgPerWindow: 30.0, multiplier: 15.0, windowMinutes: 5, baselineWindows: 6 },
      isRead: false,
      createdAt: new Date(Date.now() - 30 * 60 * 1000)
    },
    {
      id: uuidv4(),
      type: 'discrepancy_ratio',
      severity: 'warning',
      title: '差异占比超限告警',
      message: '批次「BATCH-DEMO-001」单边挂账差异占比9.8%，超过阈值15%的预警线（5笔/51笔）',
      batchId: batch.id,
      batchNo: 'BATCH-DEMO-001',
      metric: { discrepancyType: 'unilateral', discrepancyCount: 5, totalRecords: 51, ratio: 0.098, threshold: 0.15, thresholdPercent: 15 },
      isRead: false,
      createdAt: new Date(Date.now() - 15 * 60 * 1000)
    },
    {
      id: uuidv4(),
      type: 'discrepancy_ratio',
      severity: 'critical',
      title: '差异占比超限告警',
      message: '批次「BATCH-DEMO-001」金额不符差异占比5.9%，超过阈值10%（3笔/51笔）',
      batchId: batch.id,
      batchNo: 'BATCH-DEMO-001',
      metric: { discrepancyType: 'amount_mismatch', discrepancyCount: 3, totalRecords: 51, ratio: 0.059, threshold: 0.10, thresholdPercent: 10 },
      isRead: true,
      createdAt: new Date(Date.now() - 5 * 60 * 1000)
    }
  ]);

  console.log(`演示数据创建完成:`);
  console.log(`- 数据源: 3个 (订单系统、支付网关、财务总账)`);
  console.log(`- 仲裁规则: 2条`);
  console.log(`- 对账批次: 1个 (BATCH-DEMO-001)`);
  console.log(`- 交易记录: ${allTransactions.length}条`);
  console.log(`  - 正常匹配: 40笔 × 3源 = 120条`);
  console.log(`  - 单边挂账: 5笔 (各缺一个源) = 10条`);
  console.log(`  - 金额不符: 4笔 × 3源 = 12条 (其中1笔差异0.005元，应被自动忽略)`);
  console.log(`  - 时间偏移: 2笔 × 3源 = 6条`);
  console.log(`- 预计差异: 11条 (5单边 + 4金额 + 2时间)`);
  console.log(`- 告警事件: 3条 (1条导入突增 + 2条差异占比超限)`);
}

async function ensurePresetSchedulePlans() {
  const existingPresets = await SchedulePlan.count({ where: { isPreset: true } });
  if (existingPresets > 0) {
    return false;
  }

  const allSources = await DataSource.findAll({ where: { isActive: true } });
  const allSourceIds = allSources.map(ds => ds.id);

  const paymentGateway = allSources.find(ds => ds.name === '支付网关');
  const paymentGatewayId = paymentGateway ? paymentGateway.id : (allSourceIds[1] || allSourceIds[0]);

  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);

  const next3AM = new Date(now);
  next3AM.setHours(3, 0, 0, 0);
  if (next3AM <= now) {
    next3AM.setDate(next3AM.getDate() + 1);
  }

  await SchedulePlan.bulkCreate([
    {
      id: uuidv4(),
      name: '三源全量对账',
      description: '每小时对订单系统、支付网关、财务总账进行全量对账，SLA目标60分钟',
      dataSourceIds: allSourceIds,
      scheduleType: 'interval',
      intervalMinutes: 60,
      timeWindowStart: null,
      timeWindowEnd: null,
      slaMinutes: 60,
      slaComplianceThreshold: 0.8,
      isActive: true,
      isPaused: false,
      isDeleted: false,
      nextRunAt: nextHour,
      lastRunAt: null,
      lastExecutionStatus: null,
      reconciliationConfig: {
        timeToleranceSeconds: 300,
        amountTolerance: 0.01
      },
      isPreset: true
    },
    {
      id: uuidv4(),
      name: '支付网关单独对账',
      description: '每天凌晨3点对支付网关进行单独对账，SLA目标30分钟',
      dataSourceIds: [paymentGatewayId],
      scheduleType: 'cron',
      cronExpression: '0 3 * * *',
      timeWindowStart: '02:00',
      timeWindowEnd: '05:00',
      slaMinutes: 30,
      slaComplianceThreshold: 0.8,
      isActive: true,
      isPaused: false,
      isDeleted: false,
      nextRunAt: next3AM,
      lastRunAt: null,
      lastExecutionStatus: null,
      reconciliationConfig: {
        timeToleranceSeconds: 300,
        amountTolerance: 0.01
      },
      isPreset: true
    }
  ]);

  console.log('预设调度计划创建完成:');
  console.log('- 三源全量对账: 每小时, SLA=60分钟');
  console.log('- 支付网关单独对账: 每天3:00, 时间窗口02:00-05:00, SLA=30分钟');
  return true;
}

async function ensurePresetHealthProbes() {
  const existingPresets = await HealthProbe.count({ where: { isPreset: true } });
  if (existingPresets > 0) {
    return false;
  }

  const allSources = await DataSource.findAll({ where: { isActive: true } });

  const probes = [];
  for (const ds of allSources) {
    probes.push({
      id: uuidv4(),
      dataSourceId: ds.id,
      name: `${ds.name}健康探针`,
      probeType: 'check_recent_records',
      probeConfig: { windowMinutes: 5 },
      intervalSeconds: 30,
      timeoutMs: 5000,
      currentState: 'healthy',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      isActive: true,
      isPreset: true
    });
  }

  await HealthProbe.bulkCreate(probes);

  console.log(`预设健康探针创建完成: ${probes.length}个`);
  for (const p of probes) {
    const ds = allSources.find(s => s.id === p.dataSourceId);
    console.log(`- ${p.name}: 类型=${p.probeType}, 间隔=${p.intervalSeconds}s, 窗口=${p.probeConfig.windowMinutes}min`);
  }
  return true;
}

async function ensurePresetArchivedBatches() {
  const existingArchived = await ReconciliationBatch.count({ where: { isArchived: true } });
  if (existingArchived >= 3) {
    return false;
  }

  const allSources = await DataSource.findAll({ where: { isActive: true } });
  if (allSources.length === 0) {
    console.log('归档数据初始化跳过: 没有可用的数据源');
    return false;
  }
  const allSourceIds = allSources.map(ds => ds.id);

  const now = new Date();
  const archiveConfigs = [
    { daysAgo: 7, batchNo: 'BATCH-ARCH-7D', suffix: '7天前归档' },
    { daysAgo: 15, batchNo: 'BATCH-ARCH-15D', suffix: '15天前归档' },
    { daysAgo: 30, batchNo: 'BATCH-ARCH-30D', suffix: '30天前归档' }
  ];

  const existingCount = existingArchived;
  const configsToCreate = archiveConfigs.slice(existingCount);

  for (const cfg of configsToCreate) {
    try {
      const archivedAt = new Date(now.getTime() - cfg.daysAgo * 24 * 60 * 60 * 1000);
      const batchCreatedAt = new Date(archivedAt.getTime() - (cfg.daysAgo + 5) * 24 * 60 * 60 * 1000);

      const transaction = await sequelize.transaction();

      try {
        const batch = await ReconciliationBatch.create({
          id: uuidv4(),
          batchNo: cfg.batchNo,
          status: 'completed',
          totalRecords: 60,
          matchedCount: 50,
          discrepancyCount: 10,
          uniqueTransactionCount: 60,
          startTime: new Date(batchCreatedAt.getTime() + 60 * 1000),
          endTime: new Date(batchCreatedAt.getTime() + 5 * 60 * 1000),
          config: {
            timeToleranceSeconds: 300,
            amountTolerance: 0.01,
            dataSourceIds: allSourceIds
          },
          errorMessage: null,
          isArchived: true,
          archivedAt,
          archiveLock: false,
          createdAt: batchCreatedAt,
          updatedAt: batchCreatedAt
        }, { transaction });

        const counterparties = ['华为技术', '中兴通讯', '小米科技', 'OPPO广东', 'vivo通信', '荣耀终端'];
        const summaries = ['硬件采购', '软件服务费', '专利授权费', '技术支持费', '设备租赁费'];

        const archiveTransactions = [];
        const archiveDiscrepancies = [];
        const archiveTickets = [];
        const archiveAdjustments = [];

        for (let i = 1; i <= 50; i++) {
          const txId = `ARCH-${cfg.daysAgo}D-TXN${String(i).padStart(5, '0')}`;
          const amount = (Math.random() * 8000 + 200).toFixed(2);
          const timeOffset = i * 30 * 1000;
          const txTimestamp = new Date(batchCreatedAt.getTime() + timeOffset);
          const counterparty = counterparties[i % counterparties.length];
          const summary = summaries[i % summaries.length];

          for (const source of allSources) {
            archiveTransactions.push({
              id: uuidv4(),
              dataSourceId: source.id,
              batchId: batch.id,
              transactionId: txId,
              amount: parseFloat(amount),
              currency: 'CNY',
              timestamp: txTimestamp,
              counterparty,
              summary,
              rawData: { txId, source: source.name, archived: true },
              archivedAt,
              createdAt: txTimestamp,
              updatedAt: txTimestamp
            });
          }
        }

        for (let i = 51; i <= 55; i++) {
          const txId = `ARCH-${cfg.daysAgo}D-TXN${String(i).padStart(5, '0')}`;
          const baseAmount = parseFloat((Math.random() * 5000 + 500).toFixed(2));
          const timeOffset = i * 30 * 1000;
          const txTimestamp = new Date(batchCreatedAt.getTime() + timeOffset);
          const counterparty = counterparties[i % counterparties.length];
          const summary = summaries[i % summaries.length];

          const discId = uuidv4();
          archiveDiscrepancies.push({
            id: discId,
            batchId: batch.id,
            type: 'amount_mismatch',
            transactionId: txId,
            description: `交易 ${txId} 金额不一致，自动归档演示数据`,
            sourceTransactions: allSourceIds.slice(0, 2).map((sid, idx) => ({
              dataSourceId: sid,
              amount: parseFloat((baseAmount + idx * (i - 50)).toFixed(2)),
              timestamp: txTimestamp
            })),
            missingInSources: null,
            amountDiff: parseFloat((i - 50).toFixed(2)),
            timeDiffSeconds: null,
            status: 'resolved',
            rootCause: '系统录入误差',
            severity: 'normal',
            archivedAt,
            createdAt: txTimestamp,
            updatedAt: archivedAt
          });

          const ticketId = uuidv4();
          archiveTickets.push({
            id: ticketId,
            discrepancyId: discId,
            batchId: batch.id,
            status: 'auto_resolved',
            resolutionType: 'ignore',
            primarySourceId: null,
            resolvedBy: 'system',
            resolvedAt: new Date(txTimestamp.getTime() + 10 * 60 * 1000),
            notes: `${cfg.suffix}演示数据：自动忽略小额差异`,
            ruleApplied: '小额差异自动忽略',
            archivedAt,
            createdAt: txTimestamp,
            updatedAt: archivedAt
          });
        }

        for (let i = 56; i <= 60; i++) {
          const txId = `ARCH-${cfg.daysAgo}D-TXN${String(i).padStart(5, '0')}`;
          const amount = (Math.random() * 3000 + 1000).toFixed(2);
          const timeOffset = i * 30 * 1000;
          const txTimestamp = new Date(batchCreatedAt.getTime() + timeOffset);
          const counterparty = counterparties[i % counterparties.length];
          const summary = summaries[i % summaries.length];

          const presentSources = allSources.slice(0, allSources.length - 1);
          for (const source of presentSources) {
            archiveTransactions.push({
              id: uuidv4(),
              dataSourceId: source.id,
              batchId: batch.id,
              transactionId: txId,
              amount: parseFloat(amount),
              currency: 'CNY',
              timestamp: txTimestamp,
              counterparty,
              summary,
              rawData: { txId, source: source.name, unilateral: true, archived: true },
              archivedAt,
              createdAt: txTimestamp,
              updatedAt: txTimestamp
            });
          }

          const missingSource = allSources[allSources.length - 1];
          const discId = uuidv4();
          archiveDiscrepancies.push({
            id: discId,
            batchId: batch.id,
            type: 'unilateral',
            transactionId: txId,
            description: `交易 ${txId} 在数据源 [${missingSource.id}] 中缺失，${cfg.suffix}演示数据`,
            sourceTransactions: presentSources.map(sid => ({
              dataSourceId: sid,
              amount: parseFloat(amount),
              timestamp: txTimestamp
            })),
            missingInSources: [missingSource.id],
            amountDiff: null,
            timeDiffSeconds: null,
            status: 'pending_review',
            rootCause: null,
            severity: 'normal',
            archivedAt,
            createdAt: txTimestamp,
            updatedAt: archivedAt
          });

          const ticketId = uuidv4();
          archiveTickets.push({
            id: ticketId,
            discrepancyId: discId,
            batchId: batch.id,
            status: 'pending_review',
            resolutionType: null,
            primarySourceId: null,
            resolvedBy: null,
            resolvedAt: null,
            notes: `${cfg.suffix}演示数据：待人工复核`,
            ruleApplied: null,
            archivedAt,
            createdAt: txTimestamp,
            updatedAt: archivedAt
          });
        }

        if (archiveTransactions.length > 0) {
          await TransactionArchive.bulkCreate(archiveTransactions, { transaction });
        }
        if (archiveDiscrepancies.length > 0) {
          await DiscrepancyArchive.bulkCreate(archiveDiscrepancies, { transaction });
        }
        if (archiveTickets.length > 0) {
          await ArbitrationTicketArchive.bulkCreate(archiveTickets, { transaction });
        }
        if (archiveAdjustments.length > 0) {
          await AdjustmentInstructionArchive.bulkCreate(archiveAdjustments, { transaction });
        }

        await AuditLog.create({
          id: uuidv4(),
          operator: 'system',
          role: 'system',
          action: 'ARCHIVE',
          targetType: 'reconciliation_batch',
          targetId: batch.id,
          beforeValue: { batchNo: batch.batchNo, isArchived: false },
          afterValue: { batchNo: batch.batchNo, isArchived: true, archivedAt },
          ip: '127.0.0.1',
          createdAt: archivedAt
        }, { transaction });

        await transaction.commit();

        console.log(`归档演示数据创建完成: 批次「${cfg.batchNo}」，归档时间${cfg.daysAgo}天前，交易记录${archiveTransactions.length}条，差异${archiveDiscrepancies.length}条，工单${archiveTickets.length}条`);
      } catch (batchErr) {
        await transaction.rollback();
        console.error(`创建归档批次「${cfg.batchNo}」失败:`, batchErr.message);
        throw batchErr;
      }
    } catch (err) {
      console.error('预置归档数据初始化出错:', err.message);
    }
  }

  return true;
}

if (require.main === module) {
  (async () => {
    try {
      await sequelize.sync();
      await initDemoData();
      console.log('演示数据初始化完成');
      process.exit(0);
    } catch (err) {
      console.error('初始化失败:', err);
      process.exit(1);
    }
  })();
}

module.exports = {
  checkAndInit,
  initDemoData,
  ensurePresetSchedulePlans,
  ensurePresetHealthProbes,
  ensurePresetArchivedBatches
};
