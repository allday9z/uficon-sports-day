/**
 * 👟 Sports Day UFicon 2026 — employees send their team colour, shirt nickname,
 * 2-digit jersey number and shirt size; the organiser (admin) sees the list,
 * the size totals per colour and exports Excel.
 *
 * Rules enforced here, never only in the form:
 *  - one form per employee code
 *  - a jersey number is used once (in the company, or per colour — admin setting);
 *    checked inside a transaction under an advisory lock so two people sending
 *    the same number at the same moment can't both get it
 */
import { Hono } from "hono"
import type { Context } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import ExcelJS from "exceljs"
import { timingSafeEqual, createHash } from "node:crypto"
import { sql, initDB, getSettings, type Q, type Settings } from "./db"
import { TEAMS, SIZES, NICK_MAX, cleanEntry, teamLabel, type Entry } from "./data"

const app = new Hono()
const PORT = Number(process.env.PORT ?? 3000)
const COOKIE = "sd_admin"
const SESSION_DAYS = 14
const SETUP_CODE = process.env.ADMIN_SETUP_CODE ?? ""
const LOCK = 7_402_026 // pg_advisory_xact_lock key for jersey numbers

const bad = (c: Context, error: string, status = 400, more: object = {}) => c.json({ error, ...more }, status as any)
const ip = (c: Context) => (c.req.header("x-forwarded-for") ?? "").split(",")[0]!.trim() || c.req.header("x-real-ip") || "local"

// ── small in-memory rate limit ────────────────────────────────────────────────
const hits = new Map<string, number[]>()
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  list.push(now)
  hits.set(key, list)
  return list.length > max
}
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of hits) if (!v.some((t) => now - t < 3_600_000)) hits.delete(k)
}, 600_000).unref?.()

// ── security headers + same-origin check for writes ───────────────────────────
app.use("*", async (c, next) => {
  await next()
  c.header("X-Content-Type-Options", "nosniff")
  c.header("Referrer-Policy", "same-origin")
  c.header("X-Frame-Options", "DENY")
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  )
})
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin")
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host")
    if (origin && host && new URL(origin).host !== host) return bad(c, "forbidden", 403)
  }
  c.header("Cache-Control", "no-store")
  await next()
})

// ── jersey numbers ────────────────────────────────────────────────────────────
async function takenNumbers(tx: Q, team: string | null, s: Settings, exceptId = 0): Promise<string[]> {
  const rows = s.scope === "team" && team
    ? await tx`SELECT DISTINCT jersey_no FROM sd_entries WHERE team = ${team} AND id <> ${exceptId} ORDER BY jersey_no`
    : await tx`SELECT DISTINCT jersey_no FROM sd_entries WHERE id <> ${exceptId} ORDER BY jersey_no`
  return rows.map((r) => r.jersey_no as string)
}

const numberTakenMsg = (no: string, s: Settings, team: string) =>
  s.scope === "team"
    ? `หมายเลข ${no} มีคนใน${teamLabel(team)}เลือกไปแล้ว กรุณาเลือกหมายเลขใหม่`
    : `หมายเลข ${no} มีคนเลือกไปแล้ว กรุณาเลือกหมายเลขใหม่`

