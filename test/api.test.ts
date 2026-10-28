// Needs a throw-away Postgres: TEST_DATABASE_URL=postgres://…/sportsday_test bun test
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { cleanEntry } from "../src/data"

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error("set TEST_DATABASE_URL to an empty test database")
process.env.DATABASE_URL = url
process.env.ADMIN_SETUP_CODE = "setup-code-for-tests"

const { sql } = await import("../src/db")
await sql`DROP TABLE IF EXISTS sd_entries, sd_settings, sd_sessions`
const { app } = await import("../src/server")

let cookie = ""
const req = (path: string, init: { method?: string; body?: unknown } = {}) =>
  app.request(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", cookie, "x-forwarded-for": "10.0.0." + Math.floor(Math.random() * 200) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
const person = (o: Record<string, string> = {}) => ({ emp_code: "uf001", full_name: "สมใจ ใจดี", team: "blue", nickname: "SMILE", jersey_no: "07", size: "M", ...o })

afterAll(async () => { await sql.end() })

describe("form rules", () => {
  it("cleans and checks every answer", () => {
    expect(cleanEntry(person())).toMatchObject({ emp_code: "UF001", jersey_no: "07" })
    expect(cleanEntry(person({ jersey_no: "7" }))).toMatchObject({ field: "jersey_no" })
    expect(cleanEntry(person({ jersey_no: "100" }))).toMatchObject({ field: "jersey_no" })
    expect(cleanEntry(person({ team: "red" }))).toMatchObject({ field: "team" })
    expect(cleanEntry(person({ size: "XXL" }))).toMatchObject({ field: "size" })
    expect(cleanEntry(person({ nickname: "สไมล์" }))).toMatchObject({ nickname: "สไมล์" })
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
    expect((await r.json()).entry).toMatchObject({ emp_code: "UF001", team: "blue", jersey_no: "07" })
    expect((await (await req("/api/numbers")).json()).taken).toEqual(["07"])
  })

  it("refuses a number someone already has, in any colour", async () => {
    const r = await req("/api/entries", { body: person({ emp_code: "UF002", team: "pink" }) })
    expect(r.status).toBe(409)
    const b = await r.json()
    expect(b.field).toBe("jersey_no")
    expect(b.error).toContain("กรุณาเลือกหมายเลขใหม่")
    expect(b.taken).toContain("07")
  })

  it("refuses a second form from the same employee", async () => {
    const r = await req("/api/entries", { body: person({ emp_code: "UF001 ", jersey_no: "08" }) })
    expect(r.status).toBe(409)
    expect((await r.json()).field).toBe("emp_code")
  })

  it("gives the number to only one of two people sending at once", async () => {
    const rs = await Promise.all(["UF010", "UF011", "UF012", "UF013"].map((c) => req("/api/entries", { body: person({ emp_code: c, jersey_no: "23" }) })))
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409, 409, 409])
  })

  it("never lets the public read the list", async () => {
    expect((await req("/api/admin/entries")).status).toBe(401)
    expect((await req("/api/admin/export.xlsx")).status).toBe(401)
  })
})

describe("admin", () => {
  it("sets the password once with the setup code", async () => {
    expect((await req("/api/admin/setup", { body: { code: "wrong", password: "longenough" } })).status).toBe(401)
    const r = await req("/api/admin/setup", { body: { code: "setup-code-for-tests", password: "longenough" } })
    expect(r.status).toBe(200)
    cookie = r.headers.get("set-cookie")!.split(";")[0]!
    const again = await req("/api/admin/setup", { body: { code: "setup-code-for-tests", password: "another-one" } })
    expect(again.status).toBe(409)
  })

  it("logs in with the password only", async () => {
    const saved = cookie
    cookie = ""
    expect((await req("/api/admin/login", { body: { password: "nope" } })).status).toBe(401)
    expect((await req("/api/admin/login", { body: { password: "longenough" } })).status).toBe(200)
    cookie = saved
  })

  it("lists, edits and deletes entries", async () => {
    const list = (await (await req("/api/admin/entries")).json()).entries
    expect(list).toHaveLength(2)
    const uf1 = list.find((e: any) => e.emp_code === "UF001")
    const other = list.find((e: any) => e.emp_code !== "UF001")
    // Can't move onto someone else's number…
    const clash = await req(`/api/admin/entries/${uf1.id}`, { method: "PATCH", body: person({ jersey_no: "23" }) })
    expect(clash.status).toBe(409)
    // …but keeping your own number is fine.
    const ok = await req(`/api/admin/entries/${uf1.id}`, { method: "PATCH", body: person({ size: "XL" }) })
    expect((await ok.json()).entry.size).toBe("XL")
    expect((await req(`/api/admin/entries/${other.id}`, { method: "DELETE" })).status).toBe(200)
    expect((await (await req("/api/numbers")).json()).taken).toEqual(["07"])
  })

  it("lets numbers repeat across colours when set per colour, and blocks switching back while they do", async () => {
    expect((await req("/api/admin/settings", { method: "PATCH", body: { scope: "team" } })).status).toBe(200)
    expect((await req("/api/entries", { body: person({ emp_code: "UF020", team: "green" }) })).status).toBe(201)
    expect((await req("/api/entries", { body: person({ emp_code: "UF021", team: "green" }) })).status).toBe(409)
    expect((await (await req("/api/numbers?team=pink")).json()).taken).toEqual([])
    const back = await req("/api/admin/settings", { method: "PATCH", body: { scope: "all" } })
    expect(back.status).toBe(409)
    expect((await back.json()).error).toContain("07")
  })

  it("closes the form", async () => {
    await req("/api/admin/settings", { method: "PATCH", body: { open: false } })
    expect((await req("/api/entries", { body: person({ emp_code: "UF030", jersey_no: "30" }) })).status).toBe(403)
    await req("/api/admin/settings", { method: "PATCH", body: { open: true } })
  })

  it("exports Excel with numbers kept as text", async () => {
    const r = await req("/api/admin/export.xlsx")
    expect(r.status).toBe(200)
    expect(r.headers.get("content-type")).toContain("spreadsheetml")
    const ExcelJS = (await import("exceljs")).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await r.arrayBuffer())
    expect(wb.worksheets.map((w) => w.name)).toEqual(["ทั้งหมด", "สรุปไซส์เสื้อ", "สีฟ้า", "สีชมพู", "สีเขียว"])
    const all = wb.getWorksheet("ทั้งหมด")!
    expect(all.getCell("F2").value).toBe("07")
    expect(all.rowCount).toBe(3)
  })

  it("refuses writes from another site", async () => {
    const r = await app.request("/api/entries", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://evil.example", host: "localhost" }, body: JSON.stringify(person({ emp_code: "X1", jersey_no: "55" })) })
    expect(r.status).toBe(403)
  })
})
