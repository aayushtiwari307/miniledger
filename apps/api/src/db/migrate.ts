import dotenv from "dotenv";
import path from "node:path";
import { Pool } from "pg";
import { applyMigrations } from "./migrationRunner";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy the repository-root .env.example to .env.");
}

const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
const migrationsDirectory = path.resolve(__dirname, "../../migrations");

async function main(): Promise<void> {
  try {
    const applied = await applyMigrations(pool, migrationsDirectory);
    if (applied.length === 0) {
      console.log("[MiniLedger DB] Migrations are up to date.");
    } else {
      for (const name of applied) console.log(`[MiniLedger DB] Applied ${name}`);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error("[MiniLedger DB] Migration failed.", error);
  process.exitCode = 1;
});
