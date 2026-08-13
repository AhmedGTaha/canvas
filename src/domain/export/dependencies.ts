/**
 * Dependency versions written into an exported project's package.json. These are kept
 * in step with the Canvas runtime (see `dependencies.test.ts`) so exported sites build
 * against the same Next.js/React/TypeScript versions Canvas generates code for.
 */
export const EXPORT_DEPENDENCIES = {
  dependencies: {
    next: "16.3.0",
    react: "19.2.8",
    "react-dom": "19.2.8",
  },
  devDependencies: {
    "@types/node": "22.19.1",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    typescript: "5.9.3",
  },
} as const;
