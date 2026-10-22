import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

const MIGRATION_FILENAME_PATTERN = /^\d+_[a-z0-9_]+\.sql$/i;

export async function applyMigrations(database: Pool, migrationsDirectory: string): Promise<string[]> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && MIGRATION_FILENAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const appliedNow: string[] = [];
  for (const filename of filenames) {
    const alreadyApplied = await database.query(
      "SELECT 1 FROM schema_migrations WHERE name = $1",
      [filename],
    );
    if (alreadyApplied.rowCount) continue;

    const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      // Check again after taking a transaction so sequential reruns stay idempotent.
      const recorded = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1 FOR UPDATE",
        [filename],
      );
      if (!recorded.rowCount) {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [filename]);
        appliedNow.push(filename);
      }
      await client.query("COMMIT");
    } catch (error: unknown) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Keep the migration error as the primary failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  return appliedNow;
}
