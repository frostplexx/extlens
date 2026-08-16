/**
 * Minimal ambient types for better-sqlite3 (the package ships no bundled
 * types). Covers exactly the API surface FolderBackend uses.
 */
declare module "better-sqlite3" {
  namespace Database {
    interface RunResult {
      changes: number;
      lastInsertRowid: number | bigint;
    }

    interface Statement {
      run(...params: unknown[]): RunResult;
      get(...params: unknown[]): Record<string, unknown> | undefined;
      all(...params: unknown[]): Record<string, unknown>[];
    }

    interface Database {
      exec(sql: string): void;
      prepare(sql: string): Statement;
      close(): void;
    }
  }

  interface DatabaseConstructor {
    new (filename: string | Buffer): Database.Database;
  }

  const Database: DatabaseConstructor;
  export = Database;
}
