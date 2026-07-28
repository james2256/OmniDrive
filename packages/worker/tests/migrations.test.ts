import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TABLES } from './integration/helpers';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const SCHEMA_FILE = join(__dirname, '..', 'src', 'db', 'schema.sql');

interface SchemaObject {
  type: string;
  name: string;
  sql: string;
}

// Pull every DDL object from a SQLite DB, whitespace-normalized so we compare
// structure (tables/indexes and their definitions), not incidental formatting.
// Also normalizes quoted identifiers — ALTER TABLE ... RENAME TO wraps the
// table name in double quotes in sqlite_master, which would cause a false
// mismatch vs schema.sql's unquoted CREATE TABLE.
//
// The .replace(/\s+,/g, ',') step handles ALTER TABLE ADD COLUMN's whitespace
// quirk: SQLite appends the new column with a leading space before the comma
// (") ," instead of ","), which would cause a false mismatch vs schema.sql's
// clean formatting. This lets migrations use safe ALTER TABLE instead of
// destructive table recreation (DROP TABLE on a table with inbound CASCADE FKs
// would cascade-delete dependent data).
function dumpSchema(db: Database.Database): SchemaObject[] {
  const rows = db
    .prepare('SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name')
    .all() as SchemaObject[];
  return rows.map((r) => ({
    type: r.type,
    name: r.name,
    sql: r.sql
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/"/g, '')
      .replace(/\s+([,)])/g, '$1'),
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

describe('Integration helpers.ts vs schema.sql parity', () => {
  it('helpers.ts creates all the same tables as schema.sql', () => {
    // Compare table names only (not full DDL or columns — helpers.ts intentionally
    // has simplified definitions without FKs/CHECKs, and some columns may differ).
    // This catches the original bug: missing tables in helpers.ts that exist in
    // schema.sql (e.g., automation_logs, quota_cache, s3_lifecycle_rules were
    // missing before this test was added). A column-level comparison would be
    // stronger but requires syncing all column definitions first — deferred.
    const dbA = new Database(':memory:');
    for (const sql of TABLES) {
      dbA.exec(sql);
    }

    const dbB = new Database(':memory:');
    dbB.exec(readFileSync(SCHEMA_FILE, 'utf-8'));

    const tablesA = dbA
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    const tablesB = dbB
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    dbA.close();
    dbB.close();

    const namesA = tablesA.map((t) => t.name);
    const namesB = tablesB.map((t) => t.name);
    expect(namesA).toEqual(namesB);
  });
});