/** Insert or update one entry. Returns the row, or an error response body + status. */
async function saveEntry(e: Entry, id: number | null): Promise<{ row: any } | { status: number; body: object }> {
  try {
    return await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${LOCK})`
      const s = await getSettings(tx)
      const taken = await takenNumbers(tx, e.team, s, id ?? 0)
      if (taken.includes(e.jersey_no)) return { status: 409, body: { field: "jersey_no", error: numberTakenMsg(e.jersey_no, s, e.team), taken } }
      const [dupe] = await tx`SELECT id FROM sd_entries WHERE upper(emp_code) = ${e.emp_code} AND id <> ${id ?? 0}`
      if (dupe) return { status: 409, body: { field: "emp_code", error: id ? "รหัสพนักงานนี้มีอยู่ในรายชื่อแล้ว" : "รหัสพนักงานนี้ส่งแบบฟอร์มไปแล้ว หากต้องการแก้ไขข้อมูล กรุณาติดต่อผู้จัดงาน" } }
      const [row] = id
        ? await tx`UPDATE sd_entries SET emp_code = ${e.emp_code}, full_name = ${e.full_name}, team = ${e.team}, nickname = ${e.nickname},
                     jersey_no = ${e.jersey_no}, size = ${e.size}, updated_at = NOW() WHERE id = ${id} RETURNING *`
        : await tx`INSERT INTO sd_entries (emp_code, full_name, team, nickname, jersey_no, size)
                   VALUES (${e.emp_code}, ${e.full_name}, ${e.team}, ${e.nickname}, ${e.jersey_no}, ${e.size}) RETURNING *`
      if (!row) return { status: 404, body: { error: "ไม่พบรายการนี้" } }
      return { row }
    })
  } catch (err: any) {
    if (err?.code === "23505") return { status: 409, body: { field: "emp_code", error: "รหัสพนักงานนี้ส่งแบบฟอร์มไปแล้ว หากต้องการแก้ไขข้อมูล กรุณาติดต่อผู้จัดงาน" } }
    throw err
  }
}

const publicRow = (r: any) => ({ id: r.id, emp_code: r.emp_code, full_name: r.full_name, team: r.team, nickname: r.nickname, jersey_no: r.jersey_no, size: r.size, created_at: r.created_at, updated_at: r.updated_at })

// ── public form ───────────────────────────────────────────────────────────────
app.get("/api/config", async (c) => {
  const s = await getSettings()
  return c.json({ open: s.open, scope: s.scope, teams: TEAMS, sizes: SIZES, nickMax: NICK_MAX })
})

app.get("/api/numbers", async (c) => {
  const s = await getSettings()
  const team = TEAMS.some((t) => t.id === c.req.query("team")) ? c.req.query("team")! : null
  return c.json({ scope: s.scope, taken: await takenNumbers(sql, team, s) })
})

app.post("/api/entries", async (c) => {
  if (limited(`entry:${ip(c)}`, 30, 600_000)) return bad(c, "ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่", 429)
  const s = await getSettings()
  if (!s.open) return bad(c, "ปิดรับแบบฟอร์มแล้ว", 403)
  const e = cleanEntry(await c.req.json().catch(() => ({})))
  if ("error" in e) return bad(c, e.error, 400, { field: e.field })
  const r = await saveEntry(e, null)
  if ("status" in r) return c.json(r.body, r.status as any)
  console.log(`[entry] #${r.row.id} ${r.row.team} no.${r.row.jersey_no} ${r.row.size}`)
  return c.json({ entry: publicRow(r.row) }, 201)
})

// ── admin auth ────────────────────────────────────────────────────────────────
const sha = (s: string) => createHash("sha256").update(s).digest()
const sameSecret = (a: string, b: string) => timingSafeEqual(sha(a), sha(b))

async function adminHash(): Promise<string | null> {
  const [r] = await sql`SELECT value FROM sd_settings WHERE key = 'admin'`
  return r?.value?.hash ?? null
}
async function isAdmin(c: Context): Promise<boolean> {
  const token = getCookie(c, COOKIE)
  if (!token) return false
  const [r] = await sql`SELECT 1 FROM sd_sessions WHERE token = ${sha(token).toString("hex")} AND expires_at > NOW()`
  return !!r
}
async function startSession(c: Context) {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
  await sql`INSERT INTO sd_sessions (token, expires_at) VALUES (${sha(token).toString("hex")}, NOW() + make_interval(days => ${SESSION_DAYS}))`
  const secure = c.req.url.startsWith("https") || c.req.header("x-forwarded-proto") === "https"
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Strict", secure, path: "/", maxAge: SESSION_DAYS * 86400 })
}

app.get("/api/admin/status", async (c) => c.json({ hasPassword: !!(await adminHash()), setupAvailable: !!SETUP_CODE, authed: await isAdmin(c) }))

app.post("/api/admin/setup", async (c) => {
  if (limited(`login:${ip(c)}`, 10, 600_000)) return bad(c, "ลองหลายครั้งเกินไป กรุณารอ 10 นาที", 429)
  const b = await c.req.json().catch(() => ({}))
  const password = String(b.password ?? "")
  if (!SETUP_CODE) return bad(c, "ยังไม่ได้ตั้งรหัสเริ่มต้นในระบบ", 403)
  if (!sameSecret(String(b.code ?? "").trim(), SETUP_CODE)) return bad(c, "รหัสเริ่มต้นไม่ถูกต้อง", 401)
  if (password.length < 8) return bad(c, "รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร")
  const hash = await Bun.password.hash(password)
  // Only while no admin password exists — after that the setup code is dead.
  const [r] = await sql`INSERT INTO sd_settings (key, value) VALUES ('admin', ${sql.json({ hash })}) ON CONFLICT (key) DO NOTHING RETURNING key`
  if (!r) return bad(c, "ตั้งรหัสผ่านผู้ดูแลไปแล้ว กรุณาเข้าสู่ระบบ", 409)
  console.log("[admin] password set up")
  await startSession(c)
  return c.json({ ok: true })
})

