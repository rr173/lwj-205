const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { sequelize } = require('./models');
const routes = require('./routes');
const initDemoData = require('../scripts/init-demo-data');

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

app.get('/', (req, res) => {
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
      }
    }
  });
});

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');

    await sequelize.sync({ alter: false });
    console.log('数据库模型同步完成');

    const isFirstRun = await initDemoData.checkAndInit();
    if (isFirstRun) {
      console.log('演示数据初始化完成');
    }

    app.listen(PORT, () => {
      console.log(`服务已启动，监听端口: ${PORT}`);
      console.log(`访问地址: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('服务启动失败:', err);
    process.exit(1);
  }
}

startServer();

module.exports = app;
