/* เลขที่เหลือ — which jersey numbers 00–99 are still free (Smile, 29 Oct 2026). */
"use strict"

const N = { board: null, tab: "", at: null }
const ALL = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, "0"))

async function load() {
  try {
    N.board = await api("/api/numbers/board")
    N.at = new Date()
  } catch (e) {
    if (!N.board) {
      $("#app").innerHTML = `<div class="card center"><h2>โหลดหมายเลขไม่ได้</h2><p class="muted">${esc(e.message)}</p><button class="btn" id="retry">ลองใหม่</button></div>`
      $("#retry").onclick = () => location.reload()
    }
    return
  }
  if (!N.tab || !N.board.teams.some((t) => t.id === N.tab)) N.tab = N.board.teams[0].id
  render()
}

function render() {
  const { scope, teams, taken } = N.board
  const perTeam = scope === "team"
  const team = teams.find((t) => t.id === N.tab)
  const holder = new Map(taken.filter((x) => !perTeam || x.team === N.tab).map((x) => [x.no, x.team]))
  const free = ALL.filter((n) => !holder.has(n))
  const colour = (id) => teams.find((t) => t.id === id)
  const time = N.at.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })

  $("#app").innerHTML = `
    <div class="card no-board">
      ${perTeam ? `<div class="seg no-tabs" role="tablist">${teams.map((t) => `<button role="tab" data-tab="${t.id}" class="${t.id === N.tab ? "on" : ""}" aria-selected="${t.id === N.tab}" style="--c:${t.color}"><span class="dot"></span>${esc(t.label)}</button>`).join("")}</div>` : ""}
      <div class="no-sum">
        <div><span class="no-big">${free.length}</span><span class="no-of">/ 100</span></div>
        <div>
          <h2>หมายเลขที่ยังเหลือ${perTeam ? "ใน" + esc(team.label) : ""}</h2>
          <p class="muted">${perTeam ? "แต่ละสีใช้หมายเลขซ้ำกับสีอื่นได้" : "หมายเลขห้ามซ้ำกันทุกสี"} · มีคนเลือกแล้ว ${100 - free.length} · ข้อมูล ณ ${time} น.</p>
        </div>
      </div>
      <div class="no-legend">
        <span><i class="lg free"></i>ยังว่าง — กดเพื่อไปกรอกแบบฟอร์มด้วยหมายเลขนี้</span>
        <span><i class="lg used"></i>มีคนเลือกแล้ว (แถบสี = สีของคนที่เลือก)</span>
      </div>
      <div class="grid100 board">${ALL.map((n) => {
        const h = holder.get(n)
        return h
          ? `<span class="cell taken" style="--c:${colour(h)?.color ?? "#9CA3AF"}" title="${n} — ${esc(colour(h)?.label ?? "")} เลือกแล้ว">${n}</span>`
          : `<a class="cell free" href="/?no=${n}" title="${n} ยังว่าง">${n}</a>`
      }).join("")}</div>
    </div>
    <div class="card no-list">
      <div class="no-list-head">
        <h3>รายการหมายเลขที่ยังว่าง (${free.length})</h3>
        ${free.length ? '<button type="button" class="btn ghost sm" id="copy">คัดลอก</button>' : ""}
      </div>
      <p class="free-text" id="freeText">${free.length ? free.join(" ") : "หมายเลขเต็มแล้ว"}</p>
    </div>`

  $$("[data-tab]").forEach((b) => (b.onclick = () => { N.tab = b.dataset.tab; render() }))
  const copy = $("#copy")
  if (copy) copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(free.join(" "))
      toast("คัดลอกหมายเลขที่ว่างแล้ว", "ok")
    } catch {
      getSelection().selectAllChildren($("#freeText"))
    }
  }
}

load()
// Stay current while the page is open (others keep sending the form).
setInterval(() => document.visibilityState === "visible" && load(), 30_000)
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && load())
