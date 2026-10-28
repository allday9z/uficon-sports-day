/* Sports Day form — employees fill it in once. */
"use strict"

const EMPTY = { emp_code: "", full_name: "", team: "", nickname: "", jersey_no: "", size: "" }
// edit = the sender's own entry while they change it; member = draw-list match for the typed code
const state = { cfg: null, taken: new Set(), takenFor: null, form: { ...EMPTY }, sending: false, edit: null, member: null }

// This browser's own answer: { id, token } — lets the sender edit, never send twice.
const MINE_KEY = "sd2026_mine"
const loadMine = () => { try { return JSON.parse(localStorage.getItem(MINE_KEY) || "null") } catch { return null } }
const saveMine = (v) => { try { v ? localStorage.setItem(MINE_KEY, JSON.stringify(v)) : localStorage.removeItem(MINE_KEY) } catch { /* private mode */ } }

/** A number is free for me if nobody else has it (my own number while editing counts as free). */
const isTaken = (n) =>
  state.taken.has(n) && !(state.edit && n === state.edit.jersey_no && (state.cfg.scope !== "team" || state.form.team === state.edit.team))
const teamOf = (id) => state.cfg.teams.find((t) => t.id === id)
const graphemes = (s) => [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(s)].length

async function boot() {
  try {
    state.cfg = await api("/api/config")
  } catch (e) {
    $("#app").innerHTML = `<div class="card center"><h2>เปิดแบบฟอร์มไม่ได้</h2><p class="muted">${esc(e.message)}</p><button class="btn" id="retry">ลองใหม่</button></div>`
    $("#retry").onclick = () => location.reload()
    return
  }
  if (!state.cfg.open) {
    $("#app").innerHTML = `<div class="card center"><div class="big-ico">🏁</div><h2>ปิดรับแบบฟอร์มแล้ว</h2><p class="muted">หากมีข้อสงสัย กรุณาติดต่อผู้จัดงาน</p></div>`
    return
  }
  const mine = loadMine()
  if (mine) {
    try {
      const r = await api("/api/entries/mine", { body: mine })
      return renderDone(r.entry)
    } catch (e) {
      if (e.status === 404) saveMine(null)
    }
  }
  renderForm()
  refreshTaken()
}

