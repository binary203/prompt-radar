import { z } from "zod";

import { actionTagSchema, businessDomainSchema } from "./analysis";

export const openAiMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
});

export const openAiRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(openAiMessageSchema).min(1),
  stream: z.boolean().optional(),
});

export const toolCallTraceSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["success", "error"]),
  durationMs: z.number().int().nonnegative(),
});

export const operationalEventSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  userId: z.string().min(1),
  userRole: z.string().min(1),
  department: z.string().min(1),
  agentName: z.string().min(1),
  request: openAiRequestSchema,
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
  latencyMs: z.number().int().nonnegative(),
  toolCalls: z.array(toolCallTraceSchema),
  outcome: z.enum(["success", "partial", "error", "unknown"]),
  feedback: z.union([z.literal(-1), z.literal(0), z.literal(1)]).nullable(),
  repeatOf: z.string().min(1).optional(),
});

export const goldLabelSchema = z.object({
  id: z.string().min(1),
  scenarioIds: z.array(z.string().min(1)),
  primaryAction: actionTagSchema,
  primaryDomain: businessDomainSchema,
  variantType: z.string().min(1),
  manualMinutes: z.object({
    low: z.number().nonnegative(),
    base: z.number().nonnegative(),
    high: z.number().nonnegative(),
  }),
});

export const valueRangeSchema = z.object({
  low: z.number(),
  base: z.number(),
  high: z.number(),
});

export const orderedValueRangeSchema = valueRangeSchema
  .refine(
    ({ low, base, high }) => low <= base && base <= high,
    "Expected low <= base <= high",
  );

export const economicsAssumptionsSchema = z.object({
  monthlyFteCostRub: z.number().positive().default(400_000),
  workingHoursPerMonth: z.number().positive().default(160),
  tokenCostPerThousandRub: z.number().nonnegative().default(0),
  fixedMonthlyCostRub: z.number().nonnegative().default(0),
  periodDays: z.number().int().positive().default(30),
  reviewRate: valueRangeSchema.default({
    low: 0.5,
    base: 0.3,
    high: 0.15,
  }),
});

export type EconomicsAssumptions = z.infer<
  typeof economicsAssumptionsSchema
>;
export type GoldLabel = z.infer<typeof goldLabelSchema>;
export type OpenAiRequest = z.infer<typeof openAiRequestSchema>;
export type OperationalEvent = z.infer<typeof operationalEventSchema>;
export type ToolCallTrace = z.infer<typeof toolCallTraceSchema>;
export type OrderedValueRange = z.infer<typeof orderedValueRangeSchema>;
export type ValueRange = z.infer<typeof valueRangeSchema>;
