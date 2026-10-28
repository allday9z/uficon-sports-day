/* Shared helpers for the form (app.js) and the admin page (admin.js). */
"use strict"

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch])

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  })
  let data = {}
  try { data = await res.json() } catch { /* not json */ }
  if (!res.ok) {
    const err = new Error(data.error || "เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่")
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

let toastTimer
function toast(msg, tone = "") {
  const el = $("#toast")
  el.textContent = msg
  el.className = "toast " + tone
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.hidden = true), 3800)
}

/** Back view of the polo shirt in the team colour, with nickname and number. */
function shirtSVG({ color = "#CBD5E1", nickname = "", number = "", size = "" } = {}) {
  const nick = esc(nickname || "ชื่อเล่น")
  const no = esc(number || "00")
  const nickSize = Math.max(13, Math.min(22, 200 / Math.max(4, [...(nickname || "ชื่อเล่น")].length)))
  const ghost = !nickname || !number ? ' opacity=".55"' : ""
  return `<svg viewBox="0 0 200 222" class="shirt" role="img" aria-label="ตัวอย่างเสื้อด้านหลัง">
    <defs>
      <linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".10"/><stop offset=".22" stop-color="#000" stop-opacity="0"/><stop offset=".78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
    </defs>
    <path d="M70 16 Q100 28 130 16 L170 32 L197 78 L167 95 L156 82 L156 206 Q100 214 44 206 L44 82 L33 95 L3 78 L30 32 Z" fill="${esc(color)}" stroke="rgba(0,0,0,.18)" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M70 16 Q100 28 130 16 L170 32 L197 78 L167 95 L156 82 L156 206 Q100 214 44 206 L44 82 L33 95 L3 78 L30 32 Z" fill="url(#shade)"/>
    <path d="M70 16 Q100 28 130 16 L127 7 Q100 17 73 7 Z" fill="${esc(color)}" stroke="rgba(0,0,0,.25)" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M70 16 Q100 28 130 16 L127 7 Q100 17 73 7 Z" fill="rgba(0,0,0,.14)"/>
    <path d="M167 95 L197 78 M33 95 L3 78" stroke="rgba(0,0,0,.18)" stroke-width="5" stroke-linecap="round"/>
    <g fill="#fff" stroke="rgba(0,0,0,.18)" stroke-width=".8" paint-order="stroke" text-anchor="middle" font-family="Kanit, 'Noto Sans Thai', sans-serif" font-weight="700"${ghost}>
      <text x="100" y="72" font-size="${nickSize.toFixed(1)}" letter-spacing=".5">${nick}</text>
      <text x="100" y="160" font-size="82" letter-spacing="-2">${no}</text>
    </g>
    ${size ? `<text x="100" y="196" text-anchor="middle" font-family="Kanit, sans-serif" font-size="11" fill="rgba(255,255,255,.85)">${esc(size)}</text>` : ""}
  </svg>`
}

function openModal(html, { wide = false } = {}) {
  const back = $("#modal")
  const box = $("#modalBox")
  box.className = "modal" + (wide ? " wide" : "")
  box.innerHTML = html
  back.hidden = false
  document.body.classList.add("no-scroll")
  const close = () => {
    back.hidden = true
    box.innerHTML = ""
    document.body.classList.remove("no-scroll")
    document.removeEventListener("keydown", onKey)
  }
  const onKey = (e) => e.key === "Escape" && close()
  document.addEventListener("keydown", onKey)
  back.onclick = (e) => e.target === back && close()
  $$("[data-close]", box).forEach((b) => (b.onclick = close))
  return close
}

function sizeChartHTML(sizes) {
  return `<div class="modal-head"><h3>ตารางไซซ์เสื้อ</h3><button class="icon-btn" data-close aria-label="ปิด">✕</button></div>
    <p class="muted">เสื้อโปโล คอปก/จีน กระดุม · หน่วยเป็นนิ้ว อาจมีบวก/ลบ 1 นิ้ว</p>
    <table class="chart"><thead><tr><th>ไซซ์</th><th>รอบอก</th><th>ความยาว</th></tr></thead>
    <tbody>${sizes.map((s) => `<tr><td><b>${esc(s.id)}</b></td><td>${s.chest}</td><td>${s.length}</td></tr>`).join("")}</tbody></table>
    <details class="chart-img"><summary>ดูรูปตารางไซซ์ต้นฉบับ</summary><img src="/size-chart.jpg" alt="ตารางไซซ์เสื้อโปโล คอปก/จีน กระดุม" loading="lazy"></details>`
}
