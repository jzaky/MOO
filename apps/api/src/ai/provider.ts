import type { z } from "zod";

/**
 * Provider-neutral AI interface. Business logic depends only on this; the
 * Anthropic implementation lives in anthropic.ts and a deterministic fake in
 * fake.ts (tests and offline development).
 *
 * Rules enforced by callers, not providers:
 *  - Model output is always validated against a schema before use.
 *  - Arithmetic (nutrition totals, progression, trends) is done in @stoke/core.
 *  - Nothing the model returns is written to user records without the user's
 *    confirmation.
 */

export type AiPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string };

export interface AiUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredRequest<S extends z.ZodType> {
  /** Short label used for metering ("food_photo", "label_ocr", ...). */
  purpose: string;
  system: string;
  content: AiPart[];
  schema: S;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export interface StructuredResult<T> {
  data: T;
  usage: AiUsage;
}

export type AgentPart =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean };

export interface AgentMessage {
  role: "user" | "assistant";
  parts: AgentPart[];
  /**
   * Provider-native content for assistant turns (e.g. thinking blocks that
   * must be replayed unchanged). Opaque to callers; providers that receive
   * native content they produced use it verbatim.
   */
  native?: unknown;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema (object) for the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface AgentStepRequest {
  purpose: string;
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  maxTokens?: number;
}

export interface AgentStepResult {
  message: AgentMessage;
  stopReason: "end" | "tool_use" | "max_tokens" | "refusal";
  usage: AiUsage;
}

export class AiUnavailableError extends Error {
  constructor(message = "AI features are not configured on this server") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export class AiOutputError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "AiOutputError";
  }
}

export interface AiProvider {
  readonly name: string;
  readonly available: boolean;
  structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>>;
  agentStep(req: AgentStepRequest): Promise<AgentStepResult>;
}

export class DisabledAiProvider implements AiProvider {
  readonly name = "none";
  readonly available = false;
  async structured(): Promise<never> {
    throw new AiUnavailableError();
  }
  async agentStep(): Promise<never> {
    throw new AiUnavailableError();
  }
}
