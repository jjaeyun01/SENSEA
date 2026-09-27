import * as SQLite from "expo-sqlite";

let enabled = true;
let failed = false;
let database: Promise<SQLite.SQLiteDatabase> | undefined;
let writes = Promise.resolve();
async function db() {
  if (!database) database = (async () => {
    const value = await SQLite.openDatabaseAsync("sensea-events.db");
    await value.execAsync(`
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL);
    `);
    const preference = await value.getFirstAsync<{ enabled: number }>("SELECT enabled FROM settings WHERE id = 1");
    enabled = preference?.enabled !== 0;
    await value.runAsync("DELETE FROM events WHERE at < ?", Date.now() - 7 * 86400000);
    return value;
  })();
  return database;
}
export function recordEvent(kind: string, detail = "") {
  const at = Date.now();
  writes = writes.then(async () => {
    const value = await db();
    if (!enabled) return;
    await value.runAsync("INSERT INTO events(at, kind, detail) VALUES (?, ?, ?)", at, kind, detail.slice(0, 300));
    await value.runAsync("DELETE FROM events WHERE at < ? OR id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 2000)", Date.now() - 7 * 86400000);
    failed = false;
  }).catch(() => { failed = true; });
}
export async function getRecording() { await db(); return enabled; }
export async function setRecording(value: boolean) {
  await writes;
  const database = await db();
  enabled = value;
  await database.runAsync("INSERT OR REPLACE INTO settings(id, enabled) VALUES (1, ?)", value ? 1 : 0);
}
export async function clearEvents() { await writes; await (await db()).execAsync("DELETE FROM events"); }
export async function eventStatus() {
  await writes;
  if (failed) return "Interaction recording is unavailable.";
  const value = await db();
  await value.runAsync("DELETE FROM events WHERE at < ?", Date.now() - 7 * 86400000);
  const result = await value.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM events");
  return `${result?.count ?? 0} events stored on this device. Records older than seven days are removed when the app is used.`;
}