function renderForm() {
  const { teams, sizes, nickMax } = state.cfg
  $("#app").innerHTML = `
  <form id="form" class="layout" novalidate>
    <div class="card form-card">
      <div class="q" data-field="emp_code">
        <label class="q-title" for="emp_code"><span class="num">1</span>รหัสพนักงาน</label>
        <input id="emp_code" name="emp_code" class="input" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="6" placeholder="เช่น 0000" required ${state.edit ? "readonly" : ""} />
        <p class="hint" id="empHint">${state.edit ? "แก้ไขคำตอบเดิม รหัสพนักงานเปลี่ยนไม่ได้" : "กรอกรหัสแล้ว ระบบจะเติมชื่อและสีจากรายชื่อจับฉลากให้"}</p>
        <p class="err" hidden></p>
      </div>

      <div class="q" data-field="full_name">
        <label class="q-title" for="full_name"><span class="num">2</span>ชื่อจริง-นามสกุล</label>
        <input id="full_name" name="full_name" class="input" autocomplete="name" maxlength="100" placeholder="เช่น สมใจ ใจดี" required />
        <p class="err" hidden></p>
      </div>

      <fieldset class="q" data-field="team">
        <legend class="q-title"><span class="num">3</span>สีที่จับฉลากได้</legend>
        <div class="teams">
          ${teams.map((t) => `
            <label class="team" style="--c:${t.color}">
              <input type="radio" name="team" value="${t.id}" />
              <span class="team-swatch" aria-hidden="true"></span>
              <span class="team-name">${esc(t.label)}</span>
            </label>`).join("")}
        </div>
        <p class="err" hidden></p>
      </fieldset>

      <div class="q" data-field="nickname">
        <label class="q-title" for="nickname"><span class="num">4</span>ชื่อเล่นที่ต้องการสกรีนบนเสื้อ</label>
        <div class="input-count">
          <input id="nickname" name="nickname" class="input" autocomplete="nickname" maxlength="${nickMax * 3}" placeholder="เช่น SMILE" autocapitalize="characters" spellcheck="false" lang="en" required />
          <span class="count" id="nickCount">0/${nickMax}</span>
        </div>
        <p class="hint"><b>ภาษาอังกฤษตัวพิมพ์ใหญ่ทั้งหมด (A–Z)</b> ไม่เกิน ${nickMax} ตัวอักษร · พิมพ์ตัวเล็ก ระบบเปลี่ยนเป็นตัวใหญ่ให้เอง</p>
        <p class="err" hidden></p>
      </div>

      <div class="q" data-field="jersey_no">
        <label class="q-title" for="jersey_no"><span class="num">5</span>หมายเลข 2 หลักด้านหลังเสื้อ</label>
        <div class="no-row">
          <input id="jersey_no" name="jersey_no" class="input no-input" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="2" placeholder="00" required />
          <div class="no-side">
            <p class="no-status" id="noStatus">${state.cfg.scope === "team" ? "หมายเลขห้ามซ้ำกับคนอื่นในสีเดียวกัน" : "หมายเลขห้ามซ้ำกับคนอื่น"}</p>
            <button type="button" class="btn ghost sm" id="pickNo">ดูหมายเลขที่ยังว่าง</button>
          </div>
        </div>
        <p class="hint">ใส่ 2 หลักเสมอ เช่น 07 ไม่ใช่ 7 (00–99)</p>
        <p class="err" hidden></p>
      </div>

      <fieldset class="q" data-field="size">
        <legend class="q-title"><span class="num">6</span>ไซซ์เสื้อ <button type="button" class="link" id="chartBtn">ดูตารางไซซ์</button></legend>
        <p class="hint top">เสื้อโปโล คอปก/จีน กระดุม · หน่วยนิ้ว อาจมีบวก/ลบ 1 นิ้ว</p>
        <div class="sizes">
          ${sizes.map((s) => `
            <label class="size">
              <input type="radio" name="size" value="${esc(s.id)}" />
              <span class="size-id">${esc(s.id)}</span>
              <span class="size-dim">อก ${s.chest}″ · ยาว ${s.length}″</span>
            </label>`).join("")}
        </div>
        <p class="err" hidden></p>
      </fieldset>

      <div class="submit-row">
        <button type="submit" class="btn primary block" id="submitBtn">${state.edit ? "บันทึกการแก้ไข" : "ส่งแบบฟอร์ม"}</button>
        ${state.edit ? '<button type="button" class="btn ghost block cancel" id="cancelEdit">ยกเลิกการแก้ไข</button>' : '<p class="hint center">ส่งได้คนละ 1 ครั้ง ส่งแล้วกลับมาแก้ไขคำตอบได้จากเครื่องนี้</p>'}
      </div>
    </div>

    <aside class="preview-col">
      <div class="card preview">
        <p class="preview-label">ตัวอย่างเสื้อด้านหลัง</p>
        <div id="shirt"></div>
        <p class="preview-sub" id="previewSub">เลือกสี ใส่ชื่อเล่นและหมายเลข เพื่อดูตัวอย่าง</p>
      </div>
    </aside>
  </form>`

  const f = $("#form")
  f.addEventListener("input", onInput)
  f.addEventListener("change", onInput)
  f.addEventListener("submit", onSubmit)
  $("#jersey_no").addEventListener("blur", () => checkNumber(true))
  if (!state.edit) $("#emp_code").addEventListener("blur", lookupMember)
  else $("#cancelEdit").onclick = () => { const e = state.edit; state.edit = null; renderDone(e) }
  // Prefill (editing)
  for (const [k, v] of Object.entries(state.form)) {
    const radios = $$(`input[name="${k}"][type=radio]`)
    if (radios.length) radios.forEach((r) => (r.checked = r.value === v))
    else if ($(`#${k}`)) $(`#${k}`).value = v
  }
  const n = graphemes(state.form.nickname.trim())
  $("#nickCount").textContent = `${n}/${nickMax}`
  $("#pickNo").onclick = openPicker
  $("#chartBtn").onclick = () => openModal(sizeChartHTML(state.cfg.sizes))
  updatePreview()
}

