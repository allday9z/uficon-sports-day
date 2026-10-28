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

export const NICK_MAX = 12

/** Validate one form; returns the cleaned entry or the first problem. */
export function cleanEntry(b: any): Entry | Problem {
  const emp_code = clean(b?.emp_code, 20).toUpperCase()
  if (!emp_code) return { field: "emp_code", error: "กรุณากรอกรหัสพนักงาน" }
  if (!/^[A-Z0-9][A-Z0-9\-_/.]{0,19}$/.test(emp_code)) return { field: "emp_code", error: "รหัสพนักงานใช้ได้เฉพาะตัวอักษรอังกฤษและตัวเลข (ไม่เกิน 20 ตัว)" }

  const full_name = clean(b?.full_name, 100)
  if (full_name.length < 3) return { field: "full_name", error: "กรุณากรอกชื่อจริง-นามสกุล" }
  if (full_name.length > 100) return { field: "full_name", error: "ชื่อ-นามสกุลยาวเกินไป" }
  if (!/^[\p{L}\p{M} .'\-()]+$/u.test(full_name)) return { field: "full_name", error: "ชื่อ-นามสกุลมีอักขระที่ใช้ไม่ได้" }

  const team = String(b?.team ?? "")
  if (!TEAMS.some((t) => t.id === team)) return { field: "team", error: "กรุณาเลือกสีที่จับฉลากได้" }

  const nickname = clean(b?.nickname, 40)
  if (!nickname) return { field: "nickname", error: "กรุณากรอกชื่อเล่นที่จะสกรีนบนเสื้อ" }
  if (chars(nickname) > NICK_MAX) return { field: "nickname", error: `ชื่อเล่นบนเสื้อยาวได้ไม่เกิน ${NICK_MAX} ตัวอักษร` }
  if (!/^[\p{L}\p{M}\p{N} .'\-]+$/u.test(nickname)) return { field: "nickname", error: "ชื่อเล่นใช้ได้เฉพาะตัวอักษร ตัวเลข เว้นวรรค จุด และขีด" }

  const jersey_no = String(b?.jersey_no ?? "").trim()
  if (!/^[0-9]{2}$/.test(jersey_no)) return { field: "jersey_no", error: "หมายเลขเสื้อต้องเป็นตัวเลข 2 หลัก (00–99) เช่น 07" }

  const size = String(b?.size ?? "")
  if (!SIZES.some((s) => s.id === size)) return { field: "size", error: "กรุณาเลือกไซส์เสื้อ" }

  return { emp_code, full_name, team: team as TeamId, nickname, jersey_no, size }
}
