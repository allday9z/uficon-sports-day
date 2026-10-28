/* Sports Day organiser page — list, size totals, edit/delete, Excel export, settings. */
"use strict"

const A = { cfg: null, entries: [], members: [], settings: null, q: "", team: "", membersOpen: false }
const teamOf = (id) => A.cfg.teams.find((t) => t.id === id) || { label: id, color: "#999" }
const when = (iso) => new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

async function boot() {
  try {
    const [cfg, st] = await Promise.all([api("/api/config"), api("/api/admin/status")])
    A.cfg = cfg
    if (st.authed) return loadDashboard()
    renderAuth()
  } catch (e) {
    $("#app").innerHTML = `<div class="card center"><h2>เปิดหน้านี้ไม่ได้</h2><p class="muted">${esc(e.message)}</p></div>`
  }
}

// ── no session: this page opens only from the organiser link ─────────────────
function renderAuth() {
  $("#barActions").innerHTML = ""
  $("#app").innerHTML = `
    <div class="card auth center">
      <div class="big-ico">🔗</div>
      <h2>เปิดจากลิงก์ผู้จัดงาน</h2>
      <p class="muted">หน้านี้เปิดได้จากลิงก์ผู้จัดงานที่ได้รับเท่านั้น เปิดลิงก์นั้นครั้งเดียว เบราว์เซอร์นี้จะจำไว้</p>
      <a class="link center-link" href="/">← ไปหน้าแบบฟอร์ม</a>
    </div>`
}

