import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalDatabase = globalThis as unknown as { canvasSql?: ReturnType<typeof postgres> };

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not configured.");
  return value;
}

export const sql = globalDatabase.canvasSql ?? postgres(databaseUrl(), { max: 10 });

if (process.env.NODE_ENV !== "production") globalDatabase.canvasSql = sql;

export const db = drizzle(sql, { schema });
export type Database = typeof db;