function onInput(e) {
  const el = e.target
  if (!el.name) return
  if (el.name === "jersey_no") el.value = el.value.replace(/\D/g, "").slice(0, 2)
  if (el.name === "emp_code") el.value = el.value.replace(/\D/g, "").slice(0, 6)
  state.form[el.name] = el.type === "radio" ? $(`input[name="${el.name}"]:checked`)?.value ?? "" : el.value
  clearError(el.name)
  if (el.name === "nickname") {
    const pos = el.selectionStart
    el.value = el.value.toUpperCase()
    try { el.setSelectionRange(pos, pos) } catch { /* ignore */ }
    state.form.nickname = el.value
    if (/[^\x00-\x7F]/.test(el.value)) showError("nickname", "ชื่อเล่นบนเสื้อต้องเป็นภาษาอังกฤษเท่านั้น")
    const n = graphemes(el.value.trim())
    const c = $("#nickCount")
    c.textContent = `${n}/${state.cfg.nickMax}`
    c.classList.toggle("over", n > state.cfg.nickMax)
  }
  if (el.name === "team" && state.cfg.scope === "team") refreshTaken()
  if (el.name === "team" && state.member?.found && state.member.team !== el.value) showError("team", `รหัส ${state.member.emp_code} อยู่ใน${teamOf(state.member.team).label}ตามรายชื่อจับฉลาก`)
  if (el.name === "jersey_no" || el.name === "team") checkNumber(false)
  updatePreview()
}

function updatePreview() {
  const { team, nickname, jersey_no, size } = state.form
  const t = team ? teamOf(team) : null
  $("#shirt").innerHTML = shirtSVG({ color: t?.color, nickname: nickname.trim(), number: jersey_no.length === 2 ? jersey_no : "", size })
  const bits = [t?.label, size && `ไซซ์ ${size}`].filter(Boolean)
  $("#previewSub").textContent = bits.length ? bits.join(" · ") : "เลือกสี ใส่ชื่อเล่นและหมายเลข เพื่อดูตัวอย่าง"
}

// ── jersey numbers ──────────────────────────────────────────────────────────
async function refreshTaken() {
  const team = state.cfg.scope === "team" ? state.form.team : ""
  try {
    const r = await api("/api/numbers" + (team ? `?team=${encodeURIComponent(team)}` : ""))
    state.cfg.scope = r.scope
    state.taken = new Set(r.taken)
    state.takenFor = team
  } catch { /* the server checks again on submit */ }
  checkNumber(false)
}

function checkNumber(onBlur) {
  const no = state.form.jersey_no
  const s = $("#noStatus")
  if (!s) return
  s.className = "no-status"
  if (!no) {
    s.textContent = state.cfg.scope === "team" ? "หมายเลขห้ามซ้ำกับคนอื่นในสีเดียวกัน" : "หมายเลขห้ามซ้ำกับคนอื่น"
    return
  }
  if (no.length < 2) {
    s.textContent = "ใส่ให้ครบ 2 หลัก เช่น 0" + no
    if (onBlur) s.classList.add("warn")
    return
  }
  if (state.cfg.scope === "team" && !state.form.team) {
    s.textContent = "เลือกสีก่อน แล้วระบบจะตรวจว่าหมายเลขนี้ว่างไหม"
    return
  }
  if (isTaken(no)) {
    s.textContent = `✕ หมายเลข ${no} มีคนเลือกแล้ว กรุณาเลือกหมายเลขใหม่`
    s.classList.add("bad")
  } else {
    s.textContent = `✓ หมายเลข ${no} ยังว่าง`
    s.classList.add("ok")
  }
}

async function openPicker() {
  if (state.cfg.scope === "team" && !state.form.team) {
    showError("team", "เลือกสีก่อน เพื่อดูหมายเลขที่ว่างในสีนั้น")
    return
  }
  await refreshTaken()
  const t = state.cfg.scope === "team" ? teamOf(state.form.team) : null
  const cells = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"))
  const free = cells.filter((n) => !isTaken(n)).length
  const close = openModal(`
    <div class="modal-head"><h3>เลือกหมายเลขเสื้อ</h3><button class="icon-btn" data-close aria-label="ปิด">✕</button></div>
    <p class="muted">${t ? `เฉพาะ${esc(t.label)} · ` : ""}ว่าง ${free} หมายเลข · หมายเลขสีเทาขีดฆ่า = มีคนเลือกแล้ว</p>
    <div class="grid100">${cells.map((n) => `<button type="button" class="cell${isTaken(n) ? " taken" : ""}${n === state.form.jersey_no ? " mine" : ""}" data-n="${n}" ${isTaken(n) ? 'disabled aria-label="' + n + ' มีคนเลือกแล้ว"' : ""}>${n}</button>`).join("")}</div>`, { wide: true })
  $$(".grid100 .cell:not(.taken)").forEach((b) => (b.onclick = () => {
    const el = $("#jersey_no")
    el.value = b.dataset.n
    el.dispatchEvent(new Event("input", { bubbles: true }))
    close()
  }))
}

