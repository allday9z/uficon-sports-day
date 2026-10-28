/* Sports Day organiser page — list, size totals, edit/delete, Excel export, settings. */
"use strict"

const A = { cfg: null, entries: [], settings: null, q: "", team: "" }
const teamOf = (id) => A.cfg.teams.find((t) => t.id === id) || { label: id, color: "#999" }
const when = (iso) => new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

async function boot() {
  try {
    const [cfg, st] = await Promise.all([api("/api/config"), api("/api/admin/status")])
    A.cfg = cfg
    if (st.authed) return loadDashboard()
    renderAuth(st)
  } catch (e) {
    $("#app").innerHTML = `<div class="card center"><h2>เปิดหน้านี้ไม่ได้</h2><p class="muted">${esc(e.message)}</p></div>`
  }
}

// ── sign in / first-time setup ──────────────────────────────────────────────
function renderAuth(st) {
  $("#barActions").innerHTML = ""
  const setup = !st.hasPassword
  $("#app").innerHTML = `
    <form class="card auth" id="authForm" novalidate>
      <h2>${setup ? "ตั้งรหัสผ่านผู้จัดงาน" : "เข้าสู่ระบบผู้จัดงาน"}</h2>
      <p class="muted">${setup ? "ใช้รหัสเริ่มต้นที่ได้รับ ตั้งรหัสผ่านของคุณเอง (ทำได้ครั้งเดียว หลังจากนั้นรหัสเริ่มต้นจะใช้ไม่ได้)" : "ดูรายชื่อ สรุปไซส์ และดาวน์โหลด Excel"}</p>
      ${setup ? `<label class="lbl" for="code">รหัสเริ่มต้น</label><input id="code" class="input" autocomplete="one-time-code" spellcheck="false" required />` : ""}
      <label class="lbl" for="pw">${setup ? "รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)" : "รหัสผ่าน"}</label>
      <input id="pw" type="password" class="input" autocomplete="${setup ? "new-password" : "current-password"}" required />
      ${setup ? `<label class="lbl" for="pw2">ยืนยันรหัสผ่านใหม่</label><input id="pw2" type="password" class="input" autocomplete="new-password" required />` : ""}
      <p class="err" id="authErr" hidden></p>
      <button class="btn primary block" type="submit">${setup ? "ตั้งรหัสผ่านและเข้าสู่ระบบ" : "เข้าสู่ระบบ"}</button>
      <a class="link center-link" href="/">← กลับไปหน้าแบบฟอร์ม</a>
    </form>`
  $(setup ? "#code" : "#pw").focus()
  $("#authForm").onsubmit = async (e) => {
    e.preventDefault()
    const err = $("#authErr")
    err.hidden = true
    const pw = $("#pw").value
    try {
      if (setup) {
        if (pw.length < 8) throw new Error("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร")
        if (pw !== $("#pw2").value) throw new Error("ยืนยันรหัสผ่านไม่ตรงกัน")
        await api("/api/admin/setup", { body: { code: $("#code").value, password: pw } })
      } else {
        await api("/api/admin/login", { body: { password: pw } })
      }
      loadDashboard()
    } catch (ex) {
      err.textContent = ex.message
      err.hidden = false
    }
  }
}

// ── dashboard ───────────────────────────────────────────────────────────────
async function loadDashboard(quiet = false) {
  try {
    const r = await api("/api/admin/entries")
    A.entries = r.entries
    A.settings = r.settings
  } catch (e) {
    if (e.status === 401) return renderAuth({ hasPassword: true })
    if (!quiet) toast(e.message, "bad")
    return
  }
  renderDashboard()
}

