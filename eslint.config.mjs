import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  // .vercel/output holds the compiled deployment produced by `vercel build`.
  globalIgnores([".next/**", ".vercel/**", "coverage/**", "next-env.d.ts"]),
]);
