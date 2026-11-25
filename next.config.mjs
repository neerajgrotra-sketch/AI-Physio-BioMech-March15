import { readFileSync } from "node:fs";

// The app version shown in the admin header, on the session screen and in
// every saved debug log: package.json's version plus the git commit Vercel
// built (VERCEL_GIT_COMMIT_SHA), so a tester can see which build is loaded.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7);
const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_APP_COMMIT: commit,
    NEXT_PUBLIC_APP_BRANCH: branch,
    NEXT_PUBLIC_APP_BUILT_AT: new Date().toISOString(),
  },
}
export default nextConfig