function renderDashboard() {
  const { teams, sizes } = A.cfg
  const E = A.entries
  const s = A.settings
  $("#barActions").innerHTML = `
    <a class="btn ghost sm" href="/" target="_blank" rel="noopener">เปิดแบบฟอร์ม ↗</a>
    <button class="btn ghost sm" id="pwBtn">เปลี่ยนรหัสผ่าน</button>
    <button class="btn ghost sm" id="outBtn">ออกจากระบบ</button>`
  $("#pwBtn").onclick = changePassword
  $("#outBtn").onclick = async () => { await api("/api/admin/logout", { body: {} }).catch(() => {}); renderAuth({ hasPassword: true }) }

  const count = (pred) => E.filter(pred).length
  $("#app").innerHTML = `
    <section class="stats">
      <div class="stat total"><span>ส่งแล้วทั้งหมด</span><b>${E.length}</b><small>คน</small></div>
      ${teams.map((t) => `<div class="stat" style="--c:${t.color}"><span>${esc(t.label)}</span><b>${count((x) => x.team === t.id)}</b><small>คน</small></div>`).join("")}
    </section>

    <section class="card settings">
      <div class="set">
        <div><b>รับแบบฟอร์ม</b><p class="muted sm">${s.open ? "เปิดอยู่ — พนักงานส่งได้" : "ปิดอยู่ — พนักงานจะเห็นข้อความปิดรับ"}</p></div>
        <button class="switch${s.open ? " on" : ""}" id="openSw" role="switch" aria-checked="${s.open}" aria-label="เปิดรับแบบฟอร์ม"><i></i></button>
      </div>
      <div class="set">
        <div><b>หมายเลขเสื้อห้ามซ้ำ</b><p class="muted sm">${s.scope === "team" ? "ภายในสีเดียวกัน (คนละสีใช้เลขเดียวกันได้)" : "ทั้งบริษัท (ทุกสีรวมกัน)"}</p></div>
        <div class="seg" role="radiogroup" aria-label="ขอบเขตหมายเลขห้ามซ้ำ">
          <button class="${s.scope === "all" ? "on" : ""}" data-scope="all" role="radio" aria-checked="${s.scope === "all"}">ทั้งบริษัท</button>
          <button class="${s.scope === "team" ? "on" : ""}" data-scope="team" role="radio" aria-checked="${s.scope === "team"}">แยกตามสี</button>
        </div>
      </div>
      <div class="set">
        <div><b>ดาวน์โหลด Excel</b><p class="muted sm">รายชื่อทั้งหมด · สรุปไซส์ต่อสี · แยกชีตตามสี</p></div>
        <a class="btn primary sm" href="/api/admin/export.xlsx">⬇ Excel</a>
      </div>
    </section>

    <section class="card">
      <h3 class="sec-title">สรุปไซส์เสื้อ (สำหรับสั่งผลิต)</h3>
      <div class="table-scroll">
        <table class="tbl sizes-tbl">
          <thead><tr><th>ไซส์</th><th class="dim">อก/ยาว</th>${teams.map((t) => `<th><span class="dot" style="--c:${t.color}"></span>${esc(t.label)}</th>`).join("")}<th>รวม</th></tr></thead>
          <tbody>
            ${sizes.map((z) => {
              const row = teams.map((t) => count((x) => x.size === z.id && x.team === t.id))
              const tot = row.reduce((a, b) => a + b, 0)
              return `<tr class="${tot ? "" : "zero"}"><td><b>${esc(z.id)}</b></td><td class="dim">${z.chest}″/${z.length}″</td>${row.map((n) => `<td>${n || "–"}</td>`).join("")}<td><b>${tot || "–"}</b></td></tr>`
            }).join("")}
          </tbody>
          <tfoot><tr><td>รวม</td><td></td>${teams.map((t) => `<td>${count((x) => x.team === t.id)}</td>`).join("")}<td>${E.length}</td></tr></tfoot>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="list-head">
        <h3 class="sec-title">รายชื่อผู้ส่งแบบฟอร์ม</h3>
        <button class="btn ghost sm" id="reload">↻ รีเฟรช</button>
      </div>
      <div class="filters">
        <input class="input" id="q" placeholder="ค้นหา รหัส ชื่อ ชื่อเล่น หรือหมายเลข" value="${esc(A.q)}" />
        <div class="chips">
          <button class="chip${A.team ? "" : " on"}" data-team="">ทุกสี</button>
          ${teams.map((t) => `<button class="chip${A.team === t.id ? " on" : ""}" data-team="${t.id}" style="--c:${t.color}"><span class="dot"></span>${esc(t.label)}</button>`).join("")}
        </div>
      </div>
      <div id="list"></div>
    </section>`

  $("#openSw").onclick = () => saveSettings({ open: !s.open })
  $$("[data-scope]").forEach((b) => (b.onclick = () => b.dataset.scope !== s.scope && saveSettings({ scope: b.dataset.scope })))
  $("#reload").onclick = () => loadDashboard()
  $("#q").oninput = (e) => { A.q = e.target.value; renderList() }
  $$(".chip").forEach((c) => (c.onclick = () => {
    A.team = c.dataset.team
    $$(".chip").forEach((x) => x.classList.toggle("on", x === c))
    renderList()
  }))
  renderList()
}

