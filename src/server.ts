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
import { TEAMS, SIZES, NICK_MAX, cleanEntry, cleanMember, normEmpCode, parseRoster, teamLabel, type Entry, type Member } from "./data"

const app = new Hono()
const PORT = Number(process.env.PORT ?? 3000)
const COOKIE = "sd_admin"
const SESSION_DAYS = 120
// The organiser opens /admin/<ADMIN_LINK_TOKEN> — no account or password (Smile, 28 Oct 2026).
const LINK_TOKEN = process.env.ADMIN_LINK_TOKEN ?? ""
const LOCK = 7_402_026 // pg_advisory_xact_lock key for jersey numbers

const bad = (c: Context, error: string, status = 400, more: object = {}) => c.json({ error, ...more }, status as any)
const sha = (s: string) => createHash("sha256").update(s).digest()
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
async function saveEntry(e: Entry, id: number | null, checkTeam = false): Promise<{ row: any } | { status: number; body: object }> {
  try {
    return await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${LOCK})`
      if (checkTeam) {
        const [m] = await tx`SELECT team FROM sd_members WHERE emp_code = ${e.emp_code}`
        if (m && m.team !== e.team)
          return { status: 409, body: { field: "team", error: `รหัสพนักงาน ${e.emp_code} อยู่ใน${teamLabel(m.team)}ตามรายชื่อจับฉลาก กรุณาเลือกสีให้ถูกต้อง`, team: m.team } }
      }
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
  const r = await saveEntry(e, null, true)
  if ("status" in r) return c.json(r.body, r.status as any)
  // The browser that sent the form keeps this key to edit the answer later.
  const editToken = newToken()
  await sql`UPDATE sd_entries SET edit_hash = ${sha(editToken).toString("hex")} WHERE id = ${r.row.id}`
  console.log(`[entry] #${r.row.id} ${r.row.team} no.${r.row.jersey_no} ${r.row.size}`)
  return c.json({ entry: publicRow(r.row), editToken }, 201)
})

async function ownEntry(id: unknown, token: unknown) {
  if (!Number.isInteger(id) || typeof token !== "string" || token.length < 20) return null
  const [row] = await sql`SELECT * FROM sd_entries WHERE id = ${id as number} AND edit_hash = ${sha(token).toString("hex")}`
  return row ?? null
}

/** The sender's own answer (id + edit key kept by their browser). */
app.post("/api/entries/mine", async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const row = await ownEntry(b.id, b.token)
  return row ? c.json({ entry: publicRow(row) }) : bad(c, "ไม่พบคำตอบเดิม", 404)
})

/** Edit your own answer — the employee code stays the same, so it is never a second form. */
app.put("/api/entries/mine", async (c) => {
  if (limited(`entry:${ip(c)}`, 30, 600_000)) return bad(c, "ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่", 429)
  const b = await c.req.json().catch(() => ({}))
  const row = await ownEntry(b.id, b.token)
  if (!row) return bad(c, "ไม่พบคำตอบเดิม หากต้องการแก้ไข กรุณาติดต่อผู้จัดงาน", 404)
  if (!(await getSettings()).open) return bad(c, "ปิดรับแบบฟอร์มแล้ว แก้ไขไม่ได้ กรุณาติดต่อผู้จัดงาน", 403)
  const e = cleanEntry({ ...b, emp_code: row.emp_code })
  if ("error" in e) return bad(c, e.error, 400, { field: e.field })
  const r = await saveEntry(e, row.id, true)
  if ("status" in r) return c.json(r.body, r.status as any)
  console.log(`[entry] #${row.id} edited by sender`)
  return c.json({ entry: publicRow(r.row) })
})

// ── team members ──────────────────────────────────────────────────────────────
const fullName = (m: any) => [m.title, m.first_name, m.last_name].filter(Boolean).join(" ").replace(/^(นาย|นางสาว|นาง)\s/, "$1")

