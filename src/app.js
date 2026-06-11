const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const { sequelize, Tenant, TenantQuota } = require('./models');
const routes = require('./routes');
const { extractUser } = require('./middleware/roleAuth');
const { initTenantScopes, extractAndValidateTenant, checkTenantFrozen } = require('./middleware/tenantIsolation');
const initDemoData = require('../scripts/init-demo-data');
const meteringService = require('./services/meteringService');
const quotaService = require('./services/quotaService');
const alertService = require('./services/alertService');
const alertRuleService = require('./services/alertRuleService');
const schedulerService = require('./services/schedulerService');
const trendAnalysisService = require('./services/trendAnalysisService');
const reportService = require('./services/reportService');
const healthProbeService = require('./services/healthProbeService');
const archiveService = require('./services/archiveService');
const sandboxService = require('./services/sandboxService');
const backtestService = require('./services/backtestService');
const sensitivityAnalysisService = require('./services/sensitivityAnalysisService');
const stressTestService = require('./services/stressTestService');
const reviewService = require('./services/reviewService');
const appealService = require('./services/appealService');
const disposalPlanService = require('./services/disposalPlanService');
const { asyncLocalStorage } = require('./utils/tenantContext');
const { v4: uuidv4 } = require('uuid');

async function ensureDefaultTenant() {
  let tenant = await Tenant.findOne({ where: { name: 'default' } });
  if (tenant) {
    let quota = await TenantQuota.findOne({ where: { tenantId: tenant.id } });
    if (!quota) {
      await TenantQuota.create({
        id: uuidv4(),
        tenantId: tenant.id,
        maxDataSources: 100,
        maxRecordsPerBatch: 1000000,
        maxActiveSchedulePlans: 50,
        maxConcurrentSandboxes: 50,
        maxApiCallsPerHour: 100000
      });
    }
    return tenant;
  }

  return sequelize.transaction(async (t) => {
    const t2 = await Tenant.create({
      id: uuidv4(),
      name: 'default',
      displayName: '默认租户',
      description: '系统预置的默认租户，用于兼容历史数据',
      status: 'active',
      createdBy: 'system'
    }, { transaction: t });

    await TenantQuota.create({
      id: uuidv4(),
      tenantId: t2.id,
      maxDataSources: 100,
      maxRecordsPerBatch: 1000000,
      maxActiveSchedulePlans: 50,
      maxConcurrentSandboxes: 50,
      maxApiCallsPerHour: 100000
    }, { transaction: t });

    return t2;
  });
}

