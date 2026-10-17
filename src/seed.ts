import { AppDatabase } from './db/database.js';
import { createBetterSqliteDriver } from './db/better-sqlite-driver.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const database = new AppDatabase(config.databasePath, createBetterSqliteDriver);
try {
  database.seedDemoData();
  console.log(`Seeded demo accounts, principals, permissions, and tokens in ${config.databasePath}`);
} finally {
  database.close();
}
