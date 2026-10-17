import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase, SqlDriverFactory, SqlParameter } from '../../src/db/sql-driver.js';

export const createNodeSqliteTestDriver: SqlDriverFactory = (path) => {
  const db = new DatabaseSync(path);
  const adapter: SqlDatabase = {
    exec: (sql) => { db.exec(sql); },
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (...params: SqlParameter[]) => {
          const result = statement.run(...params);
          return { changes: Number(result.changes) };
        },
        get: (...params: SqlParameter[]) => statement.get(...params),
      };
    },
    close: () => db.close(),
  };
  return adapter;
};