function renderList() {
  const needle = A.q.trim().toLowerCase()
  const rows = A.entries.filter((e) => (!A.team || e.team === A.team) && (!needle || `${e.emp_code} ${e.full_name} ${e.nickname} ${e.jersey_no}`.toLowerCase().includes(needle)))
  if (!A.entries.length) {
    $("#list").innerHTML = `<p class="empty">ยังไม่มีใครส่งแบบฟอร์ม</p>`
    return
  }
  if (!rows.length) {
    $("#list").innerHTML = `<p class="empty">ไม่พบรายการที่ค้นหา</p>`
    return
  }
  $("#list").innerHTML = `
    <div class="table-scroll">
      <table class="tbl entries">
        <thead><tr><th>หมายเลข</th><th>ชื่อเล่น</th><th>ชื่อ-นามสกุล</th><th>รหัส</th><th>สี</th><th>ไซส์</th><th>ส่งเมื่อ</th><th></th></tr></thead>
        <tbody>${rows.map((e) => {
          const t = teamOf(e.team)
          return `<tr>
            <td data-l="หมายเลข"><span class="jno" style="--c:${t.color}">${esc(e.jersey_no)}</span></td>
            <td data-l="ชื่อเล่น"><b>${esc(e.nickname)}</b></td>
            <td data-l="ชื่อ-นามสกุล">${esc(e.full_name)}</td>
            <td data-l="รหัส" class="mono">${esc(e.emp_code)}</td>
            <td data-l="สี"><span class="pill" style="--c:${t.color}">${esc(t.label)}</span></td>
            <td data-l="ไซส์"><b>${esc(e.size)}</b></td>
            <td data-l="ส่งเมื่อ" class="dim">${when(e.created_at)}</td>
            <td class="acts"><button class="btn ghost xs" data-edit="${e.id}">แก้ไข</button><button class="btn danger-ghost xs" data-del="${e.id}">ลบ</button></td>
          </tr>`
        }).join("")}</tbody>
      </table>
    </div>
    <p class="muted sm">แสดง ${rows.length} จาก ${A.entries.length} คน</p>`
  $$("[data-edit]").forEach((b) => (b.onclick = () => editEntry(A.entries.find((e) => e.id === Number(b.dataset.edit)))))
  $$("[data-del]").forEach((b) => (b.onclick = () => deleteEntry(A.entries.find((e) => e.id === Number(b.dataset.del)))))
}

async function saveSettings(patch) {
  try {
    const r = await api("/api/admin/settings", { method: "PATCH", body: patch })
    A.settings = r.settings
    renderDashboard()
    toast("บันทึกการตั้งค่าแล้ว", "ok")
  } catch (e) {
    toast(e.message, "bad")
  }
}

