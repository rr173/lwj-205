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
const auditController = require('../controllers/auditController');
const archiveController = require('../controllers/archiveController');
const sandboxController = require('../controllers/sandboxController');
const backtestController = require('../controllers/backtestController');
const sensitivityAnalysisController = require('../controllers/sensitivityAnalysisController');
const tenantController = require('../controllers/tenantController');
const reviewController = require('../controllers/reviewController');

const { requireRole, requireSuperAdmin } = require('../middleware/roleAuth');
const audit = require('../middleware/auditLogger');
const quotaService = require('../services/quotaService');

const { DataSource, AlertRule, SchedulePlan, HealthProbe, ReportSubscription, Discrepancy, ReconciliationBatch, ArchiveConfig } = require('../models');

function quotaCheckMiddleware(quotaCheckFn) {
  return async (req, res, next) => {
    try {
      if (req.user && req.user.role === 'superadmin') {
        return next();
      }
      await quotaCheckFn();
      next();
    } catch (err) {
      if (err instanceof quotaService.QuotaExceededError) {
        return res.status(429).json({
          error: '配额超限',
          quota: err.quotaName,
          used: err.used,
          limit: err.limit,
          message: err.message
        });
      }
      next(err);
    }
  };
}

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ledger-reconciliation-service' });
});

router.get('/tenants/me', tenantController.getCurrentTenantInfo);

router.post('/tenants',
  requireSuperAdmin(),
  audit('CREATE', 'tenant'),
  tenantController.createTenant
);
router.get('/tenants',
  requireSuperAdmin(),
  tenantController.listTenants
);
router.get('/tenants/:tenantId',
  requireSuperAdmin(),
  tenantController.getTenant
);
router.put('/tenants/:tenantId',
  requireSuperAdmin(),
  audit('UPDATE', 'tenant'),
  tenantController.updateTenant
);
router.put('/tenants/:tenantId/freeze',
  requireSuperAdmin(),
  audit('FREEZE', 'tenant'),
  tenantController.freezeTenant
);
router.put('/tenants/:tenantId/unfreeze',
  requireSuperAdmin(),
  audit('UNFREEZE', 'tenant'),
  tenantController.unfreezeTenant
);
router.get('/tenants/:tenantId/quotas',
  requireSuperAdmin(),
  tenantController.getQuotaUsage
);
router.put('/tenants/:tenantId/quotas',
  requireSuperAdmin(),
  audit('UPDATE_QUOTA', 'tenant_quota'),
  tenantController.updateTenantQuotas
);
router.get('/tenants/:tenantId/metering',
  requireSuperAdmin(),
  tenantController.getMeteringStats
);

router.post('/data-sources',
  requireRole('operator'),
  audit('CREATE', 'data_source'),
  dataSourceController.createDataSource
);
router.get('/data-sources', dataSourceController.getDataSources);
router.get('/data-sources/:id', dataSourceController.getDataSource);
router.put('/data-sources/:id',
  requireRole('operator'),
  audit('UPDATE', 'data_source', { model: DataSource, idParam: 'id' }),
  dataSourceController.updateDataSource
);

router.post('/transactions/import',
  requireRole('operator'),
  audit('IMPORT', 'transaction'),
  transactionController.importTransactions
);
router.get('/transactions', transactionController.getTransactions);

router.post('/batches',
  requireRole('operator'),
  audit('CREATE', 'reconciliation_batch'),
  reconciliationController.createBatch
);
router.get('/batches', reconciliationController.getBatches);
router.get('/batches/:batchId', reconciliationController.getBatchStatus);
router.post('/batches/:batchId/reconcile',
  requireRole('operator'),
  audit('TRIGGER', 'reconciliation_batch', { idParam: 'batchId' }),
  reconciliationController.triggerReconciliation
);

router.get('/discrepancies', reconciliationController.getDiscrepancies);
router.get('/queue/status', reconciliationController.getQueueStatus);

router.get('/arbitration/tickets', arbitrationController.getTickets);
router.post('/arbitration/tickets/:ticketId/resolve',
  requireRole('operator'),
  audit('RESOLVE', 'arbitration_ticket', { idParam: 'ticketId' }),
  arbitrationController.resolveTicket
);
router.post('/arbitration/batches/:batchId/auto-arbitrate',
  requireRole('operator'),
  audit('AUTO_ARBITRATE', 'reconciliation_batch', { idParam: 'batchId' }),
  arbitrationController.applyAutoArbitration
);

