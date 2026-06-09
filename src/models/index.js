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
  ReportSubscription
};
