import { useCameraPermissions } from "expo-camera";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

// The library defaults its extra-props parameter to `undefined`, which makes every prop `never` under strict mode.
const PoseWebView = WebView<object>;
import { useTheme } from "../../theme/theme";
import { Button, Stack, T } from "../../ui/primitives";
import { poseHtml } from "./poseHtml";
import { parsePoseMessage, type PoseCameraHandle, type PoseCameraProps } from "./types";

/**
 * iOS / Android: the pose page runs in a WebView. The app asks for camera
 * permission first; the WebView is then allowed to use the camera without a
 * second prompt. Requires a development build (react-native-webview).
 */
export const PoseCamera = forwardRef<PoseCameraHandle, PoseCameraProps>(function PoseCamera(props, ref) {
  const th = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const web = useRef<InstanceType<typeof PoseWebView>>(null);
  const html = useMemo(() => poseHtml({ facing: props.facing, accent: th.c.accent }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const send = (m: object) => web.current?.injectJavaScript(`window.__cmd && window.__cmd(${JSON.stringify(JSON.stringify(m))}); true;`);
  useImperativeHandle(ref, () => ({ start: () => send({ type: "start" }), stop: () => send({ type: "stop" }) }));
  useEffect(() => send({ type: "facing", facing: props.facing }), [props.facing]);

  if (!permission) return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: th.c.bg }}>
        <Stack gap={12} style={{ alignItems: "center" }}>
          <T variant="headline" align="center">Camera access is needed to track your movement</T>
          <T variant="footnote" color="textSecondary" align="center">Video is analysed on this phone and never uploaded.</T>
          <Button title="Allow camera" onPress={() => void requestPermission()} />
        </Stack>
      </View>
    );
  }
  return (
    <PoseWebView
      ref={web}
      source={{ html, baseUrl: "https://localhost/" }}
      originWhitelist={["*"]}
      javaScriptEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      mediaCapturePermissionGrantType="grant"
      onMessage={(e: WebViewMessageEvent) => parsePoseMessage(e.nativeEvent.data, props)}
      style={{ flex: 1, backgroundColor: "#000" }}
    />
  );
});