router.get('/arbitration/adjustments', arbitrationController.getAdjustmentInstructions);

router.get('/arbitration/rules', arbitrationController.getRules);
router.post('/arbitration/rules',
  requireRole('operator'),
  audit('CREATE', 'arbitration_rule'),
  arbitrationController.createRule
);

router.get('/review/configs', reviewController.getConfigs);
router.get('/review/configs/active', reviewController.getActiveConfig);
router.post('/review/configs',
  requireRole('admin'),
  audit('CREATE', 'review_config'),
  reviewController.createConfig
);
router.put('/review/configs/:configId',
  requireRole('admin'),
  audit('UPDATE', 'review_config'),
  reviewController.updateConfig
);

router.post('/review/batches/:batchId/determine',
  requireRole('operator'),
  audit('DETERMINE', 'review'),
  reviewController.determineReview
);

router.get('/review/records', reviewController.getRecords);
router.get('/review/stats', reviewController.getStats);

router.post('/review/records/:recordId/assign',
  requireRole('admin'),
  audit('ASSIGN', 'review_record'),
  reviewController.assignReviewer
);
router.post('/review/records/:recordId/approve',
  requireRole('operator'),
  audit('APPROVE', 'review_record'),
  reviewController.approveReview
);
router.post('/review/records/:recordId/reject',
  requireRole('operator'),
  audit('REJECT', 'review_record'),
  reviewController.rejectReview
);
router.post('/review/records/:recordId/escalate',
  requireRole('admin'),
  audit('ESCALATE', 'review_record'),
  reviewController.escalateReview
);

router.get('/review/discrepancies/:discrepancyId/progress', reviewController.getProgress);
router.get('/review/tickets/:ticketId/can-dispose', reviewController.canDispose);

router.get('/alerts', alertController.getAlerts);
router.put('/alerts/:alertId/read',
  requireRole('operator'),
  audit('MARK_READ', 'alert_event', { idParam: 'alertId' }),
  alertController.markAlertRead
);
router.get('/monitoring/import-trend', alertController.getImportTrend);
router.get('/monitoring/batch-health', alertController.getBatchHealth);

router.get('/alert-rules', alertRuleController.getRules);
router.get('/alert-rules/effective', alertRuleController.resolveEffectiveRules);
router.get('/alert-rules/:ruleId', alertRuleController.getRuleById);
router.post('/alert-rules',
  requireRole('operator'),
  audit('CREATE', 'alert_rule'),
  alertRuleController.createRule
);
router.put('/alert-rules/:ruleId',
  requireRole('operator'),
  audit('UPDATE', 'alert_rule', { model: AlertRule, idParam: 'ruleId' }),
  alertRuleController.updateRule
);
router.put('/alert-rules/:ruleId/toggle',
  requireRole('operator'),
  audit('TOGGLE', 'alert_rule', { model: AlertRule, idParam: 'ruleId' }),
  alertRuleController.toggleRule
);
router.delete('/alert-rules/:ruleId',
  requireRole('operator'),
  audit('DELETE', 'alert_rule', { model: AlertRule, idParam: 'ruleId' }),
  alertRuleController.deleteRule
);
router.get('/alert-rules-history', alertRuleController.getRuleHistory);

router.post('/scheduler/plans',
  requireRole('admin'),
  audit('CREATE', 'schedule_plan'),
  schedulerController.createPlan
);
router.get('/scheduler/plans', schedulerController.listPlans);
router.get('/scheduler/plans/overview', schedulerController.getOverview);
router.get('/scheduler/plans/:planId', schedulerController.getPlan);
router.put('/scheduler/plans/:planId',
  requireRole('admin'),
  audit('UPDATE', 'schedule_plan', { model: SchedulePlan, idParam: 'planId' }),
  schedulerController.updatePlan
);
router.delete('/scheduler/plans/:planId',
  requireRole('admin'),
  audit('DELETE', 'schedule_plan', { model: SchedulePlan, idParam: 'planId' }),
  schedulerController.deletePlan
);
router.put('/scheduler/plans/:planId/pause',
  requireRole('admin'),
  audit('PAUSE', 'schedule_plan', { model: SchedulePlan, idParam: 'planId' }),
  schedulerController.pausePlan
);
router.put('/scheduler/plans/:planId/resume',
  requireRole('admin'),
  audit('RESUME', 'schedule_plan', { model: SchedulePlan, idParam: 'planId' }),
  schedulerController.resumePlan
);
router.post('/scheduler/plans/:planId/trigger',
  requireRole('operator'),
  audit('TRIGGER', 'schedule_plan', { idParam: 'planId' }),
  schedulerController.triggerNow
);
router.get('/scheduler/plans/:planId/sla', schedulerController.getSlaCompliance);
router.get('/scheduler/executions', schedulerController.getExecutions);

