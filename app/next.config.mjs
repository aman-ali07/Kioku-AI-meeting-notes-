import path from "node:path";
import url from "node:url";

// @type {import('next').NextConfig}
const appRoot = path.dirname(url.fileURLToPath(import.meta.url));

const nextConfig = {
  // A stray /home/aman/package-lock.json makes Next guess the wrong workspace
  // root — pin it so file tracing and ESLint/TS resolution stay repo-local.
  outputFileTracingRoot: appRoot,
  // standalone output arrives with the Day-7 self-host container work
};

export default nextConfig;