/** Members per colour + who has sent the form. Form entries not in the list are added at the end. */
app.get("/api/members", async (c) => {
  const members = await sql`SELECT * FROM sd_members ORDER BY team, sort, id`
  const entries = await sql`SELECT emp_code, full_name, team, nickname, jersey_no FROM sd_entries`
  const byCode = new Map(entries.map((e) => [e.emp_code, e]))
  const listed = new Set(members.map((m) => m.emp_code))
  const teams = TEAMS.map((t) => {
    const rows = members.filter((m) => m.team === t.id).map((m) => {
      const e = byCode.get(m.emp_code)
      return { name: fullName(m), nickname: m.nickname, branch: m.branch, sent: !!e, jersey_no: e?.jersey_no ?? null }
    })
    const extra = entries.filter((e) => e.team === t.id && !listed.has(e.emp_code))
      .map((e) => ({ name: e.full_name, nickname: e.nickname, branch: "", sent: true, jersey_no: e.jersey_no, extra: true }))
    return { id: t.id, label: t.label, color: t.color, members: [...rows, ...extra] }
  })
  return c.json({ teams })
})

/** The form fills name and colour from the draw list. */
app.get("/api/members/lookup", async (c) => {
  if (limited(`lookup:${ip(c)}`, 120, 600_000)) return bad(c, "ค้นหาบ่อยเกินไป", 429)
  const code = normEmpCode(c.req.query("code"))
  const [m] = code ? await sql`SELECT * FROM sd_members WHERE emp_code = ${code}` : []
  const [e] = code ? await sql`SELECT 1 FROM sd_entries WHERE emp_code = ${code}` : []
  return c.json(m ? { found: true, emp_code: code, full_name: [m.first_name, m.last_name].filter(Boolean).join(" "), team: m.team, sent: !!e } : { found: false, emp_code: code, sent: !!e })
})

