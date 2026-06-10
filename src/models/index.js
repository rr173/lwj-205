const sequelize = require('../config/database');
const DataSource = require('./DataSource');
const Transaction = require('./Transaction');
const ReconciliationBatch = require('./ReconciliationBatch');
const Discrepancy = require('./Discrepancy');
const ArbitrationTicket = require('./ArbitrationTicket');
const AdjustmentInstruction = require('./AdjustmentInstruction');
const ArbitrationRule = require('./ArbitrationRule');
const AlertEvent = require('./AlertEvent');
const AlertRule = require('./AlertRule');
const AlertRuleHistory = require('./AlertRuleHistory');
const SchedulePlan = require('./SchedulePlan');
const ScheduleExecution = require('./ScheduleExecution');
const ReconciliationReport = require('./ReconciliationReport');
const ReportSubscription = require('./ReportSubscription');
const HealthProbe = require('./HealthProbe');
const ProbeResult = require('./ProbeResult');
const SelfHealingLog = require('./SelfHealingLog');
const AuditLog = require('./AuditLog');
const TransactionArchive = require('./TransactionArchive');
const DiscrepancyArchive = require('./DiscrepancyArchive');
const ArbitrationTicketArchive = require('./ArbitrationTicketArchive');
const AdjustmentInstructionArchive = require('./AdjustmentInstructionArchive');
const ArchiveConfig = require('./ArchiveConfig');
const Sandbox = require('./Sandbox');
const SandboxTransaction = require('./SandboxTransaction');
const SandboxDiscrepancy = require('./SandboxDiscrepancy');
const SandboxArbitrationTicket = require('./SandboxArbitrationTicket');
const BacktestPlan = require('./BacktestPlan');
const BacktestExecution = require('./BacktestExecution');

DataSource.hasMany(Transaction, { foreignKey: 'dataSourceId' });
Transaction.belongsTo(DataSource, { foreignKey: 'dataSourceId' });

ReconciliationBatch.hasMany(Transaction, { foreignKey: 'batchId' });
Transaction.belongsTo(ReconciliationBatch, { foreignKey: 'batchId' });

ReconciliationBatch.hasMany(Discrepancy, { foreignKey: 'batchId', as: 'discrepancies' });
Discrepancy.belongsTo(ReconciliationBatch, { foreignKey: 'batchId', as: 'batch' });

Discrepancy.hasOne(ArbitrationTicket, { foreignKey: 'discrepancyId' });
ArbitrationTicket.belongsTo(Discrepancy, { foreignKey: 'discrepancyId' });

ArbitrationTicket.hasMany(AdjustmentInstruction, { foreignKey: 'arbitrationTicketId' });
AdjustmentInstruction.belongsTo(ArbitrationTicket, { foreignKey: 'arbitrationTicketId' });

AlertRule.hasMany(AlertRuleHistory, { foreignKey: 'ruleId', as: 'histories' });
AlertRuleHistory.belongsTo(AlertRule, { foreignKey: 'ruleId', as: 'rule' });

DataSource.hasMany(AlertRule, { foreignKey: 'dataSourceId', as: 'alertRules' });
AlertRule.belongsTo(DataSource, { foreignKey: 'dataSourceId', as: 'dataSource' });

SchedulePlan.hasMany(ScheduleExecution, { foreignKey: 'planId', as: 'executions' });
ScheduleExecution.belongsTo(SchedulePlan, { foreignKey: 'planId', as: 'plan' });

ScheduleExecution.belongsTo(ReconciliationBatch, { foreignKey: 'batchId', as: 'batch' });
ReconciliationBatch.hasOne(ScheduleExecution, { foreignKey: 'batchId', as: 'scheduleExecution' });

ReconciliationReport.belongsTo(ReconciliationBatch, { foreignKey: 'batchId', as: 'batch' });
ReconciliationBatch.hasOne(ReconciliationReport, { foreignKey: 'batchId', as: 'report' });

