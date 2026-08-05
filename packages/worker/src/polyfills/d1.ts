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
    success: true;
    meta: { changes: number; last_row_id: number; duration: number };
    results: never[];
  }> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          resolve(this.runSync());
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /**
   * Synchronous execution — used only by D1DatabaseWrapper.batch() to keep
   * all statements inside a single atomic better-sqlite3 transaction.
   * The async run() wraps each call in setImmediate, which would yield between
   * statements and break transaction isolation (another request could execute
   * a query inside the open transaction).
   */
  runSync(): {
    success: true;
    meta: { changes: number; last_row_id: number; duration: number };
    results: never[];
  } {
    const stmt = this.db.prepare(this.query);
    const info = stmt.run(...this.params);
    return {
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: info.lastInsertRowid as number,
        duration: 0,
      },
      results: [],
    };
  }
}

export class D1DatabaseWrapper {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
  }

  prepare(query: string) {
    return new D1PreparedStatementWrapper(this.db, query);
  }

  exec(query: string) {
    this.db.exec(query);
  }

  /**
   * Execute prepared statements atomically in array order. Mirrors production
   * D1's batch() contract: single implicit transaction, all-or-nothing rollback.
   *
   * Uses db.transaction(fn) so the entire BEGIN...COMMIT runs synchronously within
   * one setImmediate tick — no event-loop yield mid-transaction that would let a
   * concurrent request interleave ops on the shared better-sqlite3 connection.
   * db.transaction() auto-rolls-back on any throw.
   *
   * Returns a minimal D1Result[]-compatible array. No caller reads the result
   * (verified: all call sites use `await db.batch(...)` as fire-and-await).
   */
  async batch<T = unknown>(
    statements: D1PreparedStatementWrapper[],
  ): Promise<
    Array<{
      success: true;
      meta: { changes: number; last_row_id: number; duration: number };
      results: T[];
    }>
  > {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          const tx = this.db.transaction(() =>
            statements.map(
              (stmt) =>
                stmt.runSync() as {
                  success: true;
                  meta: { changes: number; last_row_id: number; duration: number };
                  results: T[];
                },
            ),
          );
          resolve(tx());
        } catch (e) {
          reject(e);
        }
      });
    });
  }
}
