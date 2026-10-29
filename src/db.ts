/**
 * PostgreSQL schema — every table is prefixed `sd_` because the database is the
 * shared Coolify Postgres instance used by other apps too.
 */
import postgres from "postgres"
import { TEAMS } from "./data"

export const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres", {
  max: Number(process.env.PG_MAX ?? 10),
  onnotice: () => {},
})

/** The pool or a transaction — both run queries. */
export type Q = postgres.Sql | postgres.TransactionSql

export type Settings = {
  open: boolean
  /** "all" = a jersey number is used once in the whole company, "team" = once per colour. */
  scope: "all" | "team"
}
export const DEFAULT_SETTINGS: Settings = { open: true, scope: "all" }

export async function initDB(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS sd_entries (
      id         SERIAL PRIMARY KEY,
      emp_code   TEXT NOT NULL,
      full_name  TEXT NOT NULL,
      team       TEXT NOT NULL,
      nickname   TEXT NOT NULL,
      jersey_no  TEXT NOT NULL CHECK (jersey_no ~ '^[0-9]{2}$'),
      size       TEXT NOT NULL,
      extra      JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  // Hash of the private edit key the submitting browser keeps (edit, never a second form).
  await sql`ALTER TABLE sd_entries ADD COLUMN IF NOT EXISTS edit_hash TEXT`
  // One form per employee.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS sd_entries_emp ON sd_entries (upper(emp_code))`
  await sql`CREATE INDEX IF NOT EXISTS sd_entries_no ON sd_entries (jersey_no)`
  await sql`
    CREATE TABLE IF NOT EXISTS sd_settings (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )`
  await sql`INSERT INTO sd_settings (key, value) VALUES ('main', ${sql.json(DEFAULT_SETTINGS)}) ON CONFLICT (key) DO NOTHING`
  // The draw list: who is in which colour (from Smile's Excel).
  await sql`
    CREATE TABLE IF NOT EXISTS sd_members (
      id         SERIAL PRIMARY KEY,
      emp_code   TEXT NOT NULL UNIQUE,
      title      TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL,
      last_name  TEXT NOT NULL DEFAULT '',
      nickname   TEXT NOT NULL DEFAULT '',
      branch     TEXT NOT NULL DEFAULT '',
      team       TEXT NOT NULL,
      sort       INT NOT NULL DEFAULT 0
    )`
  // Allowed colours follow TEAMS (a 4th, Host, was added later) — rebuilt on every start.
  const teamList = TEAMS.map((t) => `'${t.id}'`).join(", ")
  for (const table of ["sd_entries", "sd_members"]) {
    await sql.unsafe(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_team_check`)
    await sql.unsafe(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_team_check CHECK (team IN (${teamList}))`)
  }
  await sql`
    CREATE TABLE IF NOT EXISTS sd_sessions (
      token      TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL
    )`
  await sql`DELETE FROM sd_sessions WHERE expires_at < NOW()`
}

export async function getSettings(tx: Q = sql): Promise<Settings> {
  const [r] = await tx`SELECT value FROM sd_settings WHERE key = 'main'`
  // Numbers are unique across every colour, always (Smile, 29 Oct 2026): a stored "team" scope is ignored.
  return { ...DEFAULT_SETTINGS, ...(r?.value ?? {}), scope: "all" }
}