// ── validation & submit ─────────────────────────────────────────────────────
function showError(field, msg) {
  const q = $(`.q[data-field="${field}"]`)
  if (!q) return toast(msg, "bad")
  q.classList.add("has-err")
  const p = $(".err", q)
  p.textContent = msg
  p.hidden = false
  q.classList.remove("shake")
  void q.offsetWidth
  q.classList.add("shake")
}
function clearError(field) {
  const q = $(`.q[data-field="${field}"]`)
  if (!q) return
  q.classList.remove("has-err")
  $(".err", q).hidden = true
}

function validate() {
  const f = state.form
  const errs = []
  const code = f.emp_code.trim()
  if (!code) errs.push(["emp_code", "กรุณากรอกรหัสพนักงาน"])
  else if (!/^\d{1,6}$/.test(code)) errs.push(["emp_code", "รหัสพนักงานต้องเป็นตัวเลข เช่น 0000"])
  if (f.full_name.trim().length < 3) errs.push(["full_name", "กรุณากรอกชื่อจริง-นามสกุล"])
  if (!f.team) errs.push(["team", "กรุณาเลือกสีที่จับฉลากได้"])
  const n = graphemes(f.nickname.trim())
  if (!n) errs.push(["nickname", "กรุณากรอกชื่อเล่นที่จะสกรีนบนเสื้อ"])
  else if (n > state.cfg.nickMax) errs.push(["nickname", `ชื่อเล่นบนเสื้อยาวได้ไม่เกิน ${state.cfg.nickMax} ตัวอักษร`])
  else if (!/^[A-Z][A-Z .'\-]*$/.test(f.nickname.trim())) errs.push(["nickname", "ชื่อเล่นบนเสื้อต้องเป็นภาษาอังกฤษตัวพิมพ์ใหญ่เท่านั้น (A–Z เว้นวรรค จุด หรือขีดได้)"])
  if (!/^[0-9]{2}$/.test(f.jersey_no)) errs.push(["jersey_no", "กรุณาใส่หมายเลข 2 หลัก (00–99) เช่น 07"])
  else if (isTaken(f.jersey_no) && (state.cfg.scope !== "team" || state.takenFor === f.team)) errs.push(["jersey_no", `หมายเลข ${f.jersey_no} มีคนเลือกไปแล้ว กรุณาเลือกหมายเลขใหม่`])
  if (!f.size) errs.push(["size", "กรุณาเลือกไซซ์เสื้อ"])
  return errs
}

function focusField(field) {
  const q = $(`.q[data-field="${field}"]`)
  q?.scrollIntoView({ behavior: "smooth", block: "center" })
  const input = q && $("input", q)
  if (input && input.type !== "radio") setTimeout(() => input.focus({ preventScroll: true }), 300)
}

async function onSubmit(e) {
  e.preventDefault()
  if (state.sending) return
  const errs = validate()
  errs.forEach(([f, m]) => showError(f, m))
  if (errs.length) {
    focusField(errs[0][0])
    toast("กรุณาตรวจข้อมูลที่มีเครื่องหมายสีแดง", "bad")
    return
  }
  state.sending = true
  const btn = $("#submitBtn")
  btn.disabled = true
  btn.textContent = "กำลังส่ง…"
  try {
    if (state.edit) {
      const r = await api("/api/entries/mine", { method: "PUT", body: { ...state.form, ...loadMine() } })
      state.edit = null
      renderDone(r.entry, true)
    } else {
      const r = await api("/api/entries", { body: state.form })
      saveMine({ id: r.entry.id, token: r.editToken })
      renderDone(r.entry)
    }
  } catch (err) {
    const d = err.data || {}
    if (d.field === "jersey_no") {
      if (d.taken) { state.taken = new Set(d.taken); state.takenFor = state.form.team }
      checkNumber(true)
      showError("jersey_no", err.message)
      focusField("jersey_no")
      toast(err.message, "bad")
    } else if (d.field) {
      showError(d.field, err.message)
      focusField(d.field)
      toast(err.message, "bad")
    } else {
      toast(err.message, "bad")
    }
  } finally {
    state.sending = false
    if (btn.isConnected) {
      btn.disabled = false
      btn.textContent = state.edit ? "บันทึกการแก้ไข" : "ส่งแบบฟอร์ม"
    }
  }
}

async function lookupMember() {
  const raw = $("#emp_code").value
  if (!raw) return
  const hint = $("#empHint")
  try {
    const r = await api("/api/members/lookup?code=" + encodeURIComponent(raw))
    state.member = r
    if (r.emp_code && r.emp_code !== raw) {
      $("#emp_code").value = r.emp_code
      state.form.emp_code = r.emp_code
    }
    if (r.sent) return showError("emp_code", "รหัสพนักงานนี้ส่งแบบฟอร์มไปแล้ว ส่งซ้ำไม่ได้ หากต้องการแก้ไข ให้เปิดจากเครื่องที่ใช้ส่ง หรือติดต่อผู้จัดงาน")
    if (!r.found) {
      hint.textContent = "ไม่พบรหัสนี้ในรายชื่อจับฉลาก ตรวจรหัสอีกครั้ง หรือกรอกชื่อและเลือกสีเอง"
      return
    }
    const t = teamOf(r.team)
    hint.innerHTML = `พบในรายชื่อ: <b>${esc(r.full_name)}</b> · <span class="pill" style="--c:${t.color}">${esc(t.label)}</span>`
    if (!state.form.full_name.trim()) {
      $("#full_name").value = r.full_name
      state.form.full_name = r.full_name
      clearError("full_name")
    }
    if (!state.form.team || state.form.team !== r.team) {
      const radio = $(`input[name="team"][value="${r.team}"]`)
      radio.checked = true
      radio.dispatchEvent(new Event("change", { bubbles: true }))
    }
    updatePreview()
  } catch { /* lookup is only a helper */ }
}

function startEdit(entry) {
  state.edit = entry
  state.member = null
  state.form = { emp_code: entry.emp_code, full_name: entry.full_name, team: entry.team, nickname: entry.nickname, jersey_no: entry.jersey_no, size: entry.size }
  renderForm()
  refreshTaken()
  window.scrollTo({ top: 0, behavior: "smooth" })
}

function renderDone(entry, edited = false) {
  const t = teamOf(entry.team)
  $("#toast").hidden = true
  window.scrollTo({ top: 0, behavior: "smooth" })
  $("#app").innerHTML = `
    <div class="card done" style="--c:${t.color}">
      <div class="done-badge">✓</div>
      <h2>${edited ? "บันทึกการแก้ไขแล้ว" : "ส่งแบบฟอร์มเรียบร้อย"}</h2>
      <p class="muted">ขอบคุณที่ส่งข้อมูล แล้วเจอกันวัน Sports Day!</p>
      <div class="done-shirt">${shirtSVG({ color: t.color, nickname: entry.nickname, number: entry.jersey_no, size: entry.size })}</div>
      <dl class="summary">
        <dt>รหัสพนักงาน</dt><dd>${esc(entry.emp_code)}</dd>
        <dt>ชื่อ-นามสกุล</dt><dd>${esc(entry.full_name)}</dd>
        <dt>สี</dt><dd><span class="pill" style="--c:${t.color}">${esc(t.label)}</span></dd>
        <dt>ชื่อเล่นบนเสื้อ</dt><dd>${esc(entry.nickname)}</dd>
        <dt>หมายเลข</dt><dd class="mono">${esc(entry.jersey_no)}</dd>
        <dt>ไซซ์</dt><dd>${esc(entry.size)}</dd>
      </dl>
      ${state.cfg.open ? '<button class="btn block edit-btn" id="editMine">✎ แก้ไขคำตอบ</button><p class="hint center">ส่งซ้ำไม่ได้ แต่แก้ไขคำตอบนี้ได้จากเครื่องนี้ จนกว่าจะปิดรับแบบฟอร์ม</p>' : '<p class="hint center">ปิดรับแบบฟอร์มแล้ว ต้องการแก้ไขข้อมูล กรุณาติดต่อผู้จัดงาน</p>'}
    </div>`
  $("#editMine")?.addEventListener("click", () => startEdit(entry))
}

boot()
