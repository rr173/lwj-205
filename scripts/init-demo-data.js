const { v4: uuidv4 } = require('uuid');
const {
  sequelize,
  DataSource,
  Transaction,
  ReconciliationBatch,
  ArbitrationRule,
  AlertEvent
} = require('../src/models');

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
      message: '数据源「支付网关」在5分钟内导入450条记录，超过正常均值(30.0条/5分钟)的3倍，当前倍率15.0',
      dataSourceId: paymentGateway.id,
      dataSourceName: '支付网关',
      metric: { recentCount: 450, avgPerWindow: 30.0, multiplier: 15.0, windowMinutes: 5 },
      isRead: false,
      createdAt: new Date(Date.now() - 30 * 60 * 1000)
    },
    {
      id: uuidv4(),
      type: 'discrepancy_ratio',
      severity: 'warning',
      title: '差异占比超限告警',
      message: '批次「BATCH-DEMO-001」单边挂账差异占比18.3%，超过阈值15%（11条/60条）',
      batchId: batch.id,
      batchNo: 'BATCH-DEMO-001',
      metric: { discrepancyType: 'unilateral', discrepancyCount: 11, totalRecords: 60, ratio: 0.1833, threshold: 0.15, thresholdPercent: 15 },
      isRead: false,
      createdAt: new Date(Date.now() - 15 * 60 * 1000)
    },
    {
      id: uuidv4(),
      type: 'discrepancy_ratio',
      severity: 'critical',
      title: '差异占比超限告警',
      message: '批次「BATCH-DEMO-001」金额不符差异占比25.0%，超过阈值10%（15条/60条）',
      batchId: batch.id,
      batchNo: 'BATCH-DEMO-001',
      metric: { discrepancyType: 'amount_mismatch', discrepancyCount: 15, totalRecords: 60, ratio: 0.25, threshold: 0.10, thresholdPercent: 10 },
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
  initDemoData
};
