import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import {
  AiOutputError,
  type AgentMessage,
  type AgentPart,
  type AgentStepRequest,
  type AgentStepResult,
  type AiPart,
  type AiProvider,
  type StructuredRequest,
  type StructuredResult,
} from "./provider";

/**
 * Claude implementation of AiProvider.
 *
 * - Structured outputs via `messages.parse` + Zod output format, so responses
 *   are schema-validated by the SDK and again by our callers.
 * - Server-side refusal fallback (`fallbacks: "default"`) is enabled so a
 *   policy decline is retried on Anthropic's recommended fallback model.
 * - Assistant turns keep the provider-native content (including thinking
 *   blocks) so tool loops replay it unchanged.
 */

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function toBlocks(parts: AiPart[]): Anthropic.Beta.BetaContentBlockParam[] {
  return parts.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.base64 } },
  );
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  readonly available = true;
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 8000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system: req.system,
      output_config: { effort: req.effort ?? "medium", format: betaZodOutputFormat(req.schema) },
      messages: [{ role: "user", content: toBlocks(req.content) }],
    });
    if (response.stop_reason === "refusal") throw new AiOutputError("The model declined this request");
    if (response.stop_reason === "max_tokens") throw new AiOutputError("The model response was truncated");
    if (response.parsed_output == null) throw new AiOutputError("The model did not return valid structured output");
    return {
      data: response.parsed_output as z.infer<S>,
      usage: { provider: this.name, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }

  async agentStep(req: AgentStepRequest): Promise<AgentStepResult> {
    const messages: Anthropic.Beta.BetaMessageParam[] = req.messages.map((m) => {
      if (m.role === "assistant" && m.native) return { role: "assistant", content: m.native as Anthropic.Beta.BetaContentBlockParam[] };
      return { role: m.role, content: m.parts.map(partToBlock) };
    });
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "medium" },
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema })),
      messages,
    });
    const parts: AgentPart[] = [];
    for (const block of response.content) {
      if (block.type === "text") parts.push({ type: "text", text: block.text });
      else if (block.type === "tool_use") parts.push({ type: "tool_call", id: block.id, name: block.name, input: block.input });
    }
    const message: AgentMessage = { role: "assistant", parts, native: response.content };
    const stopReason = response.stop_reason === "tool_use" ? "tool_use" : response.stop_reason === "max_tokens" ? "max_tokens" : response.stop_reason === "refusal" ? "refusal" : "end";
    return { message, stopReason, usage: { provider: this.name, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
  }
}

function partToBlock(p: AgentPart): Anthropic.Beta.BetaContentBlockParam {
  switch (p.type) {
    case "text":
      return { type: "text", text: p.text };
    case "tool_call":
      return { type: "tool_use", id: p.id, name: p.name, input: p.input as Record<string, unknown> };
    case "tool_result":
      return { type: "tool_result", tool_use_id: p.toolCallId, content: p.content, is_error: p.isError ?? false };
  }
}
