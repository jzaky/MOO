import { createElement, forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { View } from "react-native";
import { useTheme } from "../../theme/theme";
import { t } from "../../i18n";
import { poseHtml } from "./poseHtml";
import { parsePoseMessage, type PoseCameraHandle, type PoseCameraProps } from "./types";

/** Web: the pose page runs in an iframe (same page as the native WebView). */
export const PoseCamera = forwardRef<PoseCameraHandle, PoseCameraProps>(function PoseCamera(props, ref) {
  const th = useTheme();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const html = useMemo(() => poseHtml({ facing: props.facing, accent: th.c.accent, messages: { loading: t("Loading pose model"), modelError: t("Couldn't load the pose model. Check your connection and try again."), cameraError: t("Camera unavailable. Allow camera access in settings."), switchError: t("Couldn't switch camera.") } }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useRef(props);
  latest.current = props;
  const send = (m: object) => frame.current?.contentWindow?.postMessage(JSON.stringify(m), "*");
  useImperativeHandle(ref, () => ({ start: () => send({ type: "start" }), stop: () => send({ type: "stop" }) }));
  useEffect(() => send({ type: "facing", facing: props.facing }), [props.facing]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      parsePoseMessage(e.data, latest.current);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {createElement("iframe", { ref: frame, srcDoc: html, allow: "camera", title: t("Pose tracking camera"), style: { border: 0, width: "100%", height: "100%" } })}
    </View>
  );
});
