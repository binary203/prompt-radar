import { z } from "zod";

export const actionTagSchema = z.enum([
  "retrieve",
  "summarize",
  "analyze",
  "write",
  "create",
  "update",
  "export",
  "schedule",
  "monitor",
  "notify",
  "other",
]);

export const businessDomainSchema = z.enum([
  "email",
  "crm_sales",
  "project_systems",
  "hr",
  "calendar_meetings",
  "knowledge_base",
  "spreadsheets_analytics",
  "public_sources",
  "other",
]);

export const promptRecordSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  prompt: z.string().min(1),
  department: z.string().optional(),
  agentName: z.string().optional(),
  agentVersion: z.string().optional(),
  status: z.enum(["success", "error", "unknown"]).default("unknown"),
  errorType: z.string().optional(),
  latencyMs: z.number().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  feedback: z.number().min(-1).max(1).optional(),
});

const rateSchema = z.number().min(0).max(1);

export const trendPointSchema = z.object({
  date: z.string().min(1),
  requests: z.number().int().nonnegative(),
  problemRate: rateSchema,
});

export const scenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  action: actionTagSchema,
  domain: businessDomainSchema,
  requestCount: z.number().int().nonnegative(),
  share: rateSchema,
  growthRate: z.number(),
  problemRate: rateSchema,
  confidence: rateSchema,
  examples: z.array(z.string().min(1)).min(1),
  signals: z.array(z.string().min(1)),
});

export const opportunitySchema = z.object({
  id: z.string().min(1),
  rank: z.number().int().positive(),
  title: z.string().min(1),
  recommendation: z.string().min(1),
  recommendationType: z.enum([
    "automate",
    "integrate",
    "improve_agent",
    "train_users",
  ]),
  impactScore: z.number().min(0).max(100),
  requestCount: z.number().int().nonnegative(),
  evidence: z.array(z.string().min(1)).min(1),
});

export const workflowEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  requestCount: z.number().int().positive(),
  problemRate: rateSchema,
});

export const analysisResultSchema = z.object({
  dataset: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    source: z.enum(["demo", "generated", "uploaded", "live"]),
    generatedAt: z.string().min(1),
    totalRequests: z.number().int().nonnegative(),
    period: z.object({
      start: z.string().min(1),
      end: z.string().min(1),
    }),
  }),
  overview: z.object({
    activeScenarios: z.number().int().nonnegative(),
    unknownRate: rateSchema,
    problemRate: rateSchema,
    automationCandidates: z.number().int().nonnegative(),
    localProcessingRate: rateSchema,
    tokenReductionFactor: z.number().positive(),
  }),
  trend: z.array(trendPointSchema).min(1),
  scenarios: z.array(scenarioSchema),
  opportunities: z.array(opportunitySchema),
  workflow: z.array(workflowEdgeSchema),
  methodology: z.object({
    classifier: z.string().min(1),
    clusterer: z.string().min(1),
    macroF1: rateSchema,
    clusterPurity: rateSchema,
    llmCalls: z.number().int().nonnegative(),
    llmEveryPromptBaselineCalls: z.number().int().nonnegative(),
    elapsedMs: z.number().nonnegative(),
  }),
});

export type ActionTag = z.infer<typeof actionTagSchema>;
export type BusinessDomain = z.infer<typeof businessDomainSchema>;
export type PromptRecord = z.infer<typeof promptRecordSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
