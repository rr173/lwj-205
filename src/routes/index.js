const express = require('express');
const router = express.Router();

const dataSourceController = require('../controllers/dataSourceController');
const transactionController = require('../controllers/transactionController');
const reconciliationController = require('../controllers/reconciliationController');
const arbitrationController = require('../controllers/arbitrationController');
const alertController = require('../controllers/alertController');
const alertRuleController = require('../controllers/alertRuleController');
const schedulerController = require('../controllers/schedulerController');
const trendAnalysisController = require('../controllers/trendAnalysisController');
const reportController = require('../controllers/reportController');
const healthProbeController = require('../controllers/healthProbeController');

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

router.get('/alert-rules', alertRuleController.getRules);
router.get('/alert-rules/effective', alertRuleController.resolveEffectiveRules);
router.get('/alert-rules/:ruleId', alertRuleController.getRuleById);
router.post('/alert-rules', alertRuleController.createRule);
router.put('/alert-rules/:ruleId', alertRuleController.updateRule);
router.put('/alert-rules/:ruleId/toggle', alertRuleController.toggleRule);
router.delete('/alert-rules/:ruleId', alertRuleController.deleteRule);
router.get('/alert-rules-history', alertRuleController.getRuleHistory);

router.post('/scheduler/plans', schedulerController.createPlan);
router.get('/scheduler/plans', schedulerController.listPlans);
router.get('/scheduler/plans/overview', schedulerController.getOverview);
router.get('/scheduler/plans/:planId', schedulerController.getPlan);
router.put('/scheduler/plans/:planId', schedulerController.updatePlan);
router.delete('/scheduler/plans/:planId', schedulerController.deletePlan);
router.put('/scheduler/plans/:planId/pause', schedulerController.pausePlan);
router.put('/scheduler/plans/:planId/resume', schedulerController.resumePlan);
router.post('/scheduler/plans/:planId/trigger', schedulerController.triggerNow);
router.get('/scheduler/plans/:planId/sla', schedulerController.getSlaCompliance);
router.get('/scheduler/executions', schedulerController.getExecutions);

router.get('/trend/discrepancy-trend', trendAnalysisController.getDiscrepancyTrend);
router.put('/discrepancies/:discrepancyId/root-cause', trendAnalysisController.tagRootCause);
router.put('/discrepancies/root-cause/batch', trendAnalysisController.batchTagRootCause);
router.get('/trend/root-cause-aggregation', trendAnalysisController.getRootCauseAggregation);
router.get('/trend/transaction-chain/:transactionId', trendAnalysisController.getTransactionChain);

router.post('/reports/generate', reportController.generateReport);
router.get('/reports', reportController.listReports);

router.post('/reports/subscriptions', reportController.createSubscription);
router.get('/reports/subscriptions', reportController.listSubscriptions);
router.get('/reports/subscriptions/:subscriptionId', reportController.getSubscription);
router.put('/reports/subscriptions/:subscriptionId', reportController.updateSubscription);
router.put('/reports/subscriptions/:subscriptionId/toggle', reportController.toggleSubscription);
router.delete('/reports/subscriptions/:subscriptionId', reportController.deleteSubscription);

router.get('/reports/:reportId', reportController.getReport);

router.post('/health-probes', healthProbeController.createProbe);
router.get('/health-probes', healthProbeController.listProbes);
router.get('/health-probes/overview', healthProbeController.getHealthOverview);
router.get('/health-probes/results', healthProbeController.getProbeResults);
router.get('/health-probes/healing-logs', healthProbeController.getSelfHealingLogs);
router.get('/health-probes/:probeId', healthProbeController.getProbe);
router.put('/health-probes/:probeId', healthProbeController.updateProbe);
router.delete('/health-probes/:probeId', healthProbeController.deleteProbe);
router.get('/data-sources/:dataSourceId/health', healthProbeController.getDataSourceHealthHistory);

module.exports = router;