function editEntry(e) {
  if (!e) return
  const { teams, sizes, nickMax } = A.cfg
  const close = openModal(`
    <div class="modal-head"><h3>แก้ไขข้อมูล</h3><button class="icon-btn" data-close aria-label="ปิด">✕</button></div>
    <form id="editForm" class="edit-grid" novalidate>
      <label class="lbl">รหัสพนักงาน<input class="input" name="emp_code" value="${esc(e.emp_code)}" maxlength="20" /></label>
      <label class="lbl">ชื่อ-นามสกุล<input class="input" name="full_name" value="${esc(e.full_name)}" maxlength="100" /></label>
      <label class="lbl">สี<select class="input" name="team">${teams.map((t) => `<option value="${t.id}"${t.id === e.team ? " selected" : ""}>${esc(t.label)}</option>`).join("")}</select></label>
      <label class="lbl">ชื่อเล่นบนเสื้อ (ไม่เกิน ${nickMax})<input class="input" name="nickname" value="${esc(e.nickname)}" /></label>
      <label class="lbl">หมายเลข 2 หลัก<input class="input" name="jersey_no" value="${esc(e.jersey_no)}" inputmode="numeric" maxlength="2" /></label>
      <label class="lbl">ไซส์<select class="input" name="size">${sizes.map((z) => `<option${z.id === e.size ? " selected" : ""}>${esc(z.id)}</option>`).join("")}</select></label>
      <p class="err span2" id="editErr" hidden></p>
      <div class="modal-actions span2"><button type="button" class="btn ghost" data-close>ยกเลิก</button><button class="btn primary" type="submit">บันทึก</button></div>
    </form>`)
  $("#editForm").onsubmit = async (ev) => {
    ev.preventDefault()
    const body = Object.fromEntries(new FormData(ev.target))
    try {
      await api(`/api/admin/entries/${e.id}`, { method: "PATCH", body })
      close()
      toast("บันทึกแล้ว", "ok")
      loadDashboard()
    } catch (ex) {
      const p = $("#editErr")
      p.textContent = ex.message
      p.hidden = false
    }
  }
}

function deleteEntry(e) {
  if (!e) return
  const close = openModal(`
    <div class="modal-head"><h3>ลบรายการนี้?</h3><button class="icon-btn" data-close aria-label="ปิด">✕</button></div>
    <p>ลบข้อมูลของ <b>${esc(e.full_name)}</b> (${esc(e.emp_code)}) · ${esc(teamOf(e.team).label)} · หมายเลข <b>${esc(e.jersey_no)}</b></p>
    <p class="muted sm">ลบแล้วกู้คืนไม่ได้ หมายเลข ${esc(e.jersey_no)} จะว่างให้คนอื่นเลือก และพนักงานคนนี้ส่งแบบฟอร์มใหม่ได้</p>
    <div class="modal-actions"><button class="btn ghost" data-close>ยกเลิก</button><button class="btn danger" id="yesDel">ลบ</button></div>`)
  $("#yesDel").onclick = async () => {
    try {
      await api(`/api/admin/entries/${e.id}`, { method: "DELETE" })
      close()
      toast("ลบแล้ว", "ok")
      loadDashboard()
    } catch (ex) {
      toast(ex.message, "bad")
    }
  }
}

function changePassword() {
  const close = openModal(`
    <div class="modal-head"><h3>เปลี่ยนรหัสผ่าน</h3><button class="icon-btn" data-close aria-label="ปิด">✕</button></div>
    <form id="pwForm" novalidate>
      <label class="lbl">รหัสผ่านปัจจุบัน<input class="input" type="password" name="current" autocomplete="current-password" /></label>
      <label class="lbl">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)<input class="input" type="password" name="next" autocomplete="new-password" /></label>
      <p class="muted sm">อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะถูกออกจากระบบ</p>
      <p class="err" id="pwErr" hidden></p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-close>ยกเลิก</button><button class="btn primary" type="submit">บันทึก</button></div>
    </form>`)
  $("#pwForm").onsubmit = async (ev) => {
    ev.preventDefault()
    try {
      await api("/api/admin/password", { body: Object.fromEntries(new FormData(ev.target)) })
      close()
      toast("เปลี่ยนรหัสผ่านแล้ว", "ok")
    } catch (ex) {
      const p = $("#pwErr")
      p.textContent = ex.message
      p.hidden = false
    }
  }
}

// Keep the list fresh while the page is open.
setInterval(() => {
  if (document.visibilityState === "visible" && A.settings && $("#modal").hidden && !document.activeElement?.matches("input, select, textarea")) loadDashboard(true)
}, 30000)

boot()
