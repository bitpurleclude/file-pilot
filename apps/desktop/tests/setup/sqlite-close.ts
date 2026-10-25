import { afterAll, afterEach } from "vitest";

import { closeAllSqliteDatabases } from "../../infra/storage/sqlite/db.js";

// Windows keeps WAL files locked while a better-sqlite3 handle is open, which
// breaks temp-directory cleanup between tests. Close every cached connection
// after each test so `rm` in afterEach hooks never races an open handle.
afterEach(() => {
  closeAllSqliteDatabases();
});

afterAll(() => {
  closeAllSqliteDatabases();
});
