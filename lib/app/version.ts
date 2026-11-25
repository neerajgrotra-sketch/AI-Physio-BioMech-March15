// The build the browser is running (set in next.config.mjs at build time).
// Shown in the admin header and on the session screen, and saved with every
// debug log, so a test run can be matched to the code that produced it.
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
export const APP_COMMIT = process.env.NEXT_PUBLIC_APP_COMMIT ?? "local";
export const APP_BRANCH = process.env.NEXT_PUBLIC_APP_BRANCH ?? "";
export const APP_BUILT_AT = process.env.NEXT_PUBLIC_APP_BUILT_AT ?? "";

/** "v0.2.0 · 2622702", plus the branch when it is not main (a test build). */
export function versionLabel(): string {
  const b = APP_BRANCH && APP_BRANCH !== "main" ? ` · ${APP_BRANCH}` : "";
  return `v${APP_VERSION} · ${APP_COMMIT}${b}`;
}
