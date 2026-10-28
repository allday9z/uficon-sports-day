/**
 * PostgreSQL schema — every table is prefixed `sd_` because the database is the
 * shared Coolify Postgres instance used by other apps too.
 */
import postgres from "postgres"

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
      team       TEXT NOT NULL CHECK (team IN ('blue', 'pink', 'green')),
      nickname   TEXT NOT NULL,
      jersey_no  TEXT NOT NULL CHECK (jersey_no ~ '^[0-9]{2}$'),
      size       TEXT NOT NULL,
      extra      JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  // One form per employee.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS sd_entries_emp ON sd_entries (upper(emp_code))`
  await sql`CREATE INDEX IF NOT EXISTS sd_entries_no ON sd_entries (jersey_no)`
  await sql`
    CREATE TABLE IF NOT EXISTS sd_settings (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )`
  await sql`INSERT INTO sd_settings (key, value) VALUES ('main', ${sql.json(DEFAULT_SETTINGS)}) ON CONFLICT (key) DO NOTHING`
  await sql`
    CREATE TABLE IF NOT EXISTS sd_sessions (
      token      TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL
    )`
  await sql`DELETE FROM sd_sessions WHERE expires_at < NOW()`
}

export async function getSettings(tx: Q = sql): Promise<Settings> {
  const [r] = await tx`SELECT value FROM sd_settings WHERE key = 'main'`
  return { ...DEFAULT_SETTINGS, ...(r?.value ?? {}) }
}
