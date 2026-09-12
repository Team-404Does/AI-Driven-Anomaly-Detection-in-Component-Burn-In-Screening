import {
  pgTable, serial, integer, text, real, boolean, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("qa_engineer"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const batches = pgTable("batches", {
  id: serial("id").primaryKey(),
  batchCode: text("batch_code").notNull().unique(),
  manufacturer: text("manufacturer"),
  sourceFile: text("source_file"),
  testStart: timestamp("test_start"),
  testEnd: timestamp("test_end"),
  status: text("status").notNull().default("validated"),
  componentCount: integer("component_count").notNull().default(0),
  dataQuality: jsonb("data_quality"),
  stats: jsonb("stats"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const components = pgTable("components", {
  id: serial("id").primaryKey(),
  componentCode: text("component_code").notNull().unique(),
  sourceComponentCode: text("source_component_code"),
  batchId: integer("batch_id").notNull().references(() => batches.id),
  lotId: text("lot_id").notNull(),
  waferId: text("wafer_id").notNull(),
  manufacturer: text("manufacturer").notNull(),
  rack: integer("rack").notNull(),
  chamberRow: integer("chamber_row").notNull(),
  chamberCol: integer("chamber_col").notNull(),
  socketId: text("socket_id").notNull(),
  channelId: text("channel_id").notNull(),
  status: text("status").notNull().default("unknown"),
  healthScore: integer("health_score"),
  anomalyScore: real("anomaly_score"),
  driftRisk: text("drift_risk"),
  driftSlope: real("drift_slope"),
  riskScore: real("risk_score"),
  riskLevel: text("risk_level"),
  decision: text("decision"),
  staticLeakLimitUa: real("static_leak_limit_ua").notNull().default(5),
  staticResult: text("static_result"),
  dynamicResult: text("dynamic_result"),
  hiddenAnomaly: boolean("hidden_anomaly").default(false),
  scenarioTag: text("scenario_tag").notNull().default("normal"),
  featureJson: jsonb("feature_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("components_batch_idx").on(t.batchId),
  index("components_lot_idx").on(t.lotId),
  index("components_channel_idx").on(t.channelId),
]);

export const telemetry = pgTable("telemetry", {
  id: serial("id").primaryKey(),
  componentId: integer("component_id").notNull().references(() => components.id),
  hour: real("hour").notNull(),
  leakageUa: real("leakage_ua"),
  vthMv: real("vth_mv"),
  rdsMohm: real("rds_mohm"),
  chamberTempC: real("chamber_temp_c"),
  vdsStressV: real("vds_stress_v"),
  channelId: text("channel_id"),
}, (t) => [
  index("telemetry_comp_idx").on(t.componentId),
  index("telemetry_comp_hour_idx").on(t.componentId, t.hour),
]);

export const anomalies = pgTable("anomalies", {
  id: serial("id").primaryKey(),
  componentId: integer("component_id").notNull().references(() => components.id),
  hour: real("hour").notNull(),
  anomalyScore: real("anomaly_score").notNull(),
  detectorName: text("detector_name").notNull(),
  modelVersion: text("model_version").notNull(),
  severity: text("severity").notNull(),
  confidence: real("confidence"),
  isProcessed: boolean("is_processed").notNull().default(false),
  feedbackLabel: text("feedback_label"),
  explanation: jsonb("explanation"),
  signature: text("signature"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("anomalies_comp_idx").on(t.componentId)]);

export const predictions = pgTable("predictions", {
  id: serial("id").primaryKey(),
  componentId: integer("component_id").notNull().references(() => components.id),
  parameter: text("parameter").notNull().default("leakage_ua"),
  horizonH: integer("horizon_h").notNull().default(168),
  predictedValue: real("predicted_value"),
  lowerBound: real("lower_bound"),
  upperBound: real("upper_bound"),
  slopePer24h: real("slope_per_24h"),
  timeToLimitH: real("time_to_limit_h"),
  confidence: real("confidence"),
  modelVersion: text("model_version").notNull(),
  curve: jsonb("curve"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("predictions_comp_idx").on(t.componentId)]);

export const failureSignatures = pgTable("failure_signatures", {
  id: serial("id").primaryKey(),
  componentId: integer("component_id").notNull().references(() => components.id),
  signature: text("signature").notNull(),
  probability: real("probability").notNull(),
  confidenceText: text("confidence_text"),
  evidence: jsonb("evidence"),
  candidates: jsonb("candidates"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("signatures_comp_idx").on(t.componentId)]);

export const riskAssessments = pgTable("risk_assessments", {
  id: serial("id").primaryKey(),
  componentId: integer("component_id").notNull().references(() => components.id),
  riskScore: real("risk_score").notNull(),
  riskLevel: text("risk_level").notNull(),
  decision: text("decision").notNull(),
  confidence: real("confidence"),
  reasons: jsonb("reasons"),
  modelVersion: text("model_version").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("risk_comp_idx").on(t.componentId)]);

export const equipmentEvents = pgTable("equipment_events", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batches.id),
  channelId: text("channel_id"),
  chamberZone: text("chamber_zone"),
  lotId: text("lot_id"),
  eventType: text("event_type").notNull(),
  startHour: real("start_hour"),
  endHour: real("end_hour"),
  affectedCount: integer("affected_count").notNull().default(0),
  affectedIds: jsonb("affected_ids"),
  correlation: jsonb("correlation"),
  confidence: text("confidence").notNull().default("medium"),
  assessment: text("assessment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("equipment_events_batch_idx").on(t.batchId)]);

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  componentId: integer("component_id").notNull().references(() => components.id),
  userId: integer("user_id").notNull().references(() => users.id),
  originalLabel: text("original_label").notNull(),
  correctedLabel: text("corrected_label").notNull(),
  comment: text("comment"),
  modelVersion: text("model_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const modelRegistry = pgTable("model_registry", {
  id: serial("id").primaryKey(),
  modelName: text("model_name").notNull(),
  modelVersion: text("model_version").notNull(),
  type: text("type").notNull(),
  datasetId: text("dataset_id"),
  metrics: jsonb("metrics"),
  notes: text("notes"),
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userName: text("user_name"),
  action: text("action").notNull(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("audit_time_idx").on(t.createdAt)]);

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  reportCode: text("report_code").notNull().unique(),
  componentId: integer("component_id").references(() => components.id),
  batchId: integer("batch_id").references(() => batches.id),
  reportType: text("report_type").notNull().default("NCR"),
  title: text("title").notNull(),
  content: jsonb("content"),
  generatedBy: text("generated_by"),
  modelVersion: text("model_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Component = typeof components.$inferSelect;
export type Telemetry = typeof telemetry.$inferSelect;
export type Batch = typeof batches.$inferSelect;
export type Anomaly = typeof anomalies.$inferSelect;