async function replaceMembers(list: Member[]) {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM sd_members`
    let i = 0
    for (const m of list) {
      await tx`INSERT INTO sd_members (emp_code, title, first_name, last_name, nickname, branch, team, sort)
               VALUES (${m.emp_code}, ${m.title}, ${m.first_name}, ${m.last_name}, ${m.nickname}, ${m.branch}, ${m.team}, ${++i})
               ON CONFLICT (emp_code) DO UPDATE SET title = EXCLUDED.title, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
                 nickname = EXCLUDED.nickname, branch = EXCLUDED.branch, team = EXCLUDED.team, sort = EXCLUDED.sort`
    }
  })
}

/** First start only: load the draw list from the runtime env (names stay out of the public repo). */
async function seedMembers() {
  const raw = process.env.MEMBERS_SEED_B64
  if (!raw) return
  const [done] = await sql`SELECT 1 FROM sd_settings WHERE key = 'members_seed'`
  if (done) return
  const { members, skipped } = parseRoster(Buffer.from(raw, "base64").toString("utf8"))
  await replaceMembers(members)
  await sql`INSERT INTO sd_settings (key, value) VALUES ('members_seed', ${sql.json({ at: new Date().toISOString(), count: members.length })}) ON CONFLICT (key) DO NOTHING`
  console.log(`[members] seeded ${members.length} members from env (skipped ${skipped} rows)`)
}

// ── admin auth ────────────────────────────────────────────────────────────────
const newToken = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")
const sameSecret = (a: string, b: string) => timingSafeEqual(sha(a), sha(b))

async function isAdmin(c: Context): Promise<boolean> {
  const token = getCookie(c, COOKIE)
  if (!token) return false
  const [r] = await sql`SELECT 1 FROM sd_sessions WHERE token = ${sha(token).toString("hex")} AND expires_at > NOW()`
  return !!r
}
async function startSession(c: Context) {
  const token = newToken()
  await sql`INSERT INTO sd_sessions (token, expires_at) VALUES (${sha(token).toString("hex")}, NOW() + make_interval(days => ${SESSION_DAYS}))`
  const secure = c.req.url.startsWith("https") || c.req.header("x-forwarded-proto") === "https"
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", secure, path: "/", maxAge: SESSION_DAYS * 86400 })
}

app.get("/api/admin/status", async (c) => c.json({ authed: await isAdmin(c) }))

/** The organiser link: opening it signs this browser in, then shows /admin. */
app.get("/admin/:token", async (c) => {
  if (limited(`link:${ip(c)}`, 20, 600_000)) return c.text("ลองหลายครั้งเกินไป กรุณารอ 10 นาที", 429)
  if (!LINK_TOKEN || !sameSecret(c.req.param("token"), LINK_TOKEN)) return c.redirect("/admin")
  await startSession(c)
  c.header("Referrer-Policy", "no-referrer")
  return c.redirect("/admin")
})

// Everything below needs the admin session.
app.use("/api/admin/*", async (c, next) => {
  if (c.req.path === "/api/admin/status") return next()
  if (!(await isAdmin(c))) return bad(c, "กรุณาเปิดจากลิงก์ผู้จัดงาน", 401)
  await next()
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

app.get("/api/admin/members", async (c) => {
  const rows = await sql`SELECT m.*, (e.id IS NOT NULL) AS sent, e.team AS sent_team FROM sd_members m LEFT JOIN sd_entries e ON e.emp_code = m.emp_code ORDER BY m.team, m.sort, m.id`
  return c.json({ members: rows })
})

app.post("/api/admin/members/import", async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const { members, skipped } = parseRoster(String(b.text ?? ""))
  if (!members.length) return bad(c, "ไม่พบรายชื่อ กรุณาคัดลอกแถวจาก Excel (ID, คำนำหน้า, ชื่อ, สกุล, ชื่อเล่น, สาขา, สีทีม) มาวาง")
  const codes = new Set(members.map((m) => m.emp_code))
  if (codes.size !== members.length) return bad(c, "มีรหัสพนักงานซ้ำกันในรายชื่อที่วาง")
  if (b.dryRun) return c.json({ count: members.length, skipped, perTeam: TEAMS.map((t) => ({ id: t.id, n: members.filter((m) => m.team === t.id).length })) })
  await replaceMembers(members)
  console.log(`[admin] members replaced: ${members.length} (skipped ${skipped})`)
  return c.json({ count: members.length, skipped })
})

app.post("/api/admin/members", async (c) => {
  const m = cleanMember(await c.req.json().catch(() => ({})))
  if (typeof m === "string") return bad(c, m)
  const [top] = await sql`SELECT COALESCE(MAX(sort), 0) AS max FROM sd_members WHERE team = ${m.team}`
  const [row] = await sql`INSERT INTO sd_members (emp_code, title, first_name, last_name, nickname, branch, team, sort)
    VALUES (${m.emp_code}, ${m.title}, ${m.first_name}, ${m.last_name}, ${m.nickname}, ${m.branch}, ${m.team}, ${Number(top?.max ?? 0) + 1})
    ON CONFLICT (emp_code) DO NOTHING RETURNING id`
  if (!row) return bad(c, "รหัสพนักงานนี้มีในรายชื่อแล้ว", 409)
  return c.json({ ok: true })
})

app.patch("/api/admin/members/:id", async (c) => {
  const m = cleanMember(await c.req.json().catch(() => ({})))
  if (typeof m === "string") return bad(c, m)
  try {
    const [row] = await sql`UPDATE sd_members SET emp_code = ${m.emp_code}, title = ${m.title}, first_name = ${m.first_name}, last_name = ${m.last_name},
      nickname = ${m.nickname}, branch = ${m.branch}, team = ${m.team} WHERE id = ${Number(c.req.param("id")) || 0} RETURNING id`
    if (!row) return bad(c, "ไม่พบรายชื่อนี้", 404)
  } catch (err: any) {
    if (err?.code === "23505") return bad(c, "รหัสพนักงานนี้มีในรายชื่อแล้ว", 409)
    throw err
  }
  return c.json({ ok: true })
})

app.delete("/api/admin/members/:id", async (c) => {
  const [r] = await sql`DELETE FROM sd_members WHERE id = ${Number(c.req.param("id")) || 0} RETURNING id`
  if (!r) return bad(c, "ไม่พบรายชื่อนี้", 404)
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
    { header: "ไซซ์", key: "size", width: 8 },
    { header: "ส่งเมื่อ", key: "created", width: 20 },
  ]
  const addList = (name: string, list: any[], argb?: string) => {
    const ws = wb.addWorksheet(name, argb ? { properties: { tabColor: { argb } } } : {})
    ws.columns = listColumns
    list.forEach((r, i) =>
      ws.addRow({ n: i + 1, emp_code: r.emp_code, full_name: r.full_name, team: teamLabel(r.team), nickname: r.nickname, jersey_no: r.jersey_no, size: r.size, created: thaiStamp(new Date(r.created_at)) }),
    )
    ws.getColumn("jersey_no").numFmt = "@" // keep the leading zero (07)
    ws.getColumn("emp_code").numFmt = "@"
    ws.getColumn("jersey_no").alignment = { horizontal: "center" }
    ws.getColumn("size").alignment = { horizontal: "center" }
    ws.eachRow((row) => (row.font = { ...(row.font ?? {}), name: "Arial" }))
    head(ws)
  }
  addList("ทั้งหมด", rows)

  // Shirt order: size × colour.
  const sum = wb.addWorksheet("สรุปไซซ์เสื้อ")
  sum.columns = [
    { header: "ไซซ์", key: "size", width: 9 },
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

  // Draw list with who has / hasn't sent the form.
  const members = await sql`SELECT * FROM sd_members ORDER BY team, sort, id`
  if (members.length) {
    const byCode = new Map(rows.map((r) => [r.emp_code, r]))
    const ws = wb.addWorksheet("สมาชิกแต่ละสี")
    ws.columns = [
      { header: "สี", key: "team", width: 10 }, { header: "ลำดับ", key: "n", width: 7 }, { header: "รหัสพนักงาน", key: "emp_code", width: 13 },
      { header: "ชื่อ-นามสกุล", key: "name", width: 30 }, { header: "ชื่อเล่น", key: "nickname", width: 12 }, { header: "สาขา", key: "branch", width: 11 },
      { header: "ส่งฟอร์มแล้ว", key: "sent", width: 12 }, { header: "หมายเลขเสื้อ", key: "jersey_no", width: 13 }, { header: "ไซซ์", key: "size", width: 8 },
    ]
    for (const t of TEAMS)
      members.filter((m) => m.team === t.id).forEach((m, i) => {
        const e = byCode.get(m.emp_code)
        ws.addRow({ team: t.label, n: i + 1, emp_code: m.emp_code, name: fullName(m), nickname: m.nickname, branch: m.branch, sent: e ? "ส่งแล้ว" : "ยังไม่ส่ง", jersey_no: e?.jersey_no ?? "", size: e?.size ?? "" })
      })
    ws.getColumn("jersey_no").numFmt = "@"
    ws.getColumn("emp_code").numFmt = "@"
    ws.eachRow((row) => (row.font = { ...(row.font ?? {}), name: "Arial" }))
    head(ws)
  }

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
const STATIC = new Set(["app.js", "admin.js", "common.js", "teams.js", "style.css", "size-chart.jpg", "favicon.svg"])
const file = (name: string) => new Response(Bun.file(PUB + name), { headers: { "Content-Type": TYPES[name.split(".").pop()!]!, "Cache-Control": name.endsWith(".jpg") ? "public, max-age=86400" : "no-cache" } })

app.get("/health", (c) => c.json({ ok: true }))
app.get("/", () => file("index.html"))
app.get("/admin", () => file("admin.html"))
app.get("/teams", () => file("teams.html"))
app.get("/:name", (c, next) => (STATIC.has(c.req.param("name")) ? file(c.req.param("name")) : next()))
app.notFound((c) => (c.req.path.startsWith("/api/") ? bad(c, "not found", 404) : c.redirect("/")))
app.onError((err, c) => {
  console.error("[error]", err)
  return c.json({ error: "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่" }, 500)
})

await initDB()
await seedMembers()
console.log(`[sports-day] listening on :${PORT}${LINK_TOKEN ? "" : " (ADMIN_LINK_TOKEN not set — the organiser link is off)"}`)
// HOST=127.0.0.1 for local runs; unset = every interface (IPv4 and IPv6) in the container.
export default { port: PORT, ...(process.env.HOST ? { hostname: process.env.HOST } : {}), fetch: app.fetch }
export { app }
