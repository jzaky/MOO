import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The widget / Live Activity components are compiled by babel-preset-expo's
 * `'widget'` directive into source strings that run in an isolated runtime
 * where only Expo UI components, modifiers and JS built-ins exist. This test
 * compiles each file exactly as Metro does for iOS and evaluates the layout in
 * a sandbox that throws on any other free identifier, so a reference to a
 * module-level constant or helper (which would crash on device) fails here.
 * It does not render SwiftUI; it only proves the JS side of the layouts.
 */

const require = createRequire(import.meta.url);
const expoDir = path.dirname(require.resolve("expo/package.json"));
const presetPath = require.resolve("babel-preset-expo", { paths: [expoDir] });
const babel = require(require.resolve("@babel/core", { paths: [path.dirname(presetPath)] })) as {
  transformFileSync(file: string, opts: object): { code: string };
};
const appRoot = path.resolve(__dirname, "..");

const ALLOWED_BUILTINS = new Set(["Math", "String", "Number", "Date", "JSON", "Array", "Object", "Boolean", "undefined", "NaN", "Infinity", "isFinite"]);

type Node = { type: string; props: Record<string, unknown> };

/** Names a widget file imports from Expo UI: the only non-built-in globals of the widget runtime it may use. */
function expoUiImports(filename: string): Set<string> {
  const source = readFileSync(filename, "utf8");
  const names = new Set<string>();
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@expo\/ui\/swift-ui(?:\/modifiers)?"/g)) {
    for (const part of m[1]!.split(",")) {
      const name = part.replace(/\btype\b/, "").trim();
      if (name) names.add(name);
    }
  }
  return names;
}

function compileLayouts(file: string): Record<string, { layout: string; ui: Set<string> }> {
  const filename = path.join(appRoot, file);
  const ui = expoUiImports(filename);
  const { code } = babel.transformFileSync(filename, {
    cwd: appRoot,
    babelrc: false,
    configFile: false,
    filename,
    presets: [[presetPath, {}]],
    caller: { name: "metro", bundler: "metro", platform: "ios", isDev: false, isServer: false },
  });
  const layouts: Record<string, { layout: string; ui: Set<string> }> = {};
  const capture = (name: string, layout: unknown) => {
    if (typeof layout !== "string") throw new Error(`${name} was not compiled to a widget layout string`);
    layouts[name] = { layout, ui };
    return {};
  };
  const mod = { exports: {} };
  const fakeRequire = (id: string) => (id === "expo-widgets" ? { createWidget: capture, createLiveActivity: capture } : new Proxy({}, { get: () => () => ({}) }));
  new Function("require", "module", "exports", code)(fakeRequire, mod, mod.exports);
  return layouts;
}

/** Evaluates a layout with stand-ins for the imported Expo UI names; any other free identifier throws a ReferenceError. */
function evaluate({ layout, ui }: { layout: string; ui: Set<string> }, props: object, env: object): unknown {
  const element = (type: unknown, p: Record<string, unknown>): Node => ({ type: String((type as { uiName?: string })?.uiName ?? type), props: p ?? {} });
  const scope = new Proxy({} as Record<string, unknown>, {
    has: (_t, key) => typeof key === "string" && !ALLOWED_BUILTINS.has(key),
    get: (_t, key) => {
      if (key === Symbol.unscopables) return undefined;
      if (key === "_jsx" || key === "_jsxs" || key === "jsx" || key === "jsxs") return element;
      if (typeof key !== "string" || !ui.has(key)) throw new ReferenceError(`${String(key)} is not defined in the widget runtime`);
      // Expo UI components (PascalCase) and modifiers (camelCase) exist as globals in the widget runtime.
      return Object.assign((...args: unknown[]) => ({ modifier: key, args }), { uiName: key });
    },
  });
  // eslint-disable-next-line no-new-func -- sandboxed evaluation of the compiled layout string
  const fn = new Function("scope", `with (scope) { return (${layout}); }`)(scope) as (p: object, e: object) => unknown;
  return fn(JSON.parse(JSON.stringify(props)), env);
}

