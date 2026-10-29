import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeSpeechToText, WhisperCppSpeechToText } from "../src/ai/speech";
import { upsertSharedFood } from "../src/foods/repository";
import { mapFdcFood } from "../src/foods/sources";
import { makeTestApp, onboard, registerUser, type TestApp } from "./helpers";

const egg = mapFdcFood({ fdcId: 171287, description: "Egg, whole, cooked, hard-boiled", dataType: "SR Legacy", foodNutrients: [{ nutrientNumber: "208", value: 155 }, { nutrientNumber: "203", value: 12.6 }, { nutrientNumber: "205", value: 1.1 }, { nutrientNumber: "204", value: 10.6 }], foodPortions: [{ gramWeight: 50, amount: 1, modifier: "large egg" }] })!;

function audioForm(mime = "audio/m4a") {
  const boundary = "----stoke-voice";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="clip"\r\nContent-Type: ${mime}\r\n\r\n`);
  return { payload: Buffer.concat([head, Buffer.from([0, 1, 2, 3, 4, 5]), Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

let t: TestApp;
let off: TestApp;
let eggId: string;
beforeAll(async () => {
  t = await makeTestApp({ stt: new FakeSpeechToText("two eggs for breakfast") });
  off = await makeTestApp();
  eggId = await upsertSharedFood(t.db.system, egg, new Date());
});
afterAll(async () => {
  await t.close();
  await off.close();
});

async function user(app: TestApp) {
  const u = await registerUser(app.app);
  await onboard(app.app, u.headers);
  return u;
}

describe("voice logging", () => {
  it("transcribes, then hands the text to the deterministic parser without logging anything", async () => {
    const u = await user(t);
    const form = audioForm();
    const res = await t.app.inject({ method: "POST", url: "/v1/voice/transcribe", headers: { ...u.headers, ...form.headers }, payload: form.payload });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.text).toBe("two eggs for breakfast");
    expect(body.draft).toMatchObject({ meal: "breakfast", requiresConfirmation: true });
    expect(body.draft.items[0].suggestion.food.id).toBe(eggId);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
    const diary = await t.app.inject({ method: "GET", url: `/v1/diary/${day}`, headers: u.headers });
    expect(diary.statusCode).toBe(200);
    expect(diary.json().entries).toEqual([]);
  });

  it("rejects non-audio uploads", async () => {
    const u = await user(t);
    const form = audioForm("image/jpeg");
    expect((await t.app.inject({ method: "POST", url: "/v1/voice/transcribe", headers: { ...u.headers, ...form.headers }, payload: form.payload })).statusCode).toBe(400);
  });

  it("says clearly when transcription is not configured", async () => {
    const u = await user(off);
    const form = audioForm();
    const res = await off.app.inject({ method: "POST", url: "/v1/voice/transcribe", headers: { ...u.headers, ...form.headers }, payload: form.payload });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("stt_unavailable");
  });
});

describe("whisper.cpp client", () => {
  it("posts multipart audio to /inference and returns the trimmed text", async () => {
    let seen: { path?: string; type?: string; body?: string } = {};
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen = { path: req.url, type: req.headers["content-type"], body: Buffer.concat(chunks).toString("latin1") };
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ text: "  200 grams of rice \n" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const stt = new WhisperCppSpeechToText(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      expect(await stt.transcribe(Buffer.from("RIFF"), "audio/wav", "en")).toEqual({ text: "200 grams of rice" });
      expect(seen.path).toBe("/inference");
      expect(seen.type).toMatch(/^multipart\/form-data/);
      expect(seen.body).toContain('name="file"');
      expect(seen.body).toContain('name="language"');
    } finally {
      server.close();
    }
  });
});
