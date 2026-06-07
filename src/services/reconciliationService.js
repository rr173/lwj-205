const { v4: uuidv4 } = require('uuid');
const {
  Transaction,
  ReconciliationBatch,
  Discrepancy,
  ArbitrationTicket,
  DataSource
} = require('../models');

const MAX_RECORDS = 100000;
let taskQueue = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || taskQueue.length === 0) return;
  isProcessing = true;

  while (taskQueue.length > 0) {
    const { batchId, resolve, reject } = taskQueue.shift();
    try {
      await executeReconciliation(batchId);
      resolve();
    } catch (err) {
      reject(err);
    }
  }

  isProcessing = false;
}

async function createBatch(config = {}) {
  const batchNo = `BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  const batch = await ReconciliationBatch.create({
    batchNo,
    status: 'pending',
    config: {
      timeToleranceSeconds: config.timeToleranceSeconds || 300,
      amountTolerance: config.amountTolerance || 0.01,
      dataSourceIds: config.dataSourceIds || []
    }
  });
  return batch;
}

async function triggerReconciliation(batchId) {
  const batch = await ReconciliationBatch.findByPk(batchId);
  if (!batch) throw new Error('批次不存在');

  if (batch.status === 'running') {
    throw new Error('该批次正在对账中，不能重复触发');
  }

  const count = await Transaction.count({ where: { batchId } });
  if (count > MAX_RECORDS) {
    throw new Error(`记录数量 ${count} 超过上限 ${MAX_RECORDS}`);
  }

  if (count === 0) {
    throw new Error('该批次没有交易记录');
  }

  await batch.update({ status: 'queued', totalRecords: count });

  return new Promise((resolve, reject) => {
    taskQueue.push({ batchId, resolve, reject });
    processQueue();
  });
}

async function executeReconciliation(batchId) {
  const batch = await ReconciliationBatch.findByPk(batchId);
  if (!batch) return;

  try {
    await batch.update({ status: 'running', startTime: new Date() });

    const transactions = await Transaction.findAll({ where: { batchId } });
    const dataSources = await DataSource.findAll({ where: { isActive: true } });
    const sourceIds = batch.config.dataSourceIds?.length 
      ? batch.config.dataSourceIds 
      : dataSources.map(ds => ds.id);

    const timeTolerance = batch.config.timeToleranceSeconds || 300;
    const amountTolerance = batch.config.amountTolerance || 0.01;

    const byTransactionId = {};
    for (const tx of transactions) {
      if (!byTransactionId[tx.transactionId]) {
        byTransactionId[tx.transactionId] = [];
      }
      byTransactionId[tx.transactionId].push(tx);
    }

    const discrepancies = [];
    let matchedCount = 0;
    const processedIds = new Set();

    for (const [txId, txList] of Object.entries(byTransactionId)) {
      processedIds.add(txId);
      const sourceMap = {};
      for (const tx of txList) {
        sourceMap[tx.dataSourceId] = tx;
      }

      const presentSources = Object.keys(sourceMap);
      const missingSources = sourceIds.filter(id => !presentSources.includes(id));

      if (missingSources.length > 0) {
        discrepancies.push({
          id: uuidv4(),
          batchId,
          type: 'unilateral',
          transactionId: txId,
          description: `交易 ${txId} 在数据源 [${missingSources.join(', ')}] 中缺失`,
          sourceTransactions: txList.map(t => ({
            dataSourceId: t.dataSourceId,
            amount: parseFloat(t.amount),
            timestamp: t.timestamp
          })),
          missingInSources: missingSources,
          status: 'open'
        });
        continue;
      }

      const amounts = txList.map(t => parseFloat(t.amount));
      const maxAmount = Math.max(...amounts);
      const minAmount = Math.min(...amounts);
      const amountDiff = maxAmount - minAmount;

      if (amountDiff > amountTolerance) {
        discrepancies.push({
          id: uuidv4(),
          batchId,
          type: 'amount_mismatch',
          transactionId: txId,
          description: `交易 ${txId} 金额不一致，差异: ${amountDiff}`,
          sourceTransactions: txList.map(t => ({
            dataSourceId: t.dataSourceId,
            amount: parseFloat(t.amount),
            timestamp: t.timestamp
          })),
          amountDiff,
          status: 'open'
        });
        continue;
      }

      const times = txList.map(t => new Date(t.timestamp).getTime());
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);
      const timeDiffSeconds = (maxTime - minTime) / 1000;

      if (timeDiffSeconds > timeTolerance) {
        discrepancies.push({
          id: uuidv4(),
          batchId,
          type: 'time_offset',
          transactionId: txId,
          description: `交易 ${txId} 时间偏移超限，差异: ${timeDiffSeconds.toFixed(2)}秒`,
          sourceTransactions: txList.map(t => ({
            dataSourceId: t.dataSourceId,
            amount: parseFloat(t.amount),
            timestamp: t.timestamp
          })),
          timeDiffSeconds: Math.round(timeDiffSeconds),
          status: 'open'
        });
        continue;
      }

      matchedCount++;
    }

    await Discrepancy.bulkCreate(discrepancies);

    for (const disc of discrepancies) {
      await ArbitrationTicket.create({
        discrepancyId: disc.id,
        batchId,
        status: 'pending'
      });
    }

    await batch.update({
      status: 'completed',
      matchedCount,
      discrepancyCount: discrepancies.length,
      endTime: new Date()
    });

  } catch (err) {
    await batch.update({
      status: 'failed',
      errorMessage: err.message,
      endTime: new Date()
    });
    throw err;
  }
}

async function getBatchStatus(batchId) {
  const batch = await ReconciliationBatch.findByPk(batchId);
  if (!batch) throw new Error('批次不存在');
  return batch;
}

async function getQueueStatus() {
  return {
    isProcessing,
    queueLength: taskQueue.length,
    pendingBatchIds: taskQueue.map(t => t.batchId)
  };
}

module.exports = {
  createBatch,
  triggerReconciliation,
  getBatchStatus,
  getQueueStatus,
  MAX_RECORDS
};
