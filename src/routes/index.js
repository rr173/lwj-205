const express = require('express');
const router = express.Router();

const dataSourceController = require('../controllers/dataSourceController');
const transactionController = require('../controllers/transactionController');
const reconciliationController = require('../controllers/reconciliationController');
const arbitrationController = require('../controllers/arbitrationController');
const alertController = require('../controllers/alertController');

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ledger-reconciliation-service' });
});

router.post('/data-sources', dataSourceController.createDataSource);
router.get('/data-sources', dataSourceController.getDataSources);
router.get('/data-sources/:id', dataSourceController.getDataSource);
router.put('/data-sources/:id', dataSourceController.updateDataSource);

router.post('/transactions/import', transactionController.importTransactions);
router.get('/transactions', transactionController.getTransactions);

router.post('/batches', reconciliationController.createBatch);
router.get('/batches', reconciliationController.getBatches);
router.get('/batches/:batchId', reconciliationController.getBatchStatus);
router.post('/batches/:batchId/reconcile', reconciliationController.triggerReconciliation);

router.get('/discrepancies', reconciliationController.getDiscrepancies);
router.get('/queue/status', reconciliationController.getQueueStatus);

router.get('/arbitration/tickets', arbitrationController.getTickets);
router.post('/arbitration/tickets/:ticketId/resolve', arbitrationController.resolveTicket);
router.post('/arbitration/batches/:batchId/auto-arbitrate', arbitrationController.applyAutoArbitration);

router.get('/arbitration/adjustments', arbitrationController.getAdjustmentInstructions);

router.get('/arbitration/rules', arbitrationController.getRules);
router.post('/arbitration/rules', arbitrationController.createRule);

router.get('/alerts', alertController.getAlerts);
router.put('/alerts/:alertId/read', alertController.markAlertRead);
router.get('/monitoring/import-trend', alertController.getImportTrend);
router.get('/monitoring/batch-health', alertController.getBatchHealth);

module.exports = router;