app.post("/api/admin/login", async (c) => {
  if (limited(`login:${ip(c)}`, 10, 600_000)) return bad(c, "ลองหลายครั้งเกินไป กรุณารอ 10 นาที", 429)
  const b = await c.req.json().catch(() => ({}))
  const hash = await adminHash()
  if (!hash || !(await Bun.password.verify(String(b.password ?? ""), hash))) return bad(c, "รหัสผ่านไม่ถูกต้อง", 401)
  await startSession(c)
  return c.json({ ok: true })
})

app.post("/api/admin/logout", async (c) => {
  const token = getCookie(c, COOKIE)
  if (token) await sql`DELETE FROM sd_sessions WHERE token = ${sha(token).toString("hex")}`
  deleteCookie(c, COOKIE, { path: "/" })
  return c.json({ ok: true })
})

// Everything below needs the admin session.
app.use("/api/admin/*", async (c, next) => {
  if (["/api/admin/status", "/api/admin/setup", "/api/admin/login", "/api/admin/logout"].includes(c.req.path)) return next()
  if (!(await isAdmin(c))) return bad(c, "กรุณาเข้าสู่ระบบผู้ดูแล", 401)
  await next()
})

app.post("/api/admin/password", async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const hash = await adminHash()
  if (!hash || !(await Bun.password.verify(String(b.current ?? ""), hash))) return bad(c, "รหัสผ่านปัจจุบันไม่ถูกต้อง")
  if (String(b.next ?? "").length < 8) return bad(c, "รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร")
  await sql`UPDATE sd_settings SET value = ${sql.json({ hash: await Bun.password.hash(String(b.next)) })} WHERE key = 'admin'`
  // Sign out every other device.
  const token = getCookie(c, COOKIE) ?? ""
  await sql`DELETE FROM sd_sessions WHERE token <> ${sha(token).toString("hex")}`
  return c.json({ ok: true })
})

app.get("/api/admin/entries", async (c) => {
  const rows = await sql`SELECT * FROM sd_entries ORDER BY created_at DESC, id DESC`
  return c.json({ entries: rows.map(publicRow), settings: await getSettings() })
})

app.patch("/api/admin/entries/:id", async (c) => {
  const id = Number(c.req.param("id"))
  if (!Number.isInteger(id) || id <= 0) return bad(c, "ไม่พบรายการนี้", 404)
  const e = cleanEntry(await c.req.json().catch(() => ({})))
  if ("error" in e) return bad(c, e.error, 400, { field: e.field })
  const r = await saveEntry(e, id)
  if ("status" in r) return c.json(r.body, r.status as any)
  return c.json({ entry: publicRow(r.row) })
})

app.delete("/api/admin/entries/:id", async (c) => {
  const id = Number(c.req.param("id"))
  const [r] = Number.isInteger(id) ? await sql`DELETE FROM sd_entries WHERE id = ${id} RETURNING id, team, jersey_no` : []
  if (!r) return bad(c, "ไม่พบรายการนี้", 404)
  console.log(`[admin] deleted entry #${r.id} (${r.team} no.${r.jersey_no})`)
  return c.json({ ok: true })
})

