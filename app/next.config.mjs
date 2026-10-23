import path from "node:path";
import url from "node:url";

// @type {import('next').NextConfig}
const appRoot = path.dirname(url.fileURLToPath(import.meta.url));

const nextConfig = {
  // A stray /home/aman/package-lock.json makes Next guess the wrong workspace
  // root — pin it to THIS repo (the pnpm workspace root) so file tracing and
  // ESLint/TS resolution stay repo-local. It must be the workspace root —
  // pinning it to app/ would put /repo/node_modules outside the traced root
  // and the standalone bundle ships without 'next' (proven in the container).
  outputFileTracingRoot: path.resolve(appRoot, ".."),
  // Self-host container ships the standalone server (docker/web.Dockerfile);
  // `pnpm dev` / `next start` are unaffected — dev keeps using the same flow.
  output: "standalone",
};

export default nextConfig;
