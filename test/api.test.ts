// Needs a throw-away Postgres: TEST_DATABASE_URL=postgres://…/sportsday_test bun test
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { cleanEntry, parseRoster } from "../src/data"

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error("set TEST_DATABASE_URL to an empty test database")
process.env.DATABASE_URL = url
process.env.ADMIN_LINK_TOKEN = "organiser-link-token-for-tests-123"

const { sql } = await import("../src/db")
await sql`DROP TABLE IF EXISTS sd_entries, sd_settings, sd_sessions, sd_members`
const { app } = await import("../src/server")

let cookie = ""
const req = (path: string, init: { method?: string; body?: unknown } = {}) =>
  app.request(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", cookie, "x-forwarded-for": "10.0.0." + Math.floor(Math.random() * 200) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
const person = (o: Record<string, string> = {}) => ({ emp_code: "1", full_name: "สมใจ ใจดี", team: "blue", nickname: "SMILE", jersey_no: "07", size: "M", ...o })

afterAll(async () => { await sql.end() })

describe("form rules", () => {
  it("cleans and checks every answer", () => {
    expect(cleanEntry(person())).toMatchObject({ emp_code: "0001", jersey_no: "07" })
    expect(cleanEntry(person({ emp_code: "UF1" }))).toMatchObject({ field: "emp_code" })
    expect(cleanEntry(person({ jersey_no: "7" }))).toMatchObject({ field: "jersey_no" })
    expect(cleanEntry(person({ jersey_no: "100" }))).toMatchObject({ field: "jersey_no" })
    expect(cleanEntry(person({ team: "red" }))).toMatchObject({ field: "team" })
    expect(cleanEntry(person({ size: "XXL" }))).toMatchObject({ field: "size" })
    expect(cleanEntry(person({ nickname: "สไมล์" }))).toMatchObject({ field: "nickname" })
    expect(cleanEntry(person({ nickname: "Ma O'K-J" }))).toMatchObject({ nickname: "MA O'K-J" })
    expect(cleanEntry(person({ nickname: "AB12" }))).toMatchObject({ field: "nickname" })
    expect(cleanEntry(person({ nickname: "smile" }))).toMatchObject({ nickname: "SMILE" })
    expect(cleanEntry(person({ nickname: "ABCDEFGH" }))).toMatchObject({ nickname: "ABCDEFGH" })
    expect(cleanEntry(person({ nickname: "ABCDEFGHI" }))).toMatchObject({ field: "nickname" })
    expect(cleanEntry(person({ nickname: "ABCDEFGHIJKLM" }))).toMatchObject({ field: "nickname" })
    expect(cleanEntry(person({ nickname: "<b>x</b>" }))).toMatchObject({ field: "nickname" })
    expect(cleanEntry(person({ emp_code: "" }))).toMatchObject({ field: "emp_code" })
  })
})

describe("public form", () => {
  it("gives teams, sizes and settings", async () => {
    const r = await (await req("/api/config")).json()
    expect(r.teams.map((t: any) => t.id)).toEqual(["blue", "pink", "green"])
    expect(r.sizes.map((s: any) => s.id)).toEqual(["2S", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL"])
    expect(r).toMatchObject({ open: true, scope: "all" })
  })

  it("saves a form and marks the number taken", async () => {
    const r = await req("/api/entries", { body: person() })
    expect(r.status).toBe(201)
    expect((await r.json()).entry).toMatchObject({ emp_code: "0001", team: "blue", jersey_no: "07" })
    expect((await (await req("/api/numbers")).json()).taken).toEqual(["07"])
  })

  it("refuses a number someone already has, in any colour", async () => {
    const r = await req("/api/entries", { body: person({ emp_code: "2", team: "pink" }) })
    expect(r.status).toBe(409)
    const b = await r.json()
    expect(b.field).toBe("jersey_no")
    expect(b.error).toContain("กรุณาเลือกหมายเลขใหม่")
    expect(b.taken).toContain("07")
  })

  it("refuses a second form from the same employee", async () => {
    const r = await req("/api/entries", { body: person({ emp_code: "0001", jersey_no: "08" }) })
    expect(r.status).toBe(409)
    expect((await r.json()).field).toBe("emp_code")
  })

  it("gives the number to only one of two people sending at once", async () => {
    const rs = await Promise.all(["10", "11", "12", "13"].map((c) => req("/api/entries", { body: person({ emp_code: c, jersey_no: "23" }) })))
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
  })

  it("never lets the public read the list", async () => {
    expect((await req("/api/admin/entries")).status).toBe(401)
    expect((await req("/api/admin/export.xlsx")).status).toBe(401)
  })
})

describe("admin", () => {
  it("signs in only through the organiser link", async () => {
    expect((await req("/admin/wrong-token")).headers.get("set-cookie")).toBeNull()
    const r = await req("/admin/organiser-link-token-for-tests-123")
    expect(r.status).toBe(302)
    expect(r.headers.get("location")).toBe("/admin")
    cookie = r.headers.get("set-cookie")!.split(";")[0]!
    expect((await (await req("/api/admin/status")).json()).authed).toBe(true)
  })

  it("lists, edits and deletes entries", async () => {
    const list = (await (await req("/api/admin/entries")).json()).entries
    expect(list).toHaveLength(2)
    const uf1 = list.find((e: any) => e.emp_code === "0001")
    const other = list.find((e: any) => e.emp_code !== "0001")
    // Can't move onto someone else's number…
    const clash = await req(`/api/admin/entries/${uf1.id}`, { method: "PATCH", body: person({ jersey_no: "23" }) })
    expect(clash.status).toBe(409)
    // …but keeping your own number is fine.
    const ok = await req(`/api/admin/entries/${uf1.id}`, { method: "PATCH", body: person({ size: "XL" }) })
    expect((await ok.json()).entry.size).toBe("XL")
    expect((await req(`/api/admin/entries/${other.id}`, { method: "DELETE" })).status).toBe(200)
    expect((await (await req("/api/numbers")).json()).taken).toEqual(["07"])
  })

  it("lets numbers repeat across colours when set per colour; switching back asks the later sender to renumber", async () => {
    expect((await req("/api/admin/settings", { method: "PATCH", body: { scope: "team" } })).status).toBe(200)
    expect((await req("/api/entries", { body: person({ emp_code: "20", team: "green" }) })).status).toBe(201)
    expect((await req("/api/entries", { body: person({ emp_code: "21", team: "green" }) })).status).toBe(409)
    expect((await (await req("/api/numbers?team=pink")).json()).taken).toEqual([])
    const back = await req("/api/admin/settings", { method: "PATCH", body: { scope: "all" } })
    expect(back.status).toBe(200)
    expect(((await back.json()) as any).conflicts).toBe(1)
    const list = ((await (await req("/api/admin/entries")).json()) as any).entries
    const first = list.find((e: any) => e.emp_code === "0001"), later = list.find((e: any) => e.emp_code === "0020")
    expect(first.dup).toBeNull()
    expect(later.dup).toMatchObject({ jersey_no: "07", team: "blue" })
    // The earlier sender keeps the number when editing; the later one can't.
    expect((await req(`/api/admin/entries/${first.id}`, { method: "PATCH", body: person({ emp_code: "0001", size: "L" }) })).status).toBe(200)
    expect((await req(`/api/admin/entries/${later.id}`, { method: "PATCH", body: person({ emp_code: "0020", team: "green" }) })).status).toBe(409)
    // The later sender is told, and picks a new number with the employee code.
    const look: any = await (await req("/api/members/lookup?code=20")).json()
    expect(look.conflict.message).toContain("07")
    expect((await req("/api/entries/renumber", { method: "PUT", body: { emp_code: "1", jersey_no: "71" } })).status).toBe(409)
    expect((await req("/api/entries/renumber", { method: "PUT", body: { emp_code: "20", jersey_no: "07" } })).status).toBe(409)
    const ok = await req("/api/entries/renumber", { method: "PUT", body: { emp_code: "20", jersey_no: "71" } })
    expect(((await ok.json()) as any).entry).toMatchObject({ emp_code: "0020", team: "green", jersey_no: "71" })
    expect((((await (await req("/api/admin/entries")).json()) as any).entries as any[]).some((e) => e.dup)).toBe(false)
  })

  it("closes the form", async () => {
    await req("/api/admin/settings", { method: "PATCH", body: { open: false } })
    expect((await req("/api/entries", { body: person({ emp_code: "30", jersey_no: "30" }) })).status).toBe(403)
    await req("/api/admin/settings", { method: "PATCH", body: { open: true } })
  })

  it("exports Excel with numbers kept as text", async () => {
    const r = await req("/api/admin/export.xlsx")
    expect(r.status).toBe(200)
    expect(r.headers.get("content-type")).toContain("spreadsheetml")
    const ExcelJS = (await import("exceljs")).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await r.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(["ทั้งหมด", "สรุปไซซ์เสื้อ", "สีฟ้า", "สีชมพู", "สีเขียว"])
    const all = wb.getWorksheet("ทั้งหมด")!
    expect(all.getCell("F2").value).toBe("07")
    expect(all.rowCount).toBe(3)
  })

  it("refuses writes from another site", async () => {
    const r = await app.request("/api/entries", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://evil.example", host: "localhost" }, body: JSON.stringify(person({ emp_code: "99", jersey_no: "55" })) })
    expect(r.status).toBe(403)
  })
})

describe("editing your own answer", () => {
  let mine = { id: 0, token: "" }
  it("gives the sender a private key", async () => {
    const r: any = await (await req("/api/entries", { body: person({ emp_code: "500", team: "pink", jersey_no: "50" }) })).json()
    expect(r.editToken.length).toBeGreaterThan(30)
    mine = { id: r.entry.id, token: r.editToken }
    expect((await req("/api/entries/mine", { body: mine })).status).toBe(200)
    expect((await req("/api/entries/mine", { body: { ...mine, token: "x".repeat(64) } })).status).toBe(404)
  })

  it("lets the sender change the answer but never the employee code", async () => {
    const r = await req("/api/entries/mine", { method: "PUT", body: { ...person({ emp_code: "777", team: "pink", jersey_no: "50", nickname: "NEW" }), ...mine } })
    expect(r.status).toBe(200)
    expect(((await r.json()) as any).entry).toMatchObject({ emp_code: "0500", nickname: "NEW" })
    expect((await req("/api/entries", { body: person({ emp_code: "0500", team: "pink", jersey_no: "51" }) })).status).toBe(409)
  })

  it("rejects an edit without the key", async () => {
    const r = await req("/api/entries/mine", { method: "PUT", body: { ...person({ team: "pink", jersey_no: "52" }), id: mine.id, token: "nope" } })
    expect(r.status).toBe(404)
  })
})

describe("members per colour", () => {
  const paste = [
    "No.\tID\tคำนำหน้า\tชื่อ\tสกุล\tชื่อเล่น\tสาขา\tสีทีม",
    "1\t4\tนาย\tธารี\tตรีรัศมีพร\tไก่\tHO\tฟ้า",
    "2\t933\tนาย\tไกรสิทธิ์\tลีปัสสา\tเหินฟ้า\tIS-FI\tฟ้า",
    "1\t576\tนางสาว\tศิริยากร\tฉัตรจินดา\tมาย\tHO\tชมพู",
    "26\t\t\t\t\t\t\tฟ้า",
  ].join("\n")

  it("reads rows pasted from Excel", () => {
    const r = parseRoster(paste)
    expect(r.members.map((m) => m.emp_code)).toEqual(["0004", "0933", "0576"])
    expect(r.members[2]).toMatchObject({ title: "นางสาว", first_name: "ศิริยากร", team: "pink" })
  })

  it("imports the list (organiser only) and shows it per colour", async () => {
    const saved = cookie
    cookie = ""
    expect((await req("/api/admin/members/import", { body: { text: paste } })).status).toBe(401)
    cookie = saved
    const dry: any = await (await req("/api/admin/members/import", { body: { text: paste, dryRun: true } })).json()
    expect(dry.count).toBe(3)
    expect((await req("/api/admin/members/import", { body: { text: paste } })).status).toBe(200)
    const teams = ((await (await req("/api/members")).json()) as any).teams
    expect(teams[0].members.slice(0, 2).map((m: any) => m.name)).toEqual(["ธารี ตรีรัศมีพร", "ไกรสิทธิ์ ลีปัสสา"])
    expect(teams[0].members[0]).not.toHaveProperty("emp_code")
  })

  it("fills the form from the list and blocks the wrong colour", async () => {
    const look = await (await req("/api/members/lookup?code=4")).json()
    expect(look).toMatchObject({ found: true, emp_code: "0004", team: "blue", full_name: "ธารี ตรีรัศมีพร" })
    const wrong = await req("/api/entries", { body: person({ emp_code: "4", team: "green", jersey_no: "44" }) })
    expect(wrong.status).toBe(409)
    expect(((await wrong.json()) as any).field).toBe("team")
    expect((await req("/api/entries", { body: person({ emp_code: "0004", team: "blue", jersey_no: "44" }) })).status).toBe(201)
    const blue = ((await (await req("/api/members")).json()) as any).teams[0].members[0]
    expect(blue).toMatchObject({ sent: true, jersey_no: "44" })
  })

  it("adds the members sheet to Excel", async () => {
    const ExcelJS = (await import("exceljs")).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await (await req("/api/admin/export.xlsx")).arrayBuffer())
    const ws = wb.getWorksheet("สมาชิกแต่ละสี")!
    expect(ws.getCell("C2").value).toBe("0004")
    expect(ws.getCell("G2").value).toBe("ส่งแล้ว")
  })
})