app.patch("/api/admin/settings", async (c) => {
  const b = await c.req.json().catch(() => ({}))
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${LOCK})`
    const s = await getSettings(tx)
    const next: Settings = { open: typeof b.open === "boolean" ? b.open : s.open, scope: b.scope === "team" || b.scope === "all" ? b.scope : s.scope }
    if (next.scope === "all" && s.scope === "team") {
      // Can't switch to company-wide numbers while two colours share a number.
      const dupes = await tx`SELECT jersey_no FROM sd_entries GROUP BY jersey_no HAVING count(*) > 1 ORDER BY jersey_no`
      if (dupes.length) return bad(c, `เปลี่ยนไม่ได้ เพราะหมายเลข ${dupes.map((d) => d.jersey_no).join(", ")} ถูกใช้ซ้ำในหลายสีแล้ว`, 409)
    }
    await tx`UPDATE sd_settings SET value = ${tx.json(next)} WHERE key = 'main'`
    return c.json({ settings: next })
  })
})

const thaiStamp = (d: Date) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d)

app.get("/api/admin/export.xlsx", async () => {
  const rows = await sql`SELECT * FROM sd_entries ORDER BY team, jersey_no, id`
  const wb = new ExcelJS.Workbook()
  wb.creator = "Sports Day UFicon 2026"
  const head = (ws: ExcelJS.Worksheet) => {
    const h = ws.getRow(1)
    h.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial" }
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } }
    h.alignment = { vertical: "middle", horizontal: "center" }
    ws.views = [{ state: "frozen", ySplit: 1 }]
  }
  const listColumns = [
    { header: "ลำดับ", key: "n", width: 7 },
    { header: "รหัสพนักงาน", key: "emp_code", width: 14 },
    { header: "ชื่อ-นามสกุล", key: "full_name", width: 30 },
    { header: "สี", key: "team", width: 10 },
    { header: "ชื่อเล่นบนเสื้อ", key: "nickname", width: 18 },
    { header: "หมายเลขเสื้อ", key: "jersey_no", width: 13 },
    { header: "ไซส์", key: "size", width: 8 },
    { header: "ส่งเมื่อ", key: "created", width: 20 },
  ]
  const addList = (name: string, list: any[], argb?: string) => {
    const ws = wb.addWorksheet(name, argb ? { properties: { tabColor: { argb } } } : {})
    ws.columns = listColumns
    list.forEach((r, i) =>
      ws.addRow({ n: i + 1, emp_code: r.emp_code, full_name: r.full_name, team: teamLabel(r.team), nickname: r.nickname, jersey_no: r.jersey_no, size: r.size, created: thaiStamp(new Date(r.created_at)) }),
    )
    ws.getColumn("jersey_no").numFmt = "@" // keep the leading zero (07)
    ws.getColumn("jersey_no").alignment = { horizontal: "center" }
    ws.getColumn("size").alignment = { horizontal: "center" }
    ws.eachRow((row) => (row.font = { ...(row.font ?? {}), name: "Arial" }))
    head(ws)
  }
  addList("ทั้งหมด", rows)

  // Shirt order: size × colour.
  const sum = wb.addWorksheet("สรุปไซส์เสื้อ")
  sum.columns = [
    { header: "ไซส์", key: "size", width: 9 },
    { header: "รอบอก (นิ้ว)", key: "chest", width: 13 },
    { header: "ความยาว (นิ้ว)", key: "length", width: 14 },
    ...TEAMS.map((t) => ({ header: t.label, key: t.id, width: 11 })),
    { header: "รวม", key: "total", width: 10 },
  ]
  SIZES.forEach((s, i) => {
    const r = i + 2
    const counts = Object.fromEntries(TEAMS.map((t) => [t.id, rows.filter((x) => x.size === s.id && x.team === t.id).length]))
    sum.addRow({ size: s.id, chest: s.chest, length: s.length, ...counts })
    sum.getCell(r, 4 + TEAMS.length).value = { formula: `SUM(D${r}:${String.fromCharCode(67 + TEAMS.length)}${r})` }
  })
  const last = SIZES.length + 1
  const totalRow = sum.addRow({ size: "รวม" })
  for (let col = 4; col <= 4 + TEAMS.length; col++) {
    const L = String.fromCharCode(64 + col)
    totalRow.getCell(col).value = { formula: `SUM(${L}2:${L}${last})` }
  }
  totalRow.font = { bold: true, name: "Arial" }
  sum.eachRow((row) => (row.alignment = { horizontal: "center" }))
  head(sum)

  for (const t of TEAMS) addList(t.label, rows.filter((r) => r.team === t.id), "FF" + t.color.slice(1))

  const buf = await wb.xlsx.writeBuffer()
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" })
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sports-day-2026_${day}.xlsx"`,
      "Cache-Control": "no-store",
    },
  })
})

// ── static files ──────────────────────────────────────────────────────────────
const PUB = import.meta.dir + "/../public/"
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", jpg: "image/jpeg", svg: "image/svg+xml", png: "image/png" }
const STATIC = new Set(["app.js", "admin.js", "common.js", "style.css", "size-chart.jpg", "favicon.svg"])
const file = (name: string) => new Response(Bun.file(PUB + name), { headers: { "Content-Type": TYPES[name.split(".").pop()!]!, "Cache-Control": name.endsWith(".jpg") ? "public, max-age=86400" : "no-cache" } })

app.get("/health", (c) => c.json({ ok: true }))
app.get("/", () => file("index.html"))
app.get("/admin", () => file("admin.html"))
app.get("/:name", (c, next) => (STATIC.has(c.req.param("name")) ? file(c.req.param("name")) : next()))
app.notFound((c) => (c.req.path.startsWith("/api/") ? bad(c, "not found", 404) : c.redirect("/")))
app.onError((err, c) => {
  console.error("[error]", err)
  return c.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่" }, 500)
})

await initDB()
console.log(`[sports-day] listening on :${PORT}${SETUP_CODE ? "" : " (ADMIN_SETUP_CODE not set — the admin password can't be created)"}${(await adminHash()) ? " — admin password set" : ""}`)
// HOST=127.0.0.1 for local runs; unset = every interface (IPv4 and IPv6) in the container.
export default { port: PORT, ...(process.env.HOST ? { hostname: process.env.HOST } : {}), fetch: app.fetch }
export { app }