const texts = (n: unknown): string[] => {
  if (Array.isArray(n)) return n.flatMap(texts);
  if (!n || typeof n !== "object") return typeof n === "string" ? [n] : [];
  const o = n as Node;
  if (!("type" in o)) return Object.values(o).flatMap(texts);
  return [...texts(o.props.children), ...texts(o.props.currentValueLabel)];
};

describe("widget layouts compile for the isolated widget runtime", () => {
  it("the sandbox rejects references to anything outside the layout", () => {
    const ui = new Set(["Text"]);
    expect(() => evaluate({ layout: "function(p){return _jsx(Text,{children:String(p.n)})}", ui }, { n: 1 }, {})).not.toThrow();
    // A module-level constant or helper is not part of the serialized function.
    expect(() => evaluate({ layout: "function(p){return _jsx(Text,{children:LABELS[p.k]})}", ui }, { k: "a" }, {})).toThrow(ReferenceError);
    expect(() => evaluate({ layout: "function(p){return _jsx(Text,{children:_helpers.label(p)})}", ui }, {}, {})).toThrow(ReferenceError);
  });

  it("Calories left renders every supported family", () => {
    const { CaloriesLeft } = compileLayouts("src/features/native/widgets/CaloriesLeftWidget.tsx");
    for (const widgetFamily of ["systemSmall", "systemMedium", "accessoryCircular"]) {
      const tree = evaluate(CaloriesLeft!, { kcalLeft: 850, kcalTarget: 2300, proteinLeftG: 68, progress: 0.6, stale: false }, { widgetFamily });
      expect(texts(tree)).toContain("850");
    }
    expect(texts(evaluate(CaloriesLeft!, { kcalLeft: -120, kcalTarget: 2000, proteinLeftG: 0, progress: 1, stale: false }, { widgetFamily: "systemSmall" }))).toContain("kcal over");
    expect(texts(evaluate(CaloriesLeft!, { kcalLeft: null, kcalTarget: null, proteinLeftG: null, progress: 0, stale: true }, { widgetFamily: "systemSmall" }))).toContain("Open Stoke");
  });

  it("Next workout renders every supported family", () => {
    const { NextWorkout } = compileLayouts("src/features/native/widgets/NextWorkoutWidget.tsx");
    expect(texts(evaluate(NextWorkout!, { name: "Lower A", label: "Today", inProgress: false }, { widgetFamily: "systemSmall" }))).toEqual(expect.arrayContaining(["Today", "Lower A", "Tap to start"]));
    expect(texts(evaluate(NextWorkout!, { name: null, label: "No plan yet", inProgress: false }, { widgetFamily: "accessoryRectangular" }))).toContain("Plan a workout");
  });

  it("the rest Live Activity returns every Lock Screen and Dynamic Island region", () => {
    const { RestTimer } = compileLayouts("src/features/native/widgets/RestActivity.tsx");
    const now = Date.now();
    const props = { startedAt: now, endsAt: now + 90_000, exerciseName: "Bench Press", setLabel: "Next: Set 2 of 3" };
    const live = evaluate(RestTimer!, props, { colorScheme: "dark", isStale: false }) as Record<string, unknown>;
    expect(Object.keys(live).sort()).toEqual(["banner", "compactLeading", "compactTrailing", "expandedBottom", "expandedLeading", "expandedTrailing", "minimal"]);
    expect(texts(live.banner)).toEqual(expect.arrayContaining(["Bench Press", "Next: Set 2 of 3"]));
    // The countdown is a system timer text bound to [startedAt, endsAt], not a static string.
    const timer = (live.compactTrailing as Node).props;
    expect(timer.timerInterval).toEqual({ lower: new Date(now), upper: new Date(now + 90_000) });
    expect(timer.countsDown).toBe(true);
    const stale = evaluate(RestTimer!, props, { colorScheme: "dark", isStale: true }) as Record<string, unknown>;
    expect(texts(stale.expandedTrailing)).toEqual(["Rest done"]);
  });
});