function runWithTenant(tenant, fn) {
  return new Promise((resolve, reject) => {
    const store = new Map();
    store.set('tenantContext', {
      tenantId: tenant.id,
      tenant: tenant.toJSON(),
      isSuperAdmin: false,
      bypassTenantFilter: false
    });
    asyncLocalStorage.run(store, async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

initTenantScopes();

app.use(extractUser);

const SKIP_TENANT_CHECK_PATHS = [
  '/api/health',
  '/health'
];
app.use((req, res, next) => {
  if (SKIP_TENANT_CHECK_PATHS.some(p => req.path.startsWith(p))) {
    return next();
  }
  if (req.path.startsWith('/api')) {
    return extractAndValidateTenant(req, res, next);
  }
  next();
});
app.use('/api', (req, res, next) => {
  if (SKIP_TENANT_CHECK_PATHS.some(p => req.path.startsWith(p))) {
    return next();
  }

  const ctx = asyncLocalStorage.getStore()?.get('tenantContext');
  if (!ctx || ctx.isSuperAdmin) {
    return next();
  }

  const tid = ctx.tenantId;
  if (!tid) {
    return next();
  }

  quotaService.checkApiCallsQuota(tid).then(() => {
    next();
  }).catch((err) => {
    if (err instanceof quotaService.QuotaExceededError) {
      return res.status(429).json({
        error: 'API调用频率超限',
        quota: err.quotaName,
        used: err.used,
        limit: err.limit,
        message: err.message
      });
    }
    next(err);
  });
}, (req, res, next) => {
  if (SKIP_TENANT_CHECK_PATHS.some(p => req.path.startsWith(p))) {
    return next();
  }
  checkTenantFrozen(req, res, next);
}, routes);

app.use(express.static(path.join(__dirname, '../frontend/build')));

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, '../frontend/build/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({
      name: '多源账本对账与差异仲裁服务',
      version: '1.0.0',
      endpoints: {
        health: 'GET /api/health',
        dataSources: {
          list: 'GET /api/data-sources',
          create: 'POST /api/data-sources',
          get: 'GET /api/data-sources/:id',
          update: 'PUT /api/data-sources/:id'
        },
        transactions: {
          import: 'POST /api/transactions/import',
          list: 'GET /api/transactions'
        },
        reconciliation: {
          createBatch: 'POST /api/batches',
          listBatches: 'GET /api/batches',
          getBatch: 'GET /api/batches/:batchId',
          trigger: 'POST /api/batches/:batchId/reconcile',
          discrepancies: 'GET /api/discrepancies',
          queueStatus: 'GET /api/queue/status'
        },
        arbitration: {
          tickets: 'GET /api/arbitration/tickets',
          resolve: 'POST /api/arbitration/tickets/:ticketId/resolve',
          autoArbitrate: 'POST /api/arbitration/batches/:batchId/auto-arbitrate',
          adjustments: 'GET /api/arbitration/adjustments',
          rules: 'GET /api/arbitration/rules',
          createRule: 'POST /api/arbitration/rules'
        },
        monitoring: {
          alerts: 'GET /api/alerts',
          importTrend: 'GET /api/monitoring/import-trend',
          batchHealth: 'GET /api/monitoring/batch-health'
        },
        scheduler: {
          createPlan: 'POST /api/scheduler/plans',
          listPlans: 'GET /api/scheduler/plans',
          overview: 'GET /api/scheduler/plans/overview',
          getPlan: 'GET /api/scheduler/plans/:planId',
          updatePlan: 'PUT /api/scheduler/plans/:planId',
          deletePlan: 'DELETE /api/scheduler/plans/:planId',
          pausePlan: 'PUT /api/scheduler/plans/:planId/pause',
          resumePlan: 'PUT /api/scheduler/plans/:planId/resume',
          triggerNow: 'POST /api/scheduler/plans/:planId/trigger',
          slaCompliance: 'GET /api/scheduler/plans/:planId/sla',
          executions: 'GET /api/scheduler/executions'
        },
        healthProbes: {
          createProbe: 'POST /api/health-probes',
          listProbes: 'GET /api/health-probes',
          overview: 'GET /api/health-probes/overview',
          getProbe: 'GET /api/health-probes/:probeId',
          updateProbe: 'PUT /api/health-probes/:probeId',
          deleteProbe: 'DELETE /api/health-probes/:probeId',
          probeResults: 'GET /api/health-probes/results',
          healingLogs: 'GET /api/health-probes/healing-logs',
          dataSourceHealth: 'GET /api/data-sources/:dataSourceId/health'
        },
        sandboxes: {
          create: 'POST /api/sandboxes',
          list: 'GET /api/sandboxes',
          activeLimit: 'GET /api/sandboxes/active-limit',
          get: 'GET /api/sandboxes/:sandboxId',
          update: 'PUT /api/sandboxes/:sandboxId',
          delete: 'DELETE /api/sandboxes/:sandboxId',
          reconcile: 'POST /api/sandboxes/:sandboxId/reconcile',
          compare: 'GET /api/sandboxes/:sandboxId/compare',
          discrepancies: 'GET /api/sandboxes/:sandboxId/discrepancies',
          tickets: 'GET /api/sandboxes/:sandboxId/tickets'
        },
        backtest: {
          createPlan: 'POST /api/backtest/plans',
          listPlans: 'GET /api/backtest/plans',
          getPlan: 'GET /api/backtest/plans/:planId',
          triggerPlan: 'POST /api/backtest/plans/:planId/trigger',
          cancelPlan: 'PUT /api/backtest/plans/:planId/cancel',
          getSummary: 'GET /api/backtest/plans/:planId/summary',
          listExecutions: 'GET /api/backtest/plans/:planId/executions',
          getExecution: 'GET /api/backtest/executions/:executionId'
        },
        sensitivity: {
          submit: 'POST /api/sensitivity/analyses',
          list: 'GET /api/sensitivity/analyses',
          get: 'GET /api/sensitivity/analyses/:taskId',
          cancel: 'PUT /api/sensitivity/analyses/:taskId/cancel'
        }
      }
    });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`WebSocket客户端已连接，当前连接数: ${wsClients.size}`);

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`WebSocket客户端已断开，当前连接数: ${wsClients.size}`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket错误:', err.message);
    wsClients.delete(ws);
  });
});

function wsBroadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wsClients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

alertService.setWsBroadcast(wsBroadcast);
schedulerService.setWsBroadcast(wsBroadcast);
trendAnalysisService.setWsBroadcast(wsBroadcast);
reportService.setWsBroadcast(wsBroadcast);
healthProbeService.setWsBroadcast(wsBroadcast);
archiveService.setWsBroadcast(wsBroadcast);
sandboxService.setWsBroadcast(wsBroadcast);
backtestService.setWsBroadcast(wsBroadcast);
sensitivityAnalysisService.setWsBroadcast(wsBroadcast);
stressTestService.setWsBroadcast(wsBroadcast);
reviewService.setWsBroadcast(wsBroadcast);
appealService.setWsBroadcast(wsBroadcast);

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');

    await sequelize.sync();
    console.log('数据库模型同步完成');

    const defaultTenant = await ensureDefaultTenant();

    const isFirstRun = await initDemoData.checkAndInit();
    if (isFirstRun) {
      console.log('演示数据初始化完成');
    }

    await runWithTenant(defaultTenant, async () => {
      await alertRuleService.ensureDefaultRules();
      console.log('告警规则初始化完成');

      await initDemoData.ensurePresetSchedulePlans();
      console.log('预设调度计划初始化完成');

      await initDemoData.ensurePresetHealthProbes();
      console.log('预设健康探针初始化完成');

      await archiveService.ensureDefaultConfig();
      console.log('归档配置初始化完成');

      await reviewService.ensureDefaultConfig(defaultTenant.id);
      console.log('复核配置初始化完成');

      await initDemoData.ensurePresetArchivedBatches();
      console.log('预设归档批次数据初始化完成');
    });

    await schedulerService.start();
    console.log('调度引擎初始化完成');

    await healthProbeService.start();
    console.log('健康探针引擎初始化完成');

    await sandboxService.start();
    console.log('沙盒引擎初始化完成');

    backtestService.start();
    console.log('回测引擎初始化完成');

    sensitivityAnalysisService.start();
    console.log('灵敏度分析引擎初始化完成');

    stressTestService.start();
    console.log('压测引擎初始化完成');

    meteringService.startCleanupJob();
    console.log('计量数据清理任务已启动');

    reviewService.startTimeoutCheck();
    console.log('复核超时检查任务已启动');

    appealService.startVoteExpiryCheck();
    console.log('申诉投票过期检查任务已启动');

    disposalPlanService.startInefficientCheck();
    console.log('预案低效检查任务已启动');

    server.listen(PORT, () => {
      console.log(`服务已启动，监听端口: ${PORT}`);
      console.log(`访问地址: http://localhost:${PORT}`);
      console.log(`WebSocket地址: ws://localhost:${PORT}/ws`);
    });
  } catch (err) {
    console.error('服务启动失败:', err);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server };
