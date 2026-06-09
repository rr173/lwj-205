const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const { sequelize } = require('./models');
const routes = require('./routes');
const initDemoData = require('../scripts/init-demo-data');
const alertService = require('./services/alertService');
const alertRuleService = require('./services/alertRuleService');
const schedulerService = require('./services/schedulerService');
const trendAnalysisService = require('./services/trendAnalysisService');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api', routes);

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

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');

    await sequelize.sync({ alter: true });
    console.log('数据库模型同步完成');

    const isFirstRun = await initDemoData.checkAndInit();
    if (isFirstRun) {
      console.log('演示数据初始化完成');
    }

    await alertRuleService.ensureDefaultRules();
    console.log('告警规则初始化完成');

    await initDemoData.ensurePresetSchedulePlans();
    console.log('预设调度计划初始化完成');

    await schedulerService.start();
    console.log('调度引擎初始化完成');

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
