/** Teams and shirt sizes — one list for the server, the form and the admin page. */

export const TEAMS = [
  { id: "blue", label: "สีฟ้า", color: "#2F9BEA" },
  { id: "pink", label: "สีชมพู", color: "#EC4D97" },
  { id: "green", label: "สีเขียว", color: "#25B864" },
] as const
export type TeamId = (typeof TEAMS)[number]["id"]

/** Polo shirt (collar, buttons) size chart Smile sent on 28 Oct 2026 — inches, ±1". */
export const SIZES = [
  { id: "2S", chest: 34, length: 25 },
  { id: "S", chest: 36, length: 26 },
  { id: "M", chest: 38, length: 27 },
  { id: "L", chest: 40, length: 28 },
  { id: "XL", chest: 42, length: 29 },
  { id: "2XL", chest: 44, length: 30 },
  { id: "3XL", chest: 46, length: 31 },
  { id: "4XL", chest: 48, length: 31 },
  { id: "5XL", chest: 50, length: 33 },
  { id: "6XL", chest: 52, length: 34.5 },
  { id: "7XL", chest: 54, length: 35.5 },
] as const

export const teamLabel = (id: string) => TEAMS.find((t) => t.id === id)?.label ?? id

export type Entry = { emp_code: string; full_name: string; team: TeamId; nickname: string; jersey_no: string; size: string }
export type Problem = { field: keyof Entry; error: string }

const clean = (v: unknown, max: number) => String(v ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, max + 1)
const chars = (s: string) => [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(s)].length

export const NICK_MAX = 8
export const NICK_RE = /^[A-Za-z][A-Za-z .'\-]*$/
const NICK_ERR = "ชื่อเล่นบนเสื้อต้องเป็นภาษาอังกฤษเท่านั้น (A–Z เว้นวรรค จุด หรือขีดได้)"

/** Employee codes are numbers shown with 4 digits (0000). "4" and "0004" are the same person. */
export function normEmpCode(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, "")
  return /^\d{1,6}$/.test(s) ? s.padStart(4, "0") : null
}

/** Validate one form; returns the cleaned entry or the first problem. */
export function cleanEntry(b: any): Entry | Problem {
  if (!String(b?.emp_code ?? "").trim()) return { field: "emp_code", error: "กรุณากรอกรหัสพนักงาน" }
  const emp_code = normEmpCode(b?.emp_code)
  if (!emp_code) return { field: "emp_code", error: "รหัสพนักงานต้องเป็นตัวเลข เช่น 0000" }

  const full_name = clean(b?.full_name, 100)
  if (full_name.length < 3) return { field: "full_name", error: "กรุณากรอกชื่อจริง-นามสกุล" }
  if (full_name.length > 100) return { field: "full_name", error: "ชื่อ-นามสกุลยาวเกินไป" }
  if (!/^[\p{L}\p{M} .'\-()]+$/u.test(full_name)) return { field: "full_name", error: "ชื่อ-นามสกุลมีอักขระที่ใช้ไม่ได้" }

  const team = String(b?.team ?? "")
  if (!TEAMS.some((t) => t.id === team)) return { field: "team", error: "กรุณาเลือกสีที่จับฉลากได้" }

  const nickname = clean(b?.nickname, 40)
  if (!nickname) return { field: "nickname", error: "กรุณากรอกชื่อเล่นที่จะสกรีนบนเสื้อ" }
  if (chars(nickname) > NICK_MAX) return { field: "nickname", error: `ชื่อเล่นบนเสื้อยาวได้ไม่เกิน ${NICK_MAX} ตัวอักษร` }
  // English only on the shirt (Smile, 28 Oct 2026).
  if (!NICK_RE.test(nickname)) return { field: "nickname", error: NICK_ERR }

  const jersey_no = String(b?.jersey_no ?? "").trim()
  if (!/^[0-9]{2}$/.test(jersey_no)) return { field: "jersey_no", error: "หมายเลขเสื้อต้องเป็นตัวเลข 2 หลัก (00–99) เช่น 07" }

  const size = String(b?.size ?? "")
  if (!SIZES.some((s) => s.id === size)) return { field: "size", error: "กรุณาเลือกไซซ์เสื้อ" }

  return { emp_code, full_name, team: team as TeamId, nickname, jersey_no, size }
}

// ── team members (the draw list) ─────────────────────────────────────────────
export type Member = { emp_code: string; title: string; first_name: string; last_name: string; nickname: string; branch: string; team: TeamId }

const TEAM_WORDS: [RegExp, TeamId][] = [[/ฟ้า|blue/i, "blue"], [/ชมพู|pink/i, "pink"], [/เขียว|green/i, "green"]]
export const teamFromText = (s: string): TeamId | null => TEAM_WORDS.find(([re]) => re.test(s))?.[1] ?? null

/** Validate one member row (admin form). */
export function cleanMember(b: any): Member | string {
  const emp_code = normEmpCode(b?.emp_code)
  if (!emp_code) return "รหัสพนักงานต้องเป็นตัวเลข เช่น 0000"
  const first_name = clean(b?.first_name, 60)
  if (!first_name) return "กรุณากรอกชื่อ"
  const team = String(b?.team ?? "")
  if (!TEAMS.some((t) => t.id === team)) return "กรุณาเลือกสี"
  return { emp_code, title: clean(b?.title, 20), first_name, last_name: clean(b?.last_name, 80), nickname: clean(b?.nickname, 40), branch: clean(b?.branch, 30), team: team as TeamId }
}

/**
 * Rows copied from the Excel draw list (tab separated):
 *   [No.]  ID  คำนำหน้า  ชื่อ  สกุล  ชื่อเล่น  สาขา  สีทีม
 * The No. column is optional. Header rows and empty rows (ID blank) are skipped.
 */
export function parseRoster(text: string): { members: Member[]; skipped: number } {
  const members: Member[] = []
  let skipped = 0
  for (const line of String(text ?? "").split(/\r?\n/)) {
    let cols = line.split("\t").map((c) => c.trim())
    if (!cols.some(Boolean)) continue
    if (cols.length >= 8 && /^\d+$/.test(cols[0]!) && /^\d+$/.test(cols[1] ?? "")) cols = cols.slice(1)
    const [emp_code = "", title = "", first_name = "", last_name = "", nickname = "", branch = "", teamText = ""] = cols
    const team = teamFromText(teamText)
    const m = team && emp_code && first_name ? cleanMember({ emp_code, title, first_name, last_name, nickname, branch, team }) : "skip"
    if (typeof m === "string") skipped++
    else members.push(m)
  }
  return { members, skipped }
}
