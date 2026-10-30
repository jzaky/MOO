import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Wraps app.json for build-time switches.
 *
 * STOKE_NATIVE_EXTRAS=0 leaves out the parts that add extra iOS targets: the
 * home-screen widgets and rest Live Activity (expo-widgets extension), the
 * Apple Watch app (@bacons/apple-targets) and the Siri App Intents. Use it for
 * a first device build; the app works without them and the JS side does
 * nothing when they are absent. Default: included.
 *
 * EXPO_PUBLIC_API_URL sets the API the app talks to (also read at runtime).
 */
const EXTRA_PLUGINS = new Set(["expo-widgets", "@bacons/apple-targets", "./modules/stoke-intents/app.plugin.js"]);

const pluginName = (p: NonNullable<ExpoConfig["plugins"]>[number]) => (Array.isArray(p) ? p[0] : p);

export default ({ config }: ConfigContext): ExpoConfig => {
  const extras = process.env.STOKE_NATIVE_EXTRAS !== "0";
  const plugins = (config.plugins ?? []).filter((p) => extras || !EXTRA_PLUGINS.has(pluginName(p) as string));
  return {
    ...(config as ExpoConfig),
    plugins,
    extra: {
      ...config.extra,
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? config.extra?.apiUrl,
      ...(process.env.EAS_PROJECT_ID ? { eas: { ...config.extra?.eas, projectId: process.env.EAS_PROJECT_ID } } : {}),
    },
  };
};
