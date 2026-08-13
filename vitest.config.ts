import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (!process.env.DATABASE_URL && env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
  return {
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      fileParallelism: false,
      coverage: { reporter: ["text", "html"] },
    },
  };
});
