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
const SensitivityAnalysis = require('./SensitivityAnalysis');
const Tenant = require('./Tenant');
const TenantQuota = require('./TenantQuota');
const TenantMetering = require('./TenantMetering');
const TenantApiUsage = require('./TenantApiUsage');
const ReviewConfig = require('./ReviewConfig');
const ReviewRecord = require('./ReviewRecord');
const Appeal = require('./Appeal');
const VoteSession = require('./VoteSession');
const Vote = require('./Vote');

Tenant.hasOne(TenantQuota, { foreignKey: 'tenantId', as: 'quota' });
TenantQuota.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(TenantMetering, { foreignKey: 'tenantId', as: 'meterings' });
TenantMetering.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(TenantApiUsage, { foreignKey: 'tenantId', as: 'apiUsages' });
TenantApiUsage.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

Tenant.hasMany(DataSource, { foreignKey: 'tenantId' });
DataSource.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(Transaction, { foreignKey: 'tenantId' });
Transaction.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(ReconciliationBatch, { foreignKey: 'tenantId' });
ReconciliationBatch.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(Discrepancy, { foreignKey: 'tenantId' });
Discrepancy.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(ArbitrationTicket, { foreignKey: 'tenantId' });
ArbitrationTicket.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(AdjustmentInstruction, { foreignKey: 'tenantId' });
AdjustmentInstruction.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(ArbitrationRule, { foreignKey: 'tenantId' });
ArbitrationRule.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(AlertEvent, { foreignKey: 'tenantId' });
AlertEvent.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(AlertRule, { foreignKey: 'tenantId' });
AlertRule.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(AlertRuleHistory, { foreignKey: 'tenantId' });
AlertRuleHistory.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(SchedulePlan, { foreignKey: 'tenantId' });
SchedulePlan.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(ScheduleExecution, { foreignKey: 'tenantId' });
ScheduleExecution.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(ReconciliationReport, { foreignKey: 'tenantId' });
ReconciliationReport.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(ReportSubscription, { foreignKey: 'tenantId' });
ReportSubscription.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(HealthProbe, { foreignKey: 'tenantId' });
HealthProbe.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(ProbeResult, { foreignKey: 'tenantId' });
ProbeResult.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(SelfHealingLog, { foreignKey: 'tenantId' });
SelfHealingLog.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(AuditLog, { foreignKey: 'tenantId' });
AuditLog.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(TransactionArchive, { foreignKey: 'tenantId' });
TransactionArchive.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(DiscrepancyArchive, { foreignKey: 'tenantId' });
DiscrepancyArchive.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(ArbitrationTicketArchive, { foreignKey: 'tenantId' });
ArbitrationTicketArchive.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(AdjustmentInstructionArchive, { foreignKey: 'tenantId' });
AdjustmentInstructionArchive.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(ArchiveConfig, { foreignKey: 'tenantId' });
ArchiveConfig.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(Sandbox, { foreignKey: 'tenantId' });
Sandbox.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(SandboxTransaction, { foreignKey: 'tenantId' });
SandboxTransaction.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(SandboxDiscrepancy, { foreignKey: 'tenantId' });
SandboxDiscrepancy.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(SandboxArbitrationTicket, { foreignKey: 'tenantId' });
SandboxArbitrationTicket.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(BacktestPlan, { foreignKey: 'tenantId' });
BacktestPlan.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(BacktestExecution, { foreignKey: 'tenantId' });
BacktestExecution.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(SensitivityAnalysis, { foreignKey: 'tenantId' });
SensitivityAnalysis.belongsTo(Tenant, { foreignKey: 'tenantId' });

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

SensitivityAnalysis.belongsTo(ReconciliationBatch, { foreignKey: 'baseBatchId', as: 'baseBatch' });
ReconciliationBatch.hasMany(SensitivityAnalysis, { foreignKey: 'baseBatchId', as: 'sensitivityAnalyses' });

Tenant.hasMany(ReviewConfig, { foreignKey: 'tenantId' });
ReviewConfig.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(ReviewRecord, { foreignKey: 'tenantId' });
ReviewRecord.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(Appeal, { foreignKey: 'tenantId' });
Appeal.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(VoteSession, { foreignKey: 'tenantId' });
VoteSession.belongsTo(Tenant, { foreignKey: 'tenantId' });

Tenant.hasMany(Vote, { foreignKey: 'tenantId' });
Vote.belongsTo(Tenant, { foreignKey: 'tenantId' });

Discrepancy.hasMany(ReviewRecord, { foreignKey: 'discrepancyId', as: 'reviewRecords' });
ReviewRecord.belongsTo(Discrepancy, { foreignKey: 'discrepancyId', as: 'discrepancy' });

ArbitrationTicket.hasMany(ReviewRecord, { foreignKey: 'arbitrationTicketId', as: 'reviewRecords' });
ReviewRecord.belongsTo(ArbitrationTicket, { foreignKey: 'arbitrationTicketId', as: 'arbitrationTicket' });

ReconciliationBatch.hasMany(ReviewRecord, { foreignKey: 'batchId', as: 'reviewRecords' });
ReviewRecord.belongsTo(ReconciliationBatch, { foreignKey: 'batchId', as: 'batch' });

Discrepancy.hasMany(Appeal, { foreignKey: 'discrepancyId', as: 'appeals' });
Appeal.belongsTo(Discrepancy, { foreignKey: 'discrepancyId', as: 'discrepancy' });

ArbitrationTicket.hasMany(Appeal, { foreignKey: 'arbitrationTicketId', as: 'appeals' });
Appeal.belongsTo(ArbitrationTicket, { foreignKey: 'arbitrationTicketId', as: 'arbitrationTicket' });

ReconciliationBatch.hasMany(Appeal, { foreignKey: 'batchId', as: 'appeals' });
Appeal.belongsTo(ReconciliationBatch, { foreignKey: 'batchId', as: 'batch' });

Appeal.hasMany(VoteSession, { foreignKey: 'appealId', as: 'voteSessions' });
VoteSession.belongsTo(Appeal, { foreignKey: 'appealId', as: 'appeal' });

VoteSession.hasMany(Vote, { foreignKey: 'voteSessionId', as: 'votes' });
Vote.belongsTo(VoteSession, { foreignKey: 'voteSessionId', as: 'voteSession' });

Appeal.hasMany(Vote, { foreignKey: 'appealId', as: 'votes' });
Vote.belongsTo(Appeal, { foreignKey: 'appealId', as: 'appeal' });

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
  BacktestExecution,
  SensitivityAnalysis,
  Tenant,
  TenantQuota,
  TenantMetering,
  TenantApiUsage,
  ReviewConfig,
  ReviewRecord,
  Appeal,
  VoteSession,
  Vote
};
