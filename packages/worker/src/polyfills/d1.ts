import Database from 'better-sqlite3';

export class D1PreparedStatementWrapper {
  private db: Database.Database;
  private query: string;
  private params: unknown[];

  constructor(db: Database.Database, query: string, params: unknown[] = []) {
    this.db = db;
    this.query = query;
    this.params = params;
  }

  bind(...values: unknown[]) {
    return new D1PreparedStatementWrapper(this.db, this.query, values);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const stmt = this.db.prepare(this.query);
          const result = stmt.get(...this.params) as T | undefined;
          resolve(result || null);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const stmt = this.db.prepare(this.query);
          const results = stmt.all(...this.params) as T[];
          resolve({ results });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async run(): Promise<{
    success: boolean;
    meta: { changes: number; last_row_id: number; duration: number };
  }> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const stmt = this.db.prepare(this.query);
          const info = stmt.run(...this.params);
          resolve({
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: info.lastInsertRowid as number,
              duration: 0,
            },
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}

export class D1DatabaseWrapper {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  prepare(query: string) {
    return new D1PreparedStatementWrapper(this.db, query);
  }

  exec(query: string) {
    this.db.exec(query);
  }
}