router.get('/trend/discrepancy-trend', trendAnalysisController.getDiscrepancyTrend);
router.put('/discrepancies/:discrepancyId/root-cause',
  requireRole('operator'),
  audit('TAG_ROOT_CAUSE', 'discrepancy', { model: Discrepancy, idParam: 'discrepancyId' }),
  trendAnalysisController.tagRootCause
);
router.put('/discrepancies/root-cause/batch',
  requireRole('operator'),
  audit('BATCH_TAG_ROOT_CAUSE', 'discrepancy'),
  trendAnalysisController.batchTagRootCause
);
router.get('/trend/root-cause-aggregation', trendAnalysisController.getRootCauseAggregation);
router.get('/trend/transaction-chain/:transactionId', trendAnalysisController.getTransactionChain);

router.post('/reports/generate',
  requireRole('operator'),
  audit('GENERATE', 'report'),
  reportController.generateReport
);
router.get('/reports', reportController.listReports);

router.post('/reports/subscriptions',
  requireRole('operator'),
  audit('CREATE', 'report_subscription'),
  reportController.createSubscription
);
router.get('/reports/subscriptions', reportController.listSubscriptions);
router.get('/reports/subscriptions/:subscriptionId', reportController.getSubscription);
router.put('/reports/subscriptions/:subscriptionId',
  requireRole('operator'),
  audit('UPDATE', 'report_subscription', { model: ReportSubscription, idParam: 'subscriptionId' }),
  reportController.updateSubscription
);
router.put('/reports/subscriptions/:subscriptionId/toggle',
  requireRole('operator'),
  audit('TOGGLE', 'report_subscription', { model: ReportSubscription, idParam: 'subscriptionId' }),
  reportController.toggleSubscription
);
router.delete('/reports/subscriptions/:subscriptionId',
  requireRole('admin'),
  audit('DELETE', 'report_subscription', { model: ReportSubscription, idParam: 'subscriptionId' }),
  reportController.deleteSubscription
);

router.get('/reports/:reportId', reportController.getReport);

router.post('/health-probes',
  requireRole('operator'),
  audit('CREATE', 'health_probe'),
  healthProbeController.createProbe
);
router.get('/health-probes', healthProbeController.listProbes);
router.get('/health-probes/overview', healthProbeController.getHealthOverview);
router.get('/health-probes/results', healthProbeController.getProbeResults);
router.get('/health-probes/healing-logs', healthProbeController.getSelfHealingLogs);
router.get('/health-probes/:probeId', healthProbeController.getProbe);
router.put('/health-probes/:probeId',
  requireRole('operator'),
  audit('UPDATE', 'health_probe', { model: HealthProbe, idParam: 'probeId' }),
  healthProbeController.updateProbe
);
router.delete('/health-probes/:probeId',
  requireRole('admin'),
  audit('DELETE', 'health_probe', { model: HealthProbe, idParam: 'probeId' }),
  healthProbeController.deleteProbe
);
router.get('/data-sources/:dataSourceId/health', healthProbeController.getDataSourceHealthHistory);

router.get('/audit-logs',
  requireRole('admin'),
  auditController.getAuditLogs
);

router.post('/archive/configs',
  requireRole('admin'),
  audit('CREATE', 'archive_config'),
  archiveController.createConfig
);
router.get('/archive/configs', archiveController.listConfigs);
router.get('/archive/configs/:configId', archiveController.getConfig);
router.put('/archive/configs/:configId',
  requireRole('admin'),
  audit('UPDATE', 'archive_config', { model: ArchiveConfig, idParam: 'configId' }),
  archiveController.updateConfig
);
router.delete('/archive/configs/:configId',
  requireRole('admin'),
  audit('DELETE', 'archive_config', { model: ArchiveConfig, idParam: 'configId' }),
  archiveController.deleteConfig
);

