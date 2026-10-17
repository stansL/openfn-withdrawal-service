export type SqlParameter = string | number | bigint | null;

export interface SqlRunResult { changes: number }
export interface SqlStatement {
  run(...params: SqlParameter[]): SqlRunResult;
  get(...params: SqlParameter[]): unknown;
}
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}
export type SqlDriverFactory = (path: string) => SqlDatabase;
