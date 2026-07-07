import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = './migrations';
const SCHEMA_FILE = './src/db/schema.sql';

interface SchemaObject {
  type: string;
  name: string;
  sql: string;
}

// Pull every DDL object from a SQLite DB, whitespace-normalized so we compare
// structure (tables/indexes and their definitions), not incidental formatting.
function dumpSchema(db: Database.Database): SchemaObject[] {
  const rows = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name"
    )
    .all() as SchemaObject[];
  return rows.map((r) => ({
    type: r.type,
    name: r.name,
    sql: r.sql.replace(/\s+/g, ' ').trim(),
  }));
}

describe('D1 migrations vs schema.sql parity', () => {
  it('applying all migrations to an empty DB yields the same schema as schema.sql', () => {
    // DB-A: apply every migration file in order.
    const dbA = new Database(':memory:');
    const migrationFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(migrationFiles.length).toBeGreaterThan(0);
    for (const file of migrationFiles) {
      dbA.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    }

    // DB-B: apply the canonical full schema.
    const dbB = new Database(':memory:');
    dbB.exec(readFileSync(SCHEMA_FILE, 'utf-8'));

    const schemaA = dumpSchema(dbA);
    const schemaB = dumpSchema(dbB);
    dbA.close();
    dbB.close();

    // Deep-equals: any divergence (a migration added but schema.sql not updated,
    // or vice-versa) fails this test.
    expect(schemaA).toEqual(schemaB);
  });
});