router.post('/archive/batches/:batchId',
  requireRole('admin'),
  audit('ARCHIVE', 'reconciliation_batch', { model: ReconciliationBatch, idParam: 'batchId' }),
  archiveController.archiveBatch
);
router.post('/archive/batches/:batchId/restore',
  requireRole('admin'),
  audit('RESTORE', 'reconciliation_batch', { model: ReconciliationBatch, idParam: 'batchId' }),
  archiveController.restoreBatch
);
router.post('/archive/run-now',
  requireRole('admin'),
  audit('RUN_AUTO_ARCHIVE', 'archive_config'),
  archiveController.runAutoArchiveNow
);

router.get('/archive/batches', archiveController.getArchivedBatches);
router.get('/archive/transactions', archiveController.getArchivedTransactions);
router.get('/archive/discrepancies', archiveController.getArchivedDiscrepancies);
router.get('/archive/tickets', archiveController.getArchivedTickets);
router.get('/archive/stats', archiveController.getArchiveStats);

router.post('/sandboxes',
  requireRole('operator'),
  audit('CREATE', 'sandbox'),
  sandboxController.createSandbox
);
router.get('/sandboxes', sandboxController.listSandboxes);
router.get('/sandboxes/active-limit', sandboxController.getActiveLimit);
router.get('/sandboxes/:sandboxId', sandboxController.getSandbox);
router.put('/sandboxes/:sandboxId',
  requireRole('operator'),
  audit('UPDATE', 'sandbox'),
  sandboxController.updateSandbox
);
router.delete('/sandboxes/:sandboxId',
  requireRole('operator'),
  audit('DELETE', 'sandbox'),
  sandboxController.deleteSandbox
);
router.post('/sandboxes/:sandboxId/reconcile',
  requireRole('operator'),
  audit('TRIGGER', 'sandbox_reconciliation'),
  sandboxController.triggerReconciliation
);
router.get('/sandboxes/:sandboxId/compare', sandboxController.compareWithBaseline);
router.get('/sandboxes/:sandboxId/discrepancies', sandboxController.getDiscrepancies);
router.get('/sandboxes/:sandboxId/tickets', sandboxController.getTickets);

router.post('/backtest/plans',
  requireRole('operator'),
  audit('CREATE', 'backtest_plan'),
  backtestController.createPlan
);
router.get('/backtest/plans', backtestController.listPlans);
router.get('/backtest/plans/:planId', backtestController.getPlan);
router.post('/backtest/plans/:planId/trigger',
  requireRole('operator'),
  audit('TRIGGER', 'backtest_plan'),
  backtestController.triggerPlan
);
router.put('/backtest/plans/:planId/cancel',
  requireRole('operator'),
  audit('CANCEL', 'backtest_plan'),
  backtestController.cancelPlan
);
router.get('/backtest/plans/:planId/summary', backtestController.getSummary);
router.get('/backtest/plans/:planId/executions', backtestController.getExecutions);
router.get('/backtest/executions/:executionId', backtestController.getExecutionDetail);

router.post('/sensitivity/analyses',
  requireRole('operator'),
  audit('CREATE', 'sensitivity_analysis'),
  sensitivityAnalysisController.submitAnalysis
);
router.get('/sensitivity/analyses', sensitivityAnalysisController.listAnalyses);
router.get('/sensitivity/analyses/:taskId', sensitivityAnalysisController.getAnalysis);
router.put('/sensitivity/analyses/:taskId/cancel',
  requireRole('operator'),
  audit('CANCEL', 'sensitivity_analysis'),
  sensitivityAnalysisController.cancelAnalysis
);

router.use((err, req, res, next) => {
  console.error('API错误:', err);
  if (err instanceof quotaService.QuotaExceededError) {
    return res.status(429).json({
      error: '配额超限',
      quota: err.quotaName,
      used: err.used,
      limit: err.limit,
      message: err.message
    });
  }
  res.status(500).json({ error: '服务器内部错误', message: err.message });
});

module.exports = router;
