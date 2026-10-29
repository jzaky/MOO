/*
 * Compile-time check that every iOS variant exposes the same API as the
 * default (Android/web) module that TypeScript and other callers resolve.
 * Type-only: nothing imports this file at runtime.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type WidgetsParity = Assert<Same<typeof import("./widgets.ios"), typeof import("./widgets")>>;
export type LiveActivityParity = Assert<Same<typeof import("./liveActivity.ios"), typeof import("./liveActivity")>>;
export type WatchParity = Assert<Same<typeof import("./watch.ios"), typeof import("./watch")>>;
