/**
 * Apple Watch companion app (watchOS), generated into the Xcode project by
 * @bacons/apple-targets on `npx expo prebuild`. Sources in this folder are
 * linked into the "StokeWatch" target; they are not compiled on Linux/CI.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: "watch",
  name: "StokeWatch",
  displayName: "Stoke",
  // <app bundle id>.watchkitapp (the conventional companion watch app id).
  bundleIdentifier: ".watchkitapp",
  deploymentTarget: "10.0",
  icon: "../../assets/images/icon.png",
  colors: { $accent: "#7CF0B4" },
  frameworks: ["WatchConnectivity"],
  // Same App Group as the iPhone app and its widget extension. Note: an App Group
  // container is per device, so it does not move data between iPhone and Watch;
  // the live workout travels over WatchConnectivity (see WorkoutSession.swift).
  entitlements: {
    "com.apple.security.application-groups": config.ios?.entitlements?.["com.apple.security.application-groups"] ?? [`group.${config.ios?.bundleIdentifier}`],
  },
});
