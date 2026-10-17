import BetterSqlite3 from 'better-sqlite3';
import type { SqlDriverFactory } from './database.js';

/** Runtime adapter. Kept outside database.ts so unit tests can inject a test driver without loading native bindings. */
export const createBetterSqliteDriver: SqlDriverFactory = (path) => {
  const db = new BetterSqlite3(path);
  return {
    exec: (sql) => { db.exec(sql); },
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...params) => {
          const result = statement.run(...params);
          return { changes: result.changes };
        },
        get: (...params) => statement.get(...params),
      };
    },
    close: () => db.close(),
  };
};
