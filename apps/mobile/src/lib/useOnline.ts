import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

export function useOnlineManager(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}
