import type { z } from "zod";
import { AiOutputError, type AgentStepRequest, type AgentStepResult, type AiProvider, type StructuredRequest, type StructuredResult } from "./provider";

/**
 * Deterministic AI provider for tests and offline development. Responses are
 * queued per purpose; outputs are still validated against the caller's
 * schema, exactly as real provider output is.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = "fake";
  readonly available = true;
  private structuredQueue = new Map<string, unknown[]>();
  private agentQueue: AgentStepResult["message"][] = [];
  readonly calls: { purpose: string; system: string; content?: unknown; messages?: unknown }[] = [];

  queueStructured(purpose: string, output: unknown): this {
    const q = this.structuredQueue.get(purpose) ?? [];
    q.push(output);
    this.structuredQueue.set(purpose, q);
    return this;
  }

  queueAgent(message: AgentStepResult["message"]): this {
    this.agentQueue.push(message);
    return this;
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
    this.calls.push({ purpose: req.purpose, system: req.system, content: req.content });
    const q = this.structuredQueue.get(req.purpose);
    if (!q?.length) throw new AiOutputError(`FakeAiProvider: no queued output for ${req.purpose}`);
    const raw = q.shift();
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) throw new AiOutputError("Model output failed schema validation", parsed.error);
    return { data: parsed.data, usage: { provider: this.name, model: "fake", inputTokens: 100, outputTokens: 50 } };
  }

  async agentStep(req: AgentStepRequest): Promise<AgentStepResult> {
    this.calls.push({ purpose: req.purpose, system: req.system, messages: structuredClone(req.messages) });
    const message = this.agentQueue.shift();
    if (!message) return { message: { role: "assistant", parts: [{ type: "text", text: "(no scripted response)" }] }, stopReason: "end", usage: { provider: this.name, model: "fake", inputTokens: 0, outputTokens: 0 } };
    const stopReason = message.parts.some((p) => p.type === "tool_call") ? "tool_use" : "end";
    return { message, stopReason, usage: { provider: this.name, model: "fake", inputTokens: 100, outputTokens: 50 } };
  }
}
