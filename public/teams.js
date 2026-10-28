/* สมาชิกแต่ละสี — the draw list per colour, with who has sent the shirt form. */
"use strict"

const T = { teams: [], q: "", tab: "blue" }

async function boot() {
  try {
    T.teams = (await api("/api/members")).teams
  } catch (e) {
    $("#app").innerHTML = `<div class="card center"><h2>โหลดรายชื่อไม่ได้</h2><p class="muted">${esc(e.message)}</p><button class="btn" id="retry">ลองใหม่</button></div>`
    $("#retry").onclick = () => location.reload()
    return
  }
  try { T.tab = sessionStorage.getItem("sd_tab") || T.tab } catch { /* ignore */ }
  render()
}

function render() {
  const total = T.teams.reduce((n, t) => n + t.members.length, 0)
  if (!total) {
    $("#app").innerHTML = `<div class="card center"><div class="big-ico">📋</div><h2>ยังไม่มีรายชื่อ</h2><p class="muted">ผู้จัดงานกำลังเพิ่มรายชื่อสมาชิกแต่ละสี</p></div>`
    return
  }
  $("#app").innerHTML = `
    <div class="card teams-tools">
      <input class="input" id="q" placeholder="ค้นหาชื่อ หรือชื่อเล่น" value="${esc(T.q)}" />
      <div class="seg team-tabs" role="tablist">
        ${T.teams.map((t) => `<button role="tab" data-tab="${t.id}" class="${T.tab === t.id ? "on" : ""}" aria-selected="${T.tab === t.id}" style="--c:${t.color}"><span class="dot"></span>${esc(t.label)}</button>`).join("")}
      </div>
    </div>
    <div class="team-cols" id="cols"></div>`
  $("#q").oninput = (e) => { T.q = e.target.value; renderCols() }
  $$("[data-tab]").forEach((b) => (b.onclick = () => {
    T.tab = b.dataset.tab
    try { sessionStorage.setItem("sd_tab", T.tab) } catch { /* ignore */ }
    $$("[data-tab]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b) })
    renderCols()
  }))
  renderCols()
}

function renderCols() {
  const needle = T.q.trim().toLowerCase()
  $("#cols").innerHTML = T.teams.map((t) => {
    const sent = t.members.filter((m) => m.sent).length
    const rows = t.members.map((m, i) => ({ ...m, n: i + 1 })).filter((m) => !needle || `${m.name} ${m.nickname}`.toLowerCase().includes(needle))
    return `
      <section class="team-col${T.tab === t.id ? " active" : ""}${t.id === "host" ? " host" : ""}" style="--c:${t.color}">
        <header class="team-head">
          <h2>${esc(t.label)}</h2>
          <span>${t.members.length} คน · ส่งฟอร์มแล้ว ${sent}</span>
          <div class="progress" aria-hidden="true"><i style="width:${t.members.length ? Math.round((sent / t.members.length) * 100) : 0}%"></i></div>
        </header>
        ${rows.length ? `<table class="roster">
          <thead><tr><th>No.</th><th>ชื่อ-สกุล</th><th>ชื่อเล่น</th><th>สาขา</th><th title="หมายเลขเสื้อ">เบอร์</th></tr></thead>
          <tbody>${rows.map((m) => `<tr>
            <td class="n">${m.n}</td>
            <td class="nm">${esc(m.name)}${m.extra && t.id !== "host" ? ' <span class="tag">เพิ่มเติม</span>' : ""}${m.dup ? ' <span class="dup-tag">เลขซ้ำ เลือกใหม่</span>' : ""}</td>
            <td>${esc(m.nickname)}</td>
            <td class="br">${esc(m.branch)}</td>
            <td>${m.sent ? `<span class="jno sm${m.dup ? " dup" : ""}"${m.dup ? ' title="หมายเลขซ้ำกับคนที่ส่งก่อน ต้องเลือกหมายเลขใหม่"' : ""}>${esc(m.jersey_no)}</span>` : '<span class="wait" title="ยังไม่ส่งแบบฟอร์ม">–</span>'}</td>
          </tr>`).join("")}</tbody>
        </table>` : `<p class="empty">${needle ? "ไม่พบชื่อที่ค้นหา" : "ยังไม่มีคนส่งแบบฟอร์ม"}</p>`}
      </section>`
  }).join("")
}

boot()