// ── dashboard ───────────────────────────────────────────────────────────────
async function loadDashboard(quiet = false) {
  try {
    const [r, m] = await Promise.all([api("/api/admin/entries"), api("/api/admin/members")])
    A.entries = r.entries
    A.settings = r.settings
    A.members = m.members
  } catch (e) {
    if (e.status === 401) return renderAuth()
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
    <a class="btn ghost sm" href="/" target="_blank" rel="noopener">แบบฟอร์ม ↗</a>
    <a class="btn ghost sm" href="/teams" target="_blank" rel="noopener">สมาชิกแต่ละสี ↗</a>`

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
        <div><b>ดาวน์โหลด Excel</b><p class="muted sm">รายชื่อทั้งหมด · สรุปไซซ์ต่อสี · แยกชีตตามสี</p></div>
        <a class="btn primary sm" href="/api/admin/export.xlsx">⬇ Excel</a>
      </div>
    </section>

    <section class="card">
      <h3 class="sec-title">สรุปไซซ์เสื้อ (สำหรับสั่งผลิต)</h3>
      <div class="table-scroll">
        <table class="tbl sizes-tbl">
          <thead><tr><th>ไซซ์</th><th class="dim">อก/ยาว</th>${teams.map((t) => `<th><span class="dot" style="--c:${t.color}"></span>${esc(t.label)}</th>`).join("")}<th>รวม</th></tr></thead>
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
      ${E.some((e) => e.dup) ? `<p class="alert-bad dup-banner">⚠️ มี ${E.filter((e) => e.dup).length} คนที่หมายเลขซ้ำกับคนที่ส่งก่อน (${E.filter((e) => e.dup).map((e) => `${esc(e.nickname)} ${esc(e.jersey_no)}`).join(", ")}) — ระบบให้คนเหล่านี้เลือกหมายเลขใหม่เมื่อเปิดแบบฟอร์มหรือกรอกรหัส หรือแก้ให้ได้ที่ปุ่ม "แก้ไข"</p>` : ""}
      <div id="list"></div>
    </section>

    <section class="card">
      <div class="list-head">
        <h3 class="sec-title">สมาชิกแต่ละสี (รายชื่อจับฉลาก)</h3>
        <div class="bar-actions"><button class="btn ghost sm" id="addMember">+ เพิ่มสมาชิก</button><button class="btn primary sm" id="pasteMembers">วางรายชื่อจาก Excel</button></div>
      </div>
      <p class="muted sm">ใช้แสดงหน้า <a href="/teams" target="_blank" rel="noopener">สมาชิกแต่ละสี</a> และเติมชื่อกับสีให้อัตโนมัติเมื่อพนักงานกรอกรหัส รหัสที่อยู่ในรายชื่อต้องเลือกสีตามรายชื่อ</p>
      <div class="member-sum">
        ${teams.map((t) => {
          const ms = A.members.filter((m) => m.team === t.id)
          return `<div class="msum" style="--c:${t.color}"><b>${esc(t.label)}</b><span>${ms.length} คน · ส่งฟอร์มแล้ว ${ms.filter((m) => m.sent).length}</span></div>`
        }).join("")}
      </div>
      <details class="members-box" id="membersBox"${A.membersOpen ? " open" : ""}>
        <summary>ดู / แก้ไขรายชื่อ (${A.members.length} คน)</summary>
        <div class="table-scroll">
          <table class="tbl members-tbl">
            <thead><tr><th>สี</th><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ชื่อเล่น</th><th>สาขา</th><th>ฟอร์ม</th><th></th></tr></thead>
            <tbody>${A.members.map((m) => {
              const t = teamOf(m.team)
              return `<tr>
                <td><span class="pill" style="--c:${t.color}">${esc(t.label)}</span></td>
                <td class="mono">${esc(m.emp_code)}</td>
                <td>${esc([m.title, m.first_name, m.last_name].filter(Boolean).join(" "))}</td>
                <td>${esc(m.nickname)}</td>
                <td class="dim">${esc(m.branch)}</td>
                <td>${m.sent ? (m.sent_team === m.team ? '<span class="ok-t">ส่งแล้ว</span>' : '<span class="bad-t">สีไม่ตรง</span>') : '<span class="dim">ยังไม่ส่ง</span>'}</td>
                <td class="acts"><button class="btn ghost xs" data-medit="${m.id}">แก้ไข</button><button class="btn danger-ghost xs" data-mdel="${m.id}">ลบ</button></td>
              </tr>`
            }).join("")}</tbody>
          </table>
        </div>
      </details>
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
  $("#membersBox").ontoggle = (e) => (A.membersOpen = e.target.open)
  $("#pasteMembers").onclick = pasteMembers
  $("#addMember").onclick = () => editMember(null)
  $$("[data-medit]").forEach((b) => (b.onclick = () => editMember(A.members.find((m) => m.id === Number(b.dataset.medit)))))
  $$("[data-mdel]").forEach((b) => (b.onclick = () => deleteMember(A.members.find((m) => m.id === Number(b.dataset.mdel)))))
  renderList()
}

function pasteMembers() {
  const close = openModal(`
    <div class="modal-head"><h3>วางรายชื่อจาก Excel</h3><button class="icon-btn" data-close aria-label="ปิด">✕</button></div>
    <p class="muted sm">เลือกแถวในไฟล์ Excel ตั้งแต่คอลัมน์ ID ถึง สีทีม (ID, คำนำหน้า, ชื่อ, สกุล, ชื่อเล่น, สาขา, สีทีม) แล้วคัดลอกมาวางทุกสีพร้อมกันได้ (สีทีม: ฟ้า / ชมพู / เขียว / ดำ หรือ Host) คอลัมน์ No. และแถวหัวตารางจะถูกข้ามให้เอง</p>
    <textarea class="input paste" id="pasteText" rows="9" placeholder="4&#9;นาย&#9;ธารี&#9;…&#9;ฟ้า"></textarea>
    <p class="muted sm" id="pastePreview"></p>
    <p class="err" id="pasteErr" hidden></p>
    <div class="modal-actions"><button class="btn ghost" data-close>ยกเลิก</button><button class="btn primary" id="pasteGo" disabled>แทนที่รายชื่อเดิมทั้งหมด</button></div>`, { wide: true })
  const ta = $("#pasteText")
  let timer
  ta.oninput = () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const err = $("#pasteErr")
      err.hidden = true
      $("#pasteGo").disabled = true
      $("#pastePreview").textContent = ""
      if (!ta.value.trim()) return
      try {
        const r = await api("/api/admin/members/import", { body: { text: ta.value, dryRun: true } })
        $("#pastePreview").textContent = `พบ ${r.count} คน · ` + r.perTeam.map((x) => `${teamOf(x.id).label} ${x.n}`).join(" · ") + (r.skipped ? ` · ข้าม ${r.skipped} แถว` : "")
        $("#pasteGo").disabled = false
      } catch (e) {
        err.textContent = e.message
        err.hidden = false
      }
    }, 300)
  }
  $("#pasteGo").onclick = async () => {
    try {
      const r = await api("/api/admin/members/import", { body: { text: ta.value } })
      close()
      toast(`บันทึกรายชื่อ ${r.count} คนแล้ว`, "ok")
      loadDashboard()
    } catch (e) {
      toast(e.message, "bad")
    }
  }
}

function editMember(m) {
  const { teams } = A.cfg
  const v = m || { emp_code: "", title: "", first_name: "", last_name: "", nickname: "", branch: "HO", team: teams[0].id }
  const close = openModal(`
    <div class="modal-head"><h3>${m ? "แก้ไขรายชื่อ" : "เพิ่มสมาชิก"}</h3><button class="icon-btn" data-close aria-label="ปิด">✕</button></div>
    <form id="memberForm" class="edit-grid" novalidate>
      <label class="lbl">รหัสพนักงาน<input class="input" name="emp_code" value="${esc(v.emp_code)}" inputmode="numeric" placeholder="0000" /></label>
      <label class="lbl">สี<select class="input" name="team">${teams.map((t) => `<option value="${t.id}"${t.id === v.team ? " selected" : ""}>${esc(t.label)}</option>`).join("")}</select></label>
      <label class="lbl">คำนำหน้า<input class="input" name="title" value="${esc(v.title)}" placeholder="นาย / นางสาว / นาง" /></label>
      <label class="lbl">ชื่อ<input class="input" name="first_name" value="${esc(v.first_name)}" /></label>
      <label class="lbl">สกุล<input class="input" name="last_name" value="${esc(v.last_name)}" /></label>
      <label class="lbl">ชื่อเล่น<input class="input" name="nickname" value="${esc(v.nickname)}" /></label>
      <label class="lbl">สาขา<input class="input" name="branch" value="${esc(v.branch)}" /></label>
      <p class="err span2" id="memberErr" hidden></p>
      <div class="modal-actions span2"><button type="button" class="btn ghost" data-close>ยกเลิก</button><button class="btn primary" type="submit">บันทึก</button></div>
    </form>`)
  $("#memberForm").onsubmit = async (ev) => {
    ev.preventDefault()
    const body = Object.fromEntries(new FormData(ev.target))
    try {
      await api(m ? `/api/admin/members/${m.id}` : "/api/admin/members", { method: m ? "PATCH" : "POST", body })
      close()
      toast("บันทึกแล้ว", "ok")
      loadDashboard()
    } catch (ex) {
      const p = $("#memberErr")
      p.textContent = ex.message
      p.hidden = false
    }
  }
}

function deleteMember(m) {
  if (!m) return
  const close = openModal(`
    <div class="modal-head"><h3>ลบออกจากรายชื่อ?</h3><button class="icon-btn" data-close aria-label="ปิด">✕</button></div>
    <p>ลบ <b>${esc([m.title, m.first_name, m.last_name].filter(Boolean).join(" "))}</b> (${esc(m.emp_code)}) ออกจากรายชื่อ${esc(teamOf(m.team).label)}</p>
    <p class="muted sm">ข้อมูลแบบฟอร์มที่ส่งแล้ว (ถ้ามี) ยังอยู่ ลบเฉพาะจากรายชื่อจับฉลาก</p>
    <div class="modal-actions"><button class="btn ghost" data-close>ยกเลิก</button><button class="btn danger" id="yesMDel">ลบ</button></div>`)
  $("#yesMDel").onclick = async () => {
    try {
      await api(`/api/admin/members/${m.id}`, { method: "DELETE" })
      close()
      toast("ลบแล้ว", "ok")
      loadDashboard()
    } catch (ex) {
      toast(ex.message, "bad")
    }
  }
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
        <thead><tr><th>หมายเลข</th><th>ชื่อเล่น</th><th>ชื่อ-นามสกุล</th><th>รหัส</th><th>สี</th><th>ไซซ์</th><th>ส่งเมื่อ</th><th></th></tr></thead>
        <tbody>${rows.map((e) => {
          const t = teamOf(e.team)
          return `<tr>
            <td data-l="หมายเลข"><span class="jno${e.dup ? " dup" : ""}" style="--c:${t.color}">${esc(e.jersey_no)}</span>${e.dup ? `<span class="dup-tag" title="ซ้ำกับ ${esc(e.dup.nickname)} (${esc(teamOf(e.dup.team).label)}) ที่ส่งก่อน">เลขซ้ำ</span>` : ""}</td>
            <td data-l="ชื่อเล่น"><b>${esc(e.nickname)}</b></td>
            <td data-l="ชื่อ-นามสกุล">${esc(e.full_name)}</td>
            <td data-l="รหัส" class="mono">${esc(e.emp_code)}</td>
            <td data-l="สี"><span class="pill" style="--c:${t.color}">${esc(t.label)}</span></td>
            <td data-l="ไซซ์"><b>${esc(e.size)}</b></td>
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
      <label class="lbl">รหัสพนักงาน<input class="input" name="emp_code" value="${esc(e.emp_code)}" inputmode="numeric" maxlength="6" /></label>
      <label class="lbl">ชื่อ-นามสกุล<input class="input" name="full_name" value="${esc(e.full_name)}" maxlength="100" /></label>
      <label class="lbl">สี<select class="input" name="team">${teams.map((t) => `<option value="${t.id}"${t.id === e.team ? " selected" : ""}>${esc(t.label)}</option>`).join("")}</select></label>
      <label class="lbl">ชื่อเล่นบนเสื้อ (อังกฤษตัวใหญ่ ไม่เกิน ${nickMax})<input class="input" name="nickname" value="${esc(e.nickname)}" /></label>
      <label class="lbl">หมายเลข 2 หลัก<input class="input" name="jersey_no" value="${esc(e.jersey_no)}" inputmode="numeric" maxlength="2" /></label>
      <label class="lbl">ไซซ์<select class="input" name="size">${sizes.map((z) => `<option${z.id === e.size ? " selected" : ""}>${esc(z.id)}</option>`).join("")}</select></label>
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

// Keep the list fresh while the page is open.
setInterval(() => {
  if (document.visibilityState === "visible" && A.settings && $("#modal").hidden && !document.activeElement?.matches("input, select, textarea")) loadDashboard(true)
}, 30000)

boot()
