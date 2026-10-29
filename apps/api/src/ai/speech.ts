import { AiUnavailableError } from "./provider";

/**
 * Speech-to-text seam. The recommended production path (see
 * docs/research/04-mobile-health-voice.md) is server-side Whisper: either a
 * hosted transcription API or a self-hosted whisper.cpp server, which exposes
 * POST /inference (multipart "file") and returns {"text": "..."}.
 */
export interface SpeechToText {
  readonly available: boolean;
  transcribe(audio: Buffer, mimeType: string, language?: string): Promise<{ text: string }>;
}

export class DisabledSpeechToText implements SpeechToText {
  readonly available = false;
  async transcribe(): Promise<never> {
    throw new AiUnavailableError("Voice transcription is not configured on this server");
  }
}

export class WhisperCppSpeechToText implements SpeechToText {
  readonly available = true;
  constructor(private readonly baseUrl: string) {}

  async transcribe(audio: Buffer, mimeType: string, language = "auto"): Promise<{ text: string }> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), "audio");
    form.append("response_format", "json");
    form.append("language", language);
    const res = await fetch(new URL("/inference", this.baseUrl), { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Transcription failed with status ${res.status}`);
    const body = (await res.json()) as { text?: unknown };
    if (typeof body.text !== "string") throw new Error("Transcription server returned no text");
    return { text: body.text.trim() };
  }
}

export class FakeSpeechToText implements SpeechToText {
  readonly available = true;
  constructor(private readonly text: string) {}
  async transcribe(): Promise<{ text: string }> {
    return { text: this.text };
  }
}
