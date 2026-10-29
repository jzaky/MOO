import { dayKeyInZone } from "@stoke/core";
import { and, asc, eq, gte } from "drizzle-orm";
import type { AgentMessage, AgentPart } from "../ai/provider";
import { coachConversations, coachMessages, coachRecommendations } from "../db/schema";
import type { AppContext } from "../http/context";
import { HttpError } from "../http/errors";
import { getProfile, profileToDto } from "../routes/profile";
import { recordUsage } from "../routes/ai";
import { runTool, toolSpecs, type CoachSession } from "./tools";

export const COACH_SYSTEM = `You are the personal coach inside a fitness and nutrition app. You help one user with what to eat, what to train, how they are progressing and what to change.

Ground every statement in the user's data:
- Use the tools to look things up before answering questions about the user's intake, workouts, weight, recovery, goals or program. Never invent history, nutrient values, measurements or numbers. If a tool shows data is missing or insufficient, say so.
- All arithmetic (targets, trends, progression, nutrition totals) comes from tool results. Quote those numbers; do not compute new calorie or load prescriptions yourself.
- Be clear about what kind of statement you are making: observed (logged data), calculated (trends and averages from tools), estimated (photo or formula estimates), recommendation, or uncertainty. Short labels like "Logged:", "Trend:", "Estimate:" are enough.
- Correlation is not causation. Do not claim one thing caused another from a few weeks of data.

Changing things:
- You can only PROPOSE changes using the propose_* and run_adaptive_target_check tools. The user approves or rejects proposals in the app. Never say a change has been applied.
- Prefer small, conservative adjustments. Never suggest very low calorie intakes, rapid weight loss, or training through pain.

Health and safety:
- You are not a medical professional. For pain, injury, disordered eating, medical conditions, pregnancy or medication questions, give general information at most and suggest a qualified professional.
- Do not diagnose injuries or judge whether a movement is safe from data.

Style: warm, direct and brief. Lead with the answer, then the key numbers. Use the user's units. No guilt or shaming language.`;

export const MAX_STEPS = 8;
export const MAX_CONVERSATION_MESSAGES = 120;

type Row = typeof coachMessages.$inferSelect;

function rowToAgentMessage(r: Row): AgentMessage {
  return r.providerContent as AgentMessage;
}

export async function runCoachTurn(ctx: AppContext, userId: string, conversationId: string, text: string) {
  if (!ctx.ai.available) throw new HttpError(503, "ai_unavailable", "The AI coach is not configured on this server");
  const now = ctx.now();
  const { history, profile } = await ctx.db.asUser(userId, async (tx) => {
    const [c] = await tx.select().from(coachConversations).where(eq(coachConversations.id, conversationId));
    if (!c) throw new HttpError(404, "not_found", "Conversation not found");
    const rows = await tx.select().from(coachMessages).where(eq(coachMessages.conversationId, conversationId)).orderBy(asc(coachMessages.createdAt));
    return { history: rows, profile: profileToDto(await getProfile(tx, userId)) };
  });
  if (history.length >= MAX_CONVERSATION_MESSAGES) throw new HttpError(409, "conversation_full", "This conversation is long; start a new one to keep answers fast and focused.");

  const p = await ctx.db.asUser(userId, (tx) => getProfile(tx, userId));
  const today = dayKeyInZone(now, p.timeZone);
  const session: CoachSession = { db: ctx.db, userId, now, conversationId, healthDataAllowed: profile.aiConsent.coachUsesHealthData };
  const messages: AgentMessage[] = history.map(rowToAgentMessage);
  const turnStartedAt = new Date(now.getTime() - 1000);

  // Context travels in the user message (not the system prompt) so the cached prefix stays stable.
  const userMsg: AgentMessage = { role: "user", parts: [{ type: "text", text: `[Today: ${today}, time zone ${p.timeZone}, units ${p.unitSystem}]\n\n${text}` }] };
  const persist = async (m: AgentMessage, role: "user" | "assistant" | "tool", display: string, toolCalls: unknown = null, model: string | null = null) => {
    messages.push(m);
    await ctx.db.asUser(userId, async (tx) => {
      await tx.insert(coachMessages).values({ userId, conversationId, role, text: display, providerContent: m, toolCalls, model, createdAt: new Date() });
      await tx.update(coachConversations).set({ updatedAt: new Date(), ...(history.length === 0 && role === "user" ? { title: text.slice(0, 80) } : {}) }).where(eq(coachConversations.id, conversationId));
    });
  };
  await persist(userMsg, "user", text);

  const tools = toolSpecs();
  const calls: { name: string; isError: boolean }[] = [];
  let finalText = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await ctx.ai.agentStep({ purpose: "coach", system: COACH_SYSTEM, messages, tools, maxTokens: 8000 });
    await ctx.db.asUser(userId, (tx) => recordUsage(tx, userId, "coach", res.usage));
    const textOut = res.message.parts.filter((x): x is Extract<AgentPart, { type: "text" }> => x.type === "text").map((x) => x.text).join("\n").trim();
    const toolCallParts = res.message.parts.filter((x): x is Extract<AgentPart, { type: "tool_call" }> => x.type === "tool_call");
    await persist(res.message, "assistant", res.stopReason === "tool_use" ? "" : textOut, toolCallParts.length ? toolCallParts.map((c) => ({ name: c.name, input: c.input })) : null, res.usage.model);
    if (res.stopReason === "refusal") {
      finalText = "I can't help with that one. If it's about a medical issue, a qualified professional is the right person to ask.";
      break;
    }
    if (res.stopReason !== "tool_use" || !toolCallParts.length) {
      finalText = textOut || (res.stopReason === "max_tokens" ? "(The answer was cut off. Ask me to continue.)" : "");
      break;
    }
    // Run all tool calls, then return every result in one user message.
    const results = await Promise.all(toolCallParts.map(async (c) => ({ c, r: await runTool(session, c.name, c.input) })));
    for (const { c, r } of results) calls.push({ name: c.name, isError: r.isError });
    await persist({ role: "user", parts: results.map(({ c, r }) => ({ type: "tool_result", toolCallId: c.id, content: r.content, isError: r.isError })) }, "tool", "");
    if (step === MAX_STEPS - 1) finalText = "I looked up a lot of data but couldn't finish the answer. Try asking a narrower question.";
  }

  const created = await ctx.db.asUser(userId, (tx) =>
    tx.select().from(coachRecommendations).where(and(eq(coachRecommendations.userId, userId), eq(coachRecommendations.conversationId, conversationId), gte(coachRecommendations.createdAt, turnStartedAt))),
  );
  return {
    reply: finalText,
    toolCalls: calls,
    recommendations: created.map((r) => ({ id: r.id, kind: r.kind, title: r.title, rationale: r.rationale, status: r.status })),
  };
}
