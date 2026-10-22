import dotenv from "dotenv";
import path from "node:path";
import { Pool } from "pg";
import { loadAuthConfig } from "./config/env";
import { createApp } from "./app";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy the repository-root .env.example to .env.");
}

const port = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("API_PORT must be an integer between 1 and 65535.");
}

// Fail fast before opening a network port when authentication secrets are misconfigured.
const authConfig = loadAuthConfig();
const host = process.env.API_HOST ?? "0.0.0.0";
const pool = new Pool({
  connectionString: databaseUrl,
  max: 10,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
});

// Idle PostgreSQL clients can emit errors after a restart or network interruption.
// Handle them so a transient connection issue does not crash the whole API process.
pool.on("error", (error: Error) => {
  console.error("[MiniLedger API] idle PostgreSQL client error", error.message);
});

const app = createApp(pool, authConfig);
const server = app.listen(port, host, () => {
  console.log(`[MiniLedger API] listening on http://${host}:${port}`);
  console.log(`[MiniLedger API] health endpoint: http://127.0.0.1:${port}/api/health`);
});

let isShuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[MiniLedger API] received ${signal}; shutting down`);

  server.close(async (error) => {
    if (error) {
      console.error("[MiniLedger API] HTTP server close failed", error);
      process.exitCode = 1;
    }
    await pool.end();
    process.exit();
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