DataSource.hasMany(HealthProbe, { foreignKey: 'dataSourceId', as: 'healthProbes' });
HealthProbe.belongsTo(DataSource, { foreignKey: 'dataSourceId', as: 'dataSource' });

HealthProbe.hasMany(ProbeResult, { foreignKey: 'probeId', as: 'results' });
ProbeResult.belongsTo(HealthProbe, { foreignKey: 'probeId', as: 'probe' });

DataSource.hasMany(ProbeResult, { foreignKey: 'dataSourceId', as: 'probeResults' });
ProbeResult.belongsTo(DataSource, { foreignKey: 'dataSourceId', as: 'dataSource' });

DataSource.hasMany(SelfHealingLog, { foreignKey: 'dataSourceId', as: 'selfHealingLogs' });
SelfHealingLog.belongsTo(DataSource, { foreignKey: 'dataSourceId', as: 'dataSource' });

HealthProbe.hasMany(SelfHealingLog, { foreignKey: 'probeId', as: 'selfHealingLogs' });
SelfHealingLog.belongsTo(HealthProbe, { foreignKey: 'probeId', as: 'probe' });

Sandbox.belongsTo(ReconciliationBatch, { foreignKey: 'baseBatchId', as: 'baseBatch' });
ReconciliationBatch.hasMany(Sandbox, { foreignKey: 'baseBatchId', as: 'sandboxes' });

Sandbox.hasMany(SandboxTransaction, { foreignKey: 'sandboxId', as: 'transactions' });
SandboxTransaction.belongsTo(Sandbox, { foreignKey: 'sandboxId', as: 'sandbox' });

Sandbox.hasMany(SandboxDiscrepancy, { foreignKey: 'sandboxId', as: 'discrepancies' });
SandboxDiscrepancy.belongsTo(Sandbox, { foreignKey: 'sandboxId', as: 'sandbox' });

SandboxDiscrepancy.hasOne(SandboxArbitrationTicket, { foreignKey: 'discrepancyId' });
SandboxArbitrationTicket.belongsTo(SandboxDiscrepancy, { foreignKey: 'discrepancyId' });

Sandbox.hasMany(SandboxArbitrationTicket, { foreignKey: 'sandboxId', as: 'tickets' });
SandboxArbitrationTicket.belongsTo(Sandbox, { foreignKey: 'sandboxId', as: 'sandbox' });

BacktestPlan.hasMany(Sandbox, { foreignKey: 'backtestPlanId', as: 'sandboxes' });
Sandbox.belongsTo(BacktestPlan, { foreignKey: 'backtestPlanId', as: 'backtestPlan' });

BacktestPlan.hasMany(BacktestExecution, { foreignKey: 'backtestPlanId', as: 'executions' });
BacktestExecution.belongsTo(BacktestPlan, { foreignKey: 'backtestPlanId', as: 'backtestPlan' });

BacktestExecution.belongsTo(ReconciliationBatch, { foreignKey: 'batchId', as: 'batch' });
BacktestExecution.belongsTo(Sandbox, { foreignKey: 'sandboxId', as: 'sandbox' });

module.exports = {
  sequelize,
  DataSource,
  Transaction,
  ReconciliationBatch,
  Discrepancy,
  ArbitrationTicket,
  AdjustmentInstruction,
  ArbitrationRule,
  AlertEvent,
  AlertRule,
  AlertRuleHistory,
  SchedulePlan,
  ScheduleExecution,
  ReconciliationReport,
  ReportSubscription,
  HealthProbe,
  ProbeResult,
  SelfHealingLog,
  AuditLog,
  TransactionArchive,
  DiscrepancyArchive,
  ArbitrationTicketArchive,
  AdjustmentInstructionArchive,
  ArchiveConfig,
  Sandbox,
  SandboxTransaction,
  SandboxDiscrepancy,
  SandboxArbitrationTicket,
  BacktestPlan,
  BacktestExecution
};
