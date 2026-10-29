export type PoseStatus = "loading" | "ready" | "stopped" | "error";

/** One frame from the pose page: ms since start, 33 landmarks as [x, y, z, visibility], or null when no person was found. */
export interface PoseFrame {
  t: number;
  lm: [number, number, number, number][] | null;
}

export interface PoseCameraHandle {
  start(): void;
  stop(): void;
}

export interface PoseCameraProps {
  facing: "user" | "environment";
  onStatus: (status: PoseStatus, message?: string) => void;
  onFrames: (frames: PoseFrame[]) => void;
}

export function parsePoseMessage(raw: unknown, props: Pick<PoseCameraProps, "onStatus" | "onFrames">): void {
  let m: unknown = raw;
  if (typeof raw === "string") {
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
  }
  if (!m || typeof m !== "object") return;
  const msg = m as { type?: string; status?: PoseStatus; message?: string; frames?: PoseFrame[] };
  if (msg.type === "status" && msg.status) props.onStatus(msg.status, msg.message);
  if (msg.type === "frames" && Array.isArray(msg.frames)) props.onFrames(msg.frames);
}
