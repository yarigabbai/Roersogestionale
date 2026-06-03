// =====================================================================
// app.js — router, auth, schermate
// =====================================================================

let CURRENT_USER = null;
const ANNO_CORRENTE = new Date().getFullYear();
const STATE = {
  primanota: { page: 1, pageSize: 50, sortBy: "data", sortDir: "asc", filtri: {} },
  match: { selectedMov: null, anno: ANNO_CORRENTE, mese: null, conto: "BPE" },
};
let CACHE_ENTI = [];
let CACHE_PROGETTI = [];
function progettiNomi() {
  return CACHE_PROGETTI.length ? CACHE_PROGETTI.map(p => p.nome) : (window.UI?.PROGETTI || []);
}

// === FLASH ===
function flash(msg, tipo = "success", ms = 4000) {
  const c = document.getElementById("flash-container");
  const el = document.createElement("div");
  el.className = "flash " + tipo;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
window.flash = flash;

// === MODAL ===
function openModal({ title, body, onSave, saveLabel = "Salva", showFooter = true, wide = false }) {
  const host = document.getElementById("modal-host");
  host.innerHTML = "";
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" ${wide ? 'style="max-width:1100px"' : ""}>
      <div class="modal-header"><h2></h2><button class="close-btn" type="button">×</button></div>
      <div class="modal-body"></div>
      ${showFooter ? `<div class="modal-footer">
        <button class="secondary" data-act="cancel">Annulla</button>
        <button data-act="save">${saveLabel}</button>
      </div>` : ""}
    </div>`;
  overlay.querySelector(".modal-header h2").textContent = title;
  const bodyEl = overlay.querySelector(".modal-body");
  if (typeof body === "string") bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const close = () => host.innerHTML = "";
  overlay.querySelector(".close-btn").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  if (showFooter) {
    overlay.querySelector('[data-act="cancel"]').addEventListener("click", close);
    overlay.querySelector('[data-act="save"]').addEventListener("click", async () => {
      if (onSave) {
        try {
          const r = await onSave(bodyEl);
          if (r !== false) close();
        } catch (e) { flash(e.message || "Errore", "error", 6000); }
      } else close();
    });
  }
  host.appendChild(overlay);
  return { close, body: bodyEl };
}
window.openModal = openModal;
const confirm2 = (msg) => window.confirm(msg);

// === LOGIN / SHELL ===
function showLogin() {
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("app-shell").style.display = "none";
}
async function showApp() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app-shell").style.display = "flex";
  document.getElementById("sb-user-name").textContent = CURRENT_USER.nome;
  document.getElementById("sb-user-ruolo").textContent = "Ruolo: " + CURRENT_USER.ruolo;
  document.getElementById("sb-anno").textContent = "Anno " + ANNO_CORRENTE;
  document.querySelectorAll("[data-admin-only]").forEach(a => {
    a.style.display = CURRENT_USER.ruolo === "admin" ? "" : "none";
  });
  await preloadEnti();
  await preloadProgetti();
  if (!location.hash) location.hash = "#dashboard"; else router();
}

function setupLogin() {
  document.getElementById("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    try {
      await window.SB.login(email, password);
      CURRENT_USER = await window.SB.currentUser();
      if (!CURRENT_USER) throw new Error("Utente non trovato dopo il login");
      flash("Benvenuto " + CURRENT_USER.nome, "success");
      showApp();
    } catch (err) {
      flash(err.message || "Login fallito", "error", 6000);
    }
  });
  document.getElementById("btn-logout").addEventListener("click", async () => {
    await window.SB.logout();
    CURRENT_USER = null;
    showLogin();
  });
}

// === ROUTER ===
const ROUTES = {
  "dashboard": renderDashboard,
  "primanota": renderPrimanota,
  "nuovo-movimento": renderNuovoMovimento,
  "modifica-movimento": renderModificaMovimento,
  "nuovo-movimento-figlio": (rest) => renderFormMovimento(null, rest && rest[0]),
  "analizza-pdf": () => window.AI_SCREEN?.render?.(),
  "documenti": renderDocumenti,
  "abbinamento": renderAbbinamento,
  "enti": renderEnti,
  "rendicontazione": renderRendicontazione,
  "note-spese": renderNoteSpese,
  "export": () => window.EXPORT_SCREEN?.render?.(),
  "impostazioni": renderImpostazioni,
};
function router() {
  if (!CURRENT_USER) return;
  const hash = (location.hash || "#dashboard").substring(1);
  const [route, ...rest] = hash.split("/");
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".sidebar nav a").forEach(a => a.classList.remove("active"));
  let target = ROUTES[route] ? route : "dashboard";
  // Route admin-only: impostazioni, analizza-pdf
  if (["impostazioni", "analizza-pdf"].includes(target) && CURRENT_USER.ruolo !== "admin") {
    flash("Sezione riservata agli amministratori", "warning");
    target = "dashboard";
  }

  // Alcune route condividono la sezione DOM:
  // - modifica-movimento usa sec-nuovo-movimento (stesso form)
  const sectionMap = { "modifica-movimento": "nuovo-movimento", "nuovo-movimento-figlio": "nuovo-movimento" };
  const sectionId = "sec-" + (sectionMap[target] || target);
  const sec = document.getElementById(sectionId);
  if (sec) sec.classList.add("active");

  // Il link sidebar attivo è quello principale (non quello "modifica")
  const linkRoute = sectionMap[target] || target;
  const link = document.querySelector(`.sidebar nav a[data-route="${linkRoute}"]`);
  if (link) link.classList.add("active");

  Promise.resolve(ROUTES[target](rest)).catch(e => flash(e.message || "Errore", "error", 6000));
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", router);

// === HELPERS ===
async function preloadEnti() {
  try { CACHE_ENTI = await window.SB.getEnti(); } catch { CACHE_ENTI = []; }
}
async function preloadProgetti() {
  try { CACHE_PROGETTI = await window.SB.getProgetti({ soloAttivi: true }); } catch { CACHE_PROGETTI = []; }
}

// =====================================================================
// DASHBOARD
// =====================================================================
async function renderDashboard() {
  const cont = document.getElementById("dashboard-content");
  cont.innerHTML = `<div class="empty"><span class="spinner"></span> Caricamento...</div>`;

  const annoCorr = ANNO_CORRENTE;
  const meseCorr = new Date().getMonth() + 1;
  const { fmtImporto, fmtData, escapeHtml } = window.UI;

  const [annoData, meseData, daAbb] = await Promise.all([
    window.SB.getMovimenti({ anno: annoCorr, size: 5000, page: 1 }),
    window.SB.getMovimenti({ anno: annoCorr, mese: meseCorr, size: 5000, page: 1 }),
    window.SB.getMovimenti({ stato: "In lavorazione", size: 1, page: 1 }),
  ]);

  const movs = annoData.movimenti || [];
  const saldoBPE = movs.filter(m => m.metodo === "BPE")
    .reduce((s, m) => s + (m.tipo === "ENTRATA" ? +m.importo : -m.importo), 0);
  const meseMovs = meseData.movimenti || [];
  const totEntrate = meseMovs.filter(m => m.tipo === "ENTRATA").reduce((s, m) => s + +m.importo, 0);
  const totUscite  = meseMovs.filter(m => m.tipo === "USCITA").reduce((s, m) => s + +m.importo, 0);

  // Grafico mensile
  const monthly = Array.from({ length: 12 }, (_, i) => ({ mese: i + 1, in: 0, out: 0 }));
  movs.forEach(m => {
    const idx = parseInt(String(m.data).slice(5, 7), 10) - 1;
    if (m.tipo === "ENTRATA") monthly[idx].in += +m.importo;
    else monthly[idx].out += +m.importo;
  });
  const maxVal = Math.max(1, ...monthly.flatMap(x => [x.in, x.out]));
  const ML = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];

  // Scadenze rendicontazione
  const oggi = new Date();
  const scadenze = (CACHE_ENTI || [])
    .filter(e => e.scadenza_rendicontazione && e.attivo)
    .map(e => {
      const d = new Date(e.scadenza_rendicontazione);
      const giorni = Math.round((d - oggi) / 86400000);
      return { ...e, giorni };
    })
    .filter(e => e.giorni > -60)
    .sort((a, b) => a.giorni - b.giorni);

  const last5 = movs.slice(0, 5);

  cont.innerHTML = `
    <div class="cards-grid">
      <div class="card"><div class="label">Saldo BPE ${annoCorr}</div>
        <div class="value ${saldoBPE >= 0 ? '' : 'uscita'}">${fmtImporto(saldoBPE)}</div></div>
      <div class="card"><div class="label">Da abbinare</div>
        <div class="value">${daAbb.total}${daAbb.total > 0 ? '<span class="badge">!</span>' : ''}</div></div>
      <div class="card"><div class="label">Uscite ${ML[meseCorr-1]}</div>
        <div class="value uscita">${fmtImporto(totUscite)}</div></div>
      <div class="card"><div class="label">Entrate ${ML[meseCorr-1]}</div>
        <div class="value entrata">${fmtImporto(totEntrate)}</div></div>
    </div>

    ${scadenze.length ? `
    <div class="chart-card">
      <h3>Scadenze rendicontazioni</h3>
      <div class="scadenze-grid">
        ${scadenze.map(s => {
          const cls = s.giorni < 30 ? "urgente" : s.giorni < 90 ? "medio" : "lontano";
          return `<div class="scadenza-card ${cls}">
            <div class="ente">${escapeHtml(s.nome)}</div>
            <div class="data">${fmtData(s.scadenza_rendicontazione)}</div>
            <div class="giorni">${s.giorni >= 0 ? s.giorni : 0} giorni</div>
          </div>`;
        }).join("")}
      </div>
    </div>` : ""}

    <div class="chart-card">
      <h3>Andamento mensile ${annoCorr}</h3>
      <div class="chart-bars">
        ${monthly.map((m, i) => `
          <div class="chart-month">
            <div class="chart-bar-pair">
              <div class="chart-bar entrata" style="height:${(m.in/maxVal)*100}%" title="Entrate ${ML[i]}: ${fmtImporto(m.in)}"></div>
              <div class="chart-bar uscita"  style="height:${(m.out/maxVal)*100}%" title="Uscite ${ML[i]}: ${fmtImporto(m.out)}"></div>
            </div>
            <div class="chart-month-label">${ML[i]}</div>
          </div>`).join("")}
      </div>
      <div class="chart-legend">
        <div class="item"><div class="swatch" style="background:var(--verde)"></div> Entrate</div>
        <div class="item"><div class="swatch" style="background:var(--rosso)"></div> Uscite</div>
      </div>
    </div>

    <div class="chart-card" id="anomalie-card" style="display:none">
      <h3>⚠️ Punti di domanda automatici</h3>
      <div id="anomalie-list"></div>
    </div>

    <div class="chart-card">
      <h3>Ultimi 5 movimenti</h3>
      ${last5.length ? `<div class="table-wrap" style="border:none;box-shadow:none"><table>
        <thead><tr><th>Progr.</th><th>Data</th><th>Descrizione</th><th>Cat.</th><th class="num">Importo</th></tr></thead>
        <tbody>${last5.map(m => `<tr>
          <td>${escapeHtml(m.progressivo)}</td>
          <td>${fmtData(m.data)}</td>
          <td>${escapeHtml((m.descrizione||"").substring(0,80))}</td>
          <td>${m.categoria||""}</td>
          <td class="num ${m.tipo==='ENTRATA'?'importo-entrata':'importo-uscita'}">${m.tipo==='ENTRATA'?'+':'−'} ${fmtImporto(m.importo)}</td>
        </tr>`).join("")}</tbody></table></div>` : `<div class="empty">Nessun movimento ancora.</div>`}
    </div>
  `;

  // Carica anomalie calcolate (async, non blocca il render principale)
  try {
    const anom = await window.SB.getAnomalieCalcolate();
    if (anom.length) {
      const card = document.getElementById("anomalie-card");
      const list = document.getElementById("anomalie-list");
      card.style.display = "";
      list.innerHTML = anom.slice(0, 10).map(a => `
        <div style="padding:8px 10px;border-left:3px solid var(--arancio);background:#fff8e1;margin-bottom:6px;border-radius:4px">
          <strong>${escapeHtml(a.tipo_anomalia)}</strong>
          <div style="font-size:12px;color:var(--grigio-testo)">${escapeHtml(a.descrizione)}</div>
        </div>
      `).join("");
      if (anom.length > 10) {
        list.innerHTML += `<p class="text-muted text-center" style="font-size:12px">... e altre ${anom.length - 10} anomalie</p>`;
      }
    }
  } catch {}
}

// =====================================================================
// PRIMA NOTA
// =====================================================================
async function renderPrimanota() {
  const cont = document.getElementById("primanota-content");
  const { fmtImporto, fmtData, escapeHtml, CATEGORIE, METODI } = window.UI;
  const PROGETTI = progettiNomi();
  if (!CACHE_ENTI.length) await preloadEnti();
  const f = STATE.primanota.filtri;
  const anni = [ANNO_CORRENTE - 1, ANNO_CORRENTE, ANNO_CORRENTE + 1];

  cont.innerHTML = `
    <div class="filters">
      <div class="filter-group"><label>Anno</label>
        <select id="f-anno"><option value="">Tutti</option>
          ${anni.map(a=>`<option value="${a}" ${+f.anno===a?"selected":""}>${a}</option>`).join("")}</select></div>
      <div class="filter-group"><label>Mese</label>
        <select id="f-mese"><option value="">Tutti</option>
          ${["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"]
            .map((m,i)=>`<option value="${i+1}" ${+f.mese===i+1?"selected":""}>${m}</option>`).join("")}</select></div>
      <div class="filter-group"><label>Tipo</label>
        <select id="f-tipo"><option value="">Tutti</option>
          <option value="ENTRATA" ${f.tipo==="ENTRATA"?"selected":""}>Entrata</option>
          <option value="USCITA" ${f.tipo==="USCITA"?"selected":""}>Uscita</option></select></div>
      <div class="filter-group"><label>Categoria</label>
        <select id="f-cat"><option value="">Tutte</option>
          ${Object.keys(CATEGORIE).map(c=>`<option value="${c}" ${f.categoria===c?"selected":""}>${c}</option>`).join("")}</select></div>
      <div class="filter-group"><label>Metodo</label>
        <select id="f-metodo"><option value="">Tutti</option>
          ${METODI.map(m=>`<option value="${m}" ${f.metodo===m?"selected":""}>${m}</option>`).join("")}</select></div>
      <div class="filter-group"><label>Progetto</label>
        <select id="f-progetto"><option value="">Tutti</option>
          ${PROGETTI.map(p=>`<option value="${p}" ${f.progetto===p?"selected":""}>${p}</option>`).join("")}</select></div>
      <div class="filter-group"><label>Stato</label>
        <select id="f-stato"><option value="">Tutti</option>
          <option value="Manca doc"    ${f.stato==="Manca doc"?"selected":""}>🟡 Manca documento</option>
          <option value="Attesa EC"    ${f.stato==="Attesa EC"?"selected":""}>🟠 Attesa EC</option>
          <option value="Cassa"        ${f.stato==="Cassa"?"selected":""}>🔵 Cassa</option>
          <option value="No doc"       ${f.stato==="No doc"?"selected":""}>⚪ No doc</option>
          <option value="Accoppiato"   ${f.stato==="Accoppiato"?"selected":""}>🟢 Accoppiato</option>
          <option value="Vuoto"        ${f.stato==="Vuoto"?"selected":""}>⛔ Vuoto</option>
        </select></div>
      <div class="filter-group"><label>Ricerca</label>
        <input id="f-testo" type="text" placeholder="Descr., fornitore, progr..." value="${escapeHtml(f.testo||'')}" /></div>
      <div class="filter-group"><label>&nbsp;</label>
        <button class="secondary" id="btn-azzera">Azzera</button></div>
    </div>
    <div id="pn-table-wrap"><div class="empty"><span class="spinner"></span> Caricamento...</div></div>
  `;
  ["f-anno","f-mese","f-tipo","f-cat","f-metodo","f-progetto","f-stato"].forEach(id =>
    document.getElementById(id).addEventListener("change", primanotaApply));
  let timer;
  document.getElementById("f-testo").addEventListener("input", () => {
    clearTimeout(timer); timer = setTimeout(primanotaApply, 250);
  });
  document.getElementById("btn-azzera").addEventListener("click", () => {
    STATE.primanota.filtri = {}; STATE.primanota.page = 1; renderPrimanota();
  });
  await primanotaLoad();
}

function primanotaApply() {
  const v = id => document.getElementById(id).value;
  const f = {};
  if (v("f-anno"))     f.anno = parseInt(v("f-anno"), 10);
  if (v("f-mese"))     f.mese = parseInt(v("f-mese"), 10);
  if (v("f-tipo"))     f.tipo = v("f-tipo");
  if (v("f-cat"))      f.categoria = v("f-cat");
  if (v("f-metodo"))   f.metodo = v("f-metodo");
  if (v("f-progetto")) f.progetto = v("f-progetto");
  if (v("f-stato"))    f.stato = v("f-stato");
  if (v("f-testo").trim()) f.testo = v("f-testo").trim();
  STATE.primanota.filtri = f;
  STATE.primanota.page = 1;
  primanotaLoad();
}

async function primanotaLoad() {
  const { sortBy, sortDir, page, pageSize, filtri } = STATE.primanota;
  const r = await window.SB.getMovimenti({ ...filtri, page, size: pageSize, sortBy, sortDir });
  primanotaRender(r);
}

function primanotaRender(r) {
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  const movs = r.movimenti || [];
  const totPages = Math.max(1, Math.ceil(r.total / r.size));
  const isAdmin = CURRENT_USER.ruolo === "admin";
  const canEdit = isAdmin || CURRENT_USER.ruolo === "editor";

  // Totali sui movimenti caricati
  const totE = movs.filter(m => m.tipo === "ENTRATA").reduce((s, m) => s + +m.importo, 0);
  const totU = movs.filter(m => m.tipo === "USCITA").reduce((s, m) => s + +m.importo, 0);

  const rowClass = m => {
    const s = (m.stato || "").toLowerCase().replace(/ /g, "-");
    return `stato-${s}`;
  };

  const html = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th rowspan="2" data-sort="categoria" title="Classificazione contabile">Classif.</th>
            <th rowspan="2" class="no-sort" title="Numero progressivo (auto-calcolato in ordine cronologico)">Progr.</th>
            <th rowspan="2" data-sort="data">Data</th>
            <th rowspan="2" data-sort="descrizione">DESCRIZIONE</th>
            <th colspan="2" style="text-align:center;background:#f0e6d2">CASSA</th>
            <th colspan="2" style="text-align:center;background:#e8eef7">BPE</th>
            <th colspan="2" style="text-align:center;background:#fde9c2">NEXI</th>
            <th rowspan="2" class="no-sort">PDF</th>
            <th rowspan="2" data-sort="stato">Stato</th>
            <th rowspan="2" class="no-sort col-azioni">Azioni</th>
          </tr>
          <tr>
            <th class="num" style="background:#f0e6d2">E</th>
            <th class="num" style="background:#f0e6d2">U</th>
            <th class="num" style="background:#e8eef7">E</th>
            <th class="num" style="background:#e8eef7">U</th>
            <th class="num" style="background:#fde9c2">E</th>
            <th class="num" style="background:#fde9c2">U</th>
          </tr>
        </thead>
        <tbody>
        ${movs.length === 0 ? `<tr><td colspan="13" class="empty">Nessun movimento</td></tr>` : ""}
        ${movs.map(m => {
          const tooltipDesc = `${escapeHtml(m.descrizione||"")}\nFornitore: ${escapeHtml(m.fornitore_cliente||'—')}\nProgetto: ${escapeHtml(m.progetto||'Generale')}\nMetodo: ${m.metodo||'—'}\nN. doc: ${escapeHtml(m.numero_documento||'—')}`;
          const hasFigli = (m.child_count || 0) > 0;
          const isRef = m.is_reference;
          return `<tr class="${rowClass(m)}${isRef?' riga-riferimento':''}" data-id="${m.id}">
          <td>${m.categoria||""}</td>
          <td style="white-space:nowrap">
            ${hasFigli ? `<button class="expand-btn" data-id="${m.id}" title="Espandi sotto-movimenti">▶</button>` : `<span style="display:inline-block;width:18px"></span>`}
            ${canEdit
            ? `<button class="progr-cell" data-id="${m.id}" data-escludi="${!!m.escludi_progr}" data-override="${escapeHtml(m.progressivo_override||'')}" title="${m.escludi_progr?'Riga ESCLUSA dalla numerazione':(m.progressivo_override?'Numero forzato: '+m.progressivo_override:'Click per escludere o forzare numero')}">${m.progressivo!=null ? `<strong>${escapeHtml(m.progressivo)}</strong>` : '<span class="text-muted">—</span>'}${m.progressivo_override?'<span style="font-size:9px;color:var(--arancio)"> ✎</span>':''}</button>`
            : (m.progressivo!=null?`<strong>${escapeHtml(m.progressivo)}</strong>`:'<span class="text-muted">—</span>')}
            ${isRef ? `<span title="Padre riferimento" style="font-size:9px;color:var(--viola,#888)"> 📁</span>` : ''}
          </td>
          <td>${fmtData(m.data)}</td>
          <td title="${tooltipDesc}">
            <div>${escapeHtml((m.descrizione||"").substring(0,80))}</div>
            ${m.fornitore_cliente ? `<small class="text-muted">${escapeHtml(m.fornitore_cliente.substring(0,40))}${m.numero_documento?' · '+escapeHtml(m.numero_documento):''}</small>` : ''}
            ${hasFigli ? `<small style="color:var(--arancio);font-size:10px"> · ${m.child_count} sotto-mov.</small>` : ''}
          </td>
          <td class="num">${m.cassa_entrata?`<span class="importo-entrata">${fmtImporto(m.cassa_entrata)}</span>`:''}</td>
          <td class="num">${m.cassa_uscita?`<span class="importo-uscita">${fmtImporto(m.cassa_uscita)}</span>`:''}</td>
          <td class="num">${m.bpe_entrata?`<span class="importo-entrata">${fmtImporto(m.bpe_entrata)}</span>`:''}</td>
          <td class="num">${m.bpe_uscita?`<span class="importo-uscita">${fmtImporto(m.bpe_uscita)}</span>`:''}</td>
          <td class="num">${m.nexi_entrata?`<span class="importo-entrata">${fmtImporto(m.nexi_entrata)}</span>`:''}</td>
          <td class="num">${m.nexi_uscita?`<span class="importo-uscita">${fmtImporto(m.nexi_uscita)}</span>`:''}</td>
          <td>
            ${m.link_documento ? `<a class="icon-btn" href="${escapeHtml(m.link_documento)}" target="_blank" title="Documento">📄</a>` : ""}
            ${m.link_file_accoppiato ? `<a class="icon-btn" href="${escapeHtml(m.link_file_accoppiato)}" target="_blank" title="Distinta">📎</a>` : ""}
            ${m.link_pdf_unito ? `<a class="icon-btn" href="${escapeHtml(m.link_pdf_unito)}" target="_blank" title="PDF unito">🔗</a>` : ""}
          </td>
          <td><span class="badge-stato ${(m.stato||"").toLowerCase().replace(/ /g,"-")}" style="font-size:10px">${escapeHtml(m.stato||"")}</span></td>
          <td class="col-azioni">
            ${canEdit?`<button class="icon-btn" title="Modifica" data-act="edit" data-id="${m.id}">✎</button>`:""}
            ${canEdit?`<button class="icon-btn" title="Imputazioni" data-act="enti" data-id="${m.id}">🏛</button>`:""}
            ${canEdit?`<button class="icon-btn" title="Aggiungi sotto-movimento" data-act="add-figlio" data-id="${m.id}">⊕</button>`:""}
            ${canEdit?`<button class="icon-btn" title="Allega documento" data-act="allega" data-id="${m.id}">📎</button>`:""}
            ${canEdit && m.link_documento?`<button class="icon-btn" title="Scollega documento" data-act="scollega" data-id="${m.id}">🔓</button>`:""}
            ${isAdmin?`<button class="icon-btn" title="Elimina" data-act="del" data-id="${m.id}">🗑</button>`:""}
          </td>
        </tr>`;
        }).join("")}
        <tr class="totali-row">
          <td colspan="4" class="text-right"><strong>Totali pagina (${r.total} totali)</strong></td>
          <td class="num"><strong>${fmtImporto(movs.reduce((s,m)=>s+(+m.cassa_entrata||0),0))}</strong></td>
          <td class="num"><strong>${fmtImporto(movs.reduce((s,m)=>s+(+m.cassa_uscita||0),0))}</strong></td>
          <td class="num"><strong>${fmtImporto(movs.reduce((s,m)=>s+(+m.bpe_entrata||0),0))}</strong></td>
          <td class="num"><strong>${fmtImporto(movs.reduce((s,m)=>s+(+m.bpe_uscita||0),0))}</strong></td>
          <td class="num"><strong>${fmtImporto(movs.reduce((s,m)=>s+(+m.nexi_entrata||0),0))}</strong></td>
          <td class="num"><strong>${fmtImporto(movs.reduce((s,m)=>s+(+m.nexi_uscita||0),0))}</strong></td>
          <td colspan="3" style="font-size:11px">
            Saldo pagina: <strong style="color:${totE-totU>=0?'var(--verde)':'var(--rosso)'}">${fmtImporto(totE-totU)}</strong>
          </td>
        </tr>
        </tbody>
      </table>
    </div>
    <div class="pagination">
      <div>Pagina ${r.page} di ${totPages} — ${r.total} righe</div>
      <div class="pages">
        <button class="secondary" ${r.page===1?"disabled":""} data-page="prev">◀ Prec</button>
        <button class="secondary" ${r.page===totPages?"disabled":""} data-page="next">Succ ▶</button>
      </div>
    </div>`;
  document.getElementById("pn-table-wrap").innerHTML = html;

  document.querySelectorAll("#pn-table-wrap th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const c = th.dataset.sort;
      if (STATE.primanota.sortBy === c) STATE.primanota.sortDir = STATE.primanota.sortDir === "asc" ? "desc" : "asc";
      else { STATE.primanota.sortBy = c; STATE.primanota.sortDir = "asc"; }
      primanotaLoad();
    });
  });
  document.querySelectorAll("#pn-table-wrap [data-page]").forEach(b => {
    b.addEventListener("click", () => {
      STATE.primanota.page += b.dataset.page === "next" ? 1 : -1;
      primanotaLoad();
    });
  });
  document.querySelectorAll("#pn-table-wrap [data-act]").forEach(b => {
    b.addEventListener("click", async () => {
      const id = b.dataset.id, act = b.dataset.act;
      if (act === "edit") location.hash = "#modifica-movimento/" + id;
      else if (act === "del") {
        if (confirm2("Eliminare questo movimento?")) {
          await window.SB.eliminaMovimento(id);
          flash("Eliminato"); primanotaLoad();
        }
      }
      else if (act === "enti") openImputazioniModal(id);
      else if (act === "allega") apriModaleAllegaDocumentoDaMovimento(id);
      else if (act === "add-figlio") {
        // Crea nuovo sotto-movimento figlio → apre form con parent_id preimpostato
        location.hash = "#nuovo-movimento-figlio/" + id;
      }
      else if (act === "scollega") {
        if (!confirm2("Scollegare il documento da questo movimento? Il PDF tornerà in 'Documenti da abbinare'.")) return;
        try {
          await window.SB.scollegaDocumento(id);
          flash("Documento scollegato"); primanotaLoad();
        } catch (e) { flash(e.message, "error"); }
      }
    });
  });

  // Click expand ▶ → carica figli inline
  document.querySelectorAll("#pn-table-wrap .expand-btn").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const row = btn.closest("tr");
      const isExpanded = btn.dataset.expanded === "1";
      if (isExpanded) {
        // Collapse: rimuovi righe figlio
        document.querySelectorAll(`tr[data-figlio-di="${id}"]`).forEach(r => r.remove());
        btn.dataset.expanded = "0";
        btn.textContent = "▶";
      } else {
        // Expand: carica e inserisci figli
        btn.textContent = "⏳";
        try {
          const figli = await window.SB.getFigliMovimento(id);
          const { fmtImporto, fmtData, escapeHtml } = window.UI;
          const canEdit = CURRENT_USER.ruolo === "admin" || CURRENT_USER.ruolo === "editor";
          const isAdmin = CURRENT_USER.ruolo === "admin";
          let insertAfter = row;
          figli.forEach(f => {
            const sommaFigli = figli.reduce((s, fi) => s + +fi.importo, 0);
            const padre = window._primanotaMovs && window._primanotaMovs.find(m => m.id === id);
            const tr = document.createElement("tr");
            tr.dataset.figlioId = f.id;
            tr.dataset.figlioDi = id;
            tr.className = "riga-figlio";
            tr.innerHTML = `
              <td style="padding-left:28px;font-size:11px;color:#888">${f.categoria||""}</td>
              <td style="padding-left:12px;font-size:11px">
                <span style="color:var(--arancio);font-weight:600">${escapeHtml(f.progressivo||"—")}</span>
              </td>
              <td style="font-size:11px">${fmtData(f.data)}</td>
              <td style="padding-left:20px;font-size:11px">
                <div>↳ ${escapeHtml((f.descrizione||"").substring(0,70))}</div>
                ${f.fornitore_cliente?`<small class="text-muted">${escapeHtml(f.fornitore_cliente.substring(0,35))}</small>`:''}
              </td>
              <td class="num" style="font-size:11px">${f.cassa_entrata?`<span class="importo-entrata">${fmtImporto(f.cassa_entrata)}</span>`:''}</td>
              <td class="num" style="font-size:11px">${f.cassa_uscita?`<span class="importo-uscita">${fmtImporto(f.cassa_uscita)}</span>`:''}</td>
              <td class="num" style="font-size:11px">${f.bpe_entrata?`<span class="importo-entrata">${fmtImporto(f.bpe_entrata)}</span>`:''}</td>
              <td class="num" style="font-size:11px">${f.bpe_uscita?`<span class="importo-uscita">${fmtImporto(f.bpe_uscita)}</span>`:''}</td>
              <td class="num" style="font-size:11px">${f.nexi_entrata?`<span class="importo-entrata">${fmtImporto(f.nexi_entrata)}</span>`:''}</td>
              <td class="num" style="font-size:11px">${f.nexi_uscita?`<span class="importo-uscita">${fmtImporto(f.nexi_uscita)}</span>`:''}</td>
              <td>${f.link_documento?`<a class="icon-btn" href="${escapeHtml(f.link_documento)}" target="_blank">📄</a>`:''}</td>
              <td><span class="badge-stato ${(f.stato||"").toLowerCase().replace(/ /g,"-")}" style="font-size:9px">${escapeHtml(f.stato||"")}</span></td>
              <td class="col-azioni" style="white-space:nowrap">
                ${canEdit?`<button class="icon-btn" title="Modifica" data-act="edit" data-id="${f.id}">✎</button>`:''}
                ${canEdit?`<button class="icon-btn" title="Promuovi a primario" data-act="promuovi" data-id="${f.id}" data-padre="${id}" style="font-size:10px">⬆ Prim.</button>`:''}
                ${isAdmin?`<button class="icon-btn" title="Elimina" data-act="del-figlio" data-id="${f.id}" data-padre="${id}">🗑</button>`:''}
              </td>`;
            insertAfter.insertAdjacentElement("afterend", tr);
            insertAfter = tr;

            // Azioni sui figli
            tr.querySelectorAll("[data-act]").forEach(b => {
              b.addEventListener("click", async () => {
                const act2 = b.dataset.act, fid = b.dataset.id, pid = b.dataset.padre;
                if (act2 === "edit") location.hash = "#modifica-movimento/" + fid;
                else if (act2 === "del-figlio") {
                  if (confirm2("Eliminare questo sotto-movimento?")) {
                    await window.SB.eliminaMovimento(fid);
                    flash("Eliminato"); primanotaLoad();
                  }
                } else if (act2 === "promuovi") {
                  if (confirm2("Promuovere questo sotto-movimento a primario?\nIl padre rimarrà come riferimento (senza progressivo) se ha altri figli.")) {
                    await window.SB.promuoviFiglioAPrimario(fid, pid);
                    flash("Promosso a primario"); primanotaLoad();
                  }
                }
              });
            });
          });
          btn.dataset.expanded = "1";
          btn.textContent = "▼";
        } catch(e) { flash(e.message,"error"); btn.textContent="▶"; }
      }
    });
  });

  // Click sulla cella progressivo → apre popover con i 2 controlli
  document.querySelectorAll("#pn-table-wrap .progr-cell").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      apriPopoverProgressivo(btn);
    });
  });
}

// =====================================================================
// FORM MOVIMENTO
// =====================================================================
function renderNuovoMovimento() { return renderFormMovimento(null); }
function renderModificaMovimento(rest) { return renderFormMovimento(rest && rest[0]); }

async function renderFormMovimento(id, parentId = null) {
  const sec = document.getElementById("nuovo-movimento-content");
  const { escapeHtml, todayISO, CATEGORIE, CATEGORIE_USCITA, CATEGORIE_ENTRATA, METODI } = window.UI;
  const PROGETTI = progettiNomi();
  let titleSuffix = id ? "Modifica movimento" : (parentId ? "Nuovo sotto-movimento" : "Nuovo movimento");
  document.getElementById("nm-title").textContent = titleSuffix;
  let m = null, padre = null;
  if (id) {
    sec.innerHTML = `<div class="empty"><span class="spinner"></span> Caricamento...</div>`;
    m = await window.SB.getMovimento(id);
    parentId = m.parent_id || null;
  }
  if (parentId && !padre) {
    padre = await window.SB.getMovimento(parentId).catch(() => null);
  }
  const tipo = m ? m.tipo : "USCITA";
  const cat  = m ? m.categoria : "U2";
  const data = m ? m.data : todayISO();

  sec.innerHTML = `
    <form class="form-card" id="form-mov">
      <div class="form-grid">
        <div class="full">
          <label>Tipo</label>
          <div class="tipo-toggle">
            <button type="button" class="${tipo==='ENTRATA'?'active entrata':''}" data-tipo="ENTRATA">▲ ENTRATA</button>
            <button type="button" class="${tipo==='USCITA' ?'active uscita' :''}" data-tipo="USCITA">▼ USCITA</button>
          </div>
          <input type="hidden" id="f-tipo-mov" value="${tipo}" />
        </div>
        <div><label>Data movimento (banca/cassa) *</label><input id="f-data" type="date" value="${data}" required title="Data effettiva del flusso bancario o di cassa" /></div>
        <div><label>Data documento</label><input id="f-data-doc" type="date" value="${m && m.data_documento ? String(m.data_documento).slice(0,10) : ''}" title="Data emissione della fattura/ricevuta (per cassa = stesso giorno)" /></div>
        <div><label>Importo (€)</label><input id="f-importo" type="number" step="0.01" min="0" value="${m?+m.importo:""}" required /></div>
        <div><label>Anno</label><input id="f-anno-mov" type="number" value="${m?m.anno:ANNO_CORRENTE}" /></div>
        <div class="full"><label>Descrizione</label><input id="f-desc" type="text" value="${escapeHtml(m?m.descrizione:'')}" required /></div>
        <div><label>Fornitore / Cliente</label><input id="f-forn" value="${escapeHtml(m?m.fornitore_cliente:'')}" /></div>
        <div><label>Riferimento documento</label><input id="f-numdoc" value="${escapeHtml(m?m.numero_documento:'')}" placeholder="FPR 33/2026, BP marzo, F24..." title="Riferimento al documento esterno (fattura, busta paga, F24)" /></div>
        <div><label>Categoria</label><select id="f-cat-mov" required></select></div>
        <div><label>Metodo</label>
          <select id="f-metodo-mov">${METODI.map(p=>`<option ${m&&m.metodo===p?"selected":""}>${p}</option>`).join("")}</select>
        </div>
        <div><label>Progetto</label>
          <select id="f-progetto-mov">${PROGETTI.map(p=>`<option ${m&&m.progetto===p?"selected":""}>${p}</option>`).join("")}</select>
        </div>
        ${padre ? `
        <div class="full" style="background:#fff8e6;border:1px solid #f0c040;border-radius:6px;padding:10px;margin-bottom:4px">
          <strong>📁 Sotto-movimento di:</strong>
          <span style="margin-left:8px">${escapeHtml(padre.progressivo||'—')} — ${escapeHtml(padre.descrizione||'')} (€${+padre.importo})</span>
          <input type="hidden" id="f-parent-id" value="${parentId}" />
        </div>` : '<input type="hidden" id="f-parent-id" value="" />'}
        <div class="full"><label>Link documento (Drive) — incolla link o usa picker</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="f-link-doc" type="url" value="${escapeHtml(m?m.link_documento:'')}" placeholder="https://drive.google.com/..." style="flex:1" />
            <button type="button" class="secondary" id="btn-picker-doc" title="Scegli da Drive">📂 Drive</button>
          </div>
        </div>
        <div class="full"><label>Link file accoppiato / distinta</label>
          <input id="f-link-acc" type="url" value="${escapeHtml(m?m.link_file_accoppiato:'')}" placeholder="distinta BPE / estratto NEXI" /></div>
        <div class="full">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
            <input id="f-senza-doc" type="checkbox" style="width:auto" ${m && m.senza_documento ? "checked" : ""} />
            Senza documento (commissione bancaria, bollo, interessi — non serve giustificativo)
          </label>
        </div>
        <div class="full"><label>Note</label><textarea id="f-note" rows="2">${escapeHtml(m?m.note:'')}</textarea></div>
        ${id ? `
          <div class="form-grid" style="grid-column:1/-1;grid-template-columns:1fr 1fr">
            <div><label>Progressivo prima nota (auto)</label>
              <input id="f-progr" value="${escapeHtml(m.progressivo || '—')}" readonly style="background:#f5f6fa" />
              <p class="text-muted" style="font-size:11px;margin-top:2px">Ricalcolato cronologicamente. I sotto-movimenti hanno progressivo tipo 5.1, 5.2…</p>
            </div>
            <div><label>Ordine manuale (opzionale)</label>
              <input id="f-ordine" type="number" value="${m.ordine_manuale ?? ''}" placeholder="lascia vuoto per ordine cronologico" />
            </div>
          </div>
        ` : `<div class="full text-muted" style="font-size:12px">📌 Il progressivo verrà assegnato automaticamente al salvataggio.</div>`}
      </div>
      <div class="form-actions">
        <button type="button" class="secondary" onclick="location.hash='#primanota'">Annulla</button>
        <button type="submit">${id?"Aggiorna":"Salva movimento"}</button>
      </div>
    </form>

    ${id ? `<div id="allegati-section" style="margin-top:24px"></div>` : ''}
    ${id && !parentId ? `<div id="sottomovimenti-section" style="margin-top:24px"></div>` : ''}
  `;

  populateCategoriaSelect(tipo, cat);
  document.querySelectorAll("#form-mov .tipo-toggle button").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.tipo;
      document.querySelectorAll("#form-mov .tipo-toggle button").forEach(b => b.classList.remove("active","entrata","uscita"));
      btn.classList.add("active", t === "ENTRATA" ? "entrata" : "uscita");
      document.getElementById("f-tipo-mov").value = t;
      populateCategoriaSelect(t, t === "ENTRATA" ? "E10" : "U2");
    });
  });

  document.getElementById("form-mov").addEventListener("submit", async e => {
    e.preventDefault();
    const fDataDoc = document.getElementById("f-data-doc");
    const fOrdine  = document.getElementById("f-ordine");
    const data = {
      data: document.getElementById("f-data").value,
      data_documento: fDataDoc && fDataDoc.value ? fDataDoc.value : null,
      tipo: document.getElementById("f-tipo-mov").value,
      importo: parseFloat(document.getElementById("f-importo").value) || 0,
      descrizione: document.getElementById("f-desc").value.trim(),
      fornitore_cliente: document.getElementById("f-forn").value.trim(),
      numero_documento: document.getElementById("f-numdoc").value.trim(),
      categoria: document.getElementById("f-cat-mov").value,
      metodo: document.getElementById("f-metodo-mov").value,
      progetto: document.getElementById("f-progetto-mov").value,
      anno: parseInt(document.getElementById("f-anno-mov").value, 10),
      ordine_manuale: fOrdine && fOrdine.value !== "" ? parseInt(fOrdine.value, 10) : null,
      link_documento: document.getElementById("f-link-doc").value.trim(),
      link_file_accoppiato: document.getElementById("f-link-acc").value.trim(),
      senza_documento: document.getElementById("f-senza-doc").checked,
      note: document.getElementById("f-note").value.trim(),
    };
    // Aggiungi parent_id se presente
    const fParent = document.getElementById("f-parent-id");
    if (fParent && fParent.value) data.parent_id = fParent.value;
    try {
      // Check doppioni (solo su nuovi o se cambia importo/data/fornitore)
      const ok = await checkDoppioniPrimaSalvataggio(data, id);
      if (!ok) return;
      if (id) data.id = id;
      await window.SB.salvaMovimento(data);
      flash(id ? "Aggiornato" : "Salvato");
      location.hash = "#primanota";
    } catch (err) { flash(err.message, "error", 6000); }
  });

  // Drive picker per documento
  const btnPicker = document.getElementById("btn-picker-doc");
  if (btnPicker) {
    btnPicker.addEventListener("click", () => {
      if (window.DRIVE?.openPicker) {
        window.DRIVE.openPicker(file => {
          document.getElementById("f-link-doc").value = file.url || file.webViewLink || "";
        });
      } else {
        flash("Autenticazione Google necessaria — vai in Analizza PDF per autorizzare", "warning");
      }
    });
  }

  // Sezione sotto-movimenti (solo su modifica di un primario)
  if (id && !parentId) {
    // Carica sezione allegati
  const sezAll = document.getElementById("allegati-section");
  if (sezAll && window.ALLEGATI) await window.ALLEGATI.render(sezAll, id);

  const sezSub = document.getElementById("sottomovimenti-section");
  if (sezSub) await renderSottomovimentiSection(sezSub, id, m);
  }
}

async function renderSottomovimentiSection(container, padreId, padre) {
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  const isAdmin = CURRENT_USER.ruolo === "admin";
  const canEdit = isAdmin || CURRENT_USER.ruolo === "editor";

  container.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  const figli = await window.SB.getFigliMovimento(padreId);

  const sommeFigli = figli.reduce((s, f) => s + +f.importo, 0);
  const diff = Math.abs((+padre.importo) - sommeFigli);
  const bilancioOk = diff < 0.01;
  const bilancioWarn = !bilancioOk && figli.length > 0;

  const isRef = padre.is_reference;

  container.innerHTML = `
    <div class="form-card" style="margin-top:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0">📂 Sotto-movimenti</h3>
        <div style="display:flex;gap:8px;align-items:center">
          ${bilancioWarn ? `<span style="color:var(--rosso);font-size:12px">⚠️ Somma figli €${sommeFigli.toFixed(2)} ≠ €${(+padre.importo).toFixed(2)} (differenza: €${diff.toFixed(2)})</span>` : ''}
          ${bilancioOk && figli.length > 0 ? `<span style="color:var(--verde);font-size:12px">✅ Somma bilanciata</span>` : ''}
          ${canEdit && isRef ? `<button class="secondary" id="btn-ripristina-padre" style="font-size:11px">↩ Ripristina come primario</button>` : ''}
          ${canEdit && !isRef && figli.length > 0 ? `<button class="secondary" id="btn-converti-rif" style="font-size:11px">📁 Converti a riferimento</button>` : ''}
          ${canEdit ? `<button id="btn-add-figlio-form" style="font-size:12px">⊕ Aggiungi sotto-movimento</button>` : ''}
        </div>
      </div>
      ${isRef ? `<div style="background:#fff8e6;border:1px solid #f0c040;border-radius:6px;padding:8px;margin-bottom:12px;font-size:12px">
        📁 <strong>Questo movimento è un riferimento</strong>: non appare nella numerazione principale. I figli hanno progressivo ${escapeHtml(padre.progressivo||'?')}.1, .2 ecc.
      </div>` : ''}
      ${figli.length === 0 ? `<p class="text-muted" style="font-size:12px">Nessun sotto-movimento. Clicca "Aggiungi" per crearne uno.</p>` : `
        <table style="width:100%;font-size:12px">
          <thead><tr>
            <th>Progr.</th><th>Data</th><th>Descrizione</th><th>Importo</th><th>Stato</th>${canEdit?'<th>Azioni</th>':''}
          </tr></thead>
          <tbody>
          ${figli.map(f => `<tr>
            <td><strong>${escapeHtml(f.progressivo||'—')}</strong></td>
            <td>${fmtData(f.data)}</td>
            <td>${escapeHtml((f.descrizione||'').substring(0,60))}${f.fornitore_cliente?`<br><small class="text-muted">${escapeHtml(f.fornitore_cliente.substring(0,40))}</small>`:''}</td>
            <td class="num"><span class="${f.tipo==='ENTRATA'?'importo-entrata':'importo-uscita'}">${fmtImporto(f.importo)}</span></td>
            <td><span class="badge-stato ${(f.stato||'').toLowerCase().replace(/ /g,'-')}" style="font-size:10px">${escapeHtml(f.stato||'')}</span></td>
            ${canEdit ? `<td style="white-space:nowrap">
              <button class="icon-btn" data-act="edit-figlio" data-id="${f.id}" title="Modifica">✎</button>
              <button class="icon-btn" data-act="promuovi-figlio" data-id="${f.id}" title="Promuovi a primario" style="font-size:10px">⬆ Prim.</button>
              ${isAdmin?`<button class="icon-btn" data-act="del-figlio" data-id="${f.id}" title="Elimina">🗑</button>`:''}
            </td>` : ''}
          </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td colspan="3" class="text-right"><strong>Totale figli</strong></td>
            <td class="num"><strong style="color:${bilancioOk?'var(--verde)':'var(--rosso)'}">${fmtImporto(sommeFigli)}</strong></td>
            <td colspan="${canEdit?2:1}"></td>
          </tr></tfoot>
        </table>
      `}
    </div>`;

  // Pulsante aggiungi figlio
  document.getElementById("btn-add-figlio-form")?.addEventListener("click", () => {
    location.hash = "#nuovo-movimento-figlio/" + padreId;
  });

  // Pulsante converti a riferimento
  document.getElementById("btn-converti-rif")?.addEventListener("click", async () => {
    if (confirm2("Convertire questo movimento a 'riferimento'?\nNon avrà più un progressivo proprio, i figli manterranno la numerazione (es. 5.1, 5.2).")) {
      await window.SB.convertePadreARiferimento(padreId);
      flash("Convertito a riferimento");
      location.reload();
    }
  });

  // Pulsante ripristina padre normale
  document.getElementById("btn-ripristina-padre")?.addEventListener("click", async () => {
    await window.SB.ripristinaPadreNormale(padreId);
    flash("Ripristinato come primario");
    location.reload();
  });

  // Azioni su figli nella tabella
  container.querySelectorAll("[data-act]").forEach(b => {
    b.addEventListener("click", async () => {
      const act = b.dataset.act, fid = b.dataset.id;
      if (act === "edit-figlio") location.hash = "#modifica-movimento/" + fid;
      else if (act === "del-figlio") {
        if (confirm2("Eliminare questo sotto-movimento?")) {
          await window.SB.eliminaMovimento(fid);
          flash("Eliminato");
          await renderSottomovimentiSection(container, padreId, padre);
        }
      } else if (act === "promuovi-figlio") {
        if (confirm2("Promuovere a primario? Il padre rimarrà riferimento se ha altri figli.")) {
          await window.SB.promuoviFiglioAPrimario(fid, padreId);
          flash("Promosso a primario");
          padre = await window.SB.getMovimento(padreId);
          await renderSottomovimentiSection(container, padreId, padre);
        }
      }
    });
  });
}

function populateCategoriaSelect(tipo, selected = "") {
  const sel = document.getElementById("f-cat-mov");
  if (!sel) return;
  const { CATEGORIE, CATEGORIE_USCITA, CATEGORIE_ENTRATA } = window.UI;
  const lista = tipo === "ENTRATA" ? CATEGORIE_ENTRATA : CATEGORIE_USCITA;
  sel.innerHTML = lista.map(c => `<option value="${c}" ${c===selected?"selected":""}>${c} — ${CATEGORIE[c].substring(0,40)}</option>`).join("");
}

// === POPOVER MODIFICA PROGRESSIVO (escludi + override libero) ===
function apriPopoverProgressivo(btn) {
  document.querySelectorAll(".progr-popover").forEach(p => p.remove());

  const id = btn.dataset.id;
  const escludi = btn.dataset.escludi === "true";
  const override = btn.dataset.override || "";

  const rect = btn.getBoundingClientRect();
  const popover = document.createElement("div");
  popover.className = "progr-popover";
  popover.style.cssText = `
    position:fixed; top:${rect.bottom+4}px; left:${Math.max(8, rect.left)}px;
    background:white; color:var(--nero); border:1px solid var(--grigio-bordo); border-radius:6px;
    padding:12px; box-shadow:0 4px 12px rgba(0,0,0,0.15); z-index:1000;
    font-size:12px; min-width:280px;
  `;
  popover.innerHTML = `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-bottom:10px">
      <input type="checkbox" id="pp-escludi" ${escludi?'checked':''} style="width:14px;height:14px" />
      <span>🚫 Escludi dalla numerazione</span>
    </label>
    <hr style="margin:8px 0;border:none;border-top:1px solid var(--grigio-bordo)">
    <label style="display:block;margin-bottom:8px">
      <span style="color:var(--grigio-testo);font-size:11px">Forza progressivo (es. "3b"):</span>
      <input id="pp-override" value="${override}" maxlength="15" placeholder="lascia vuoto per auto" style="width:100%;padding:4px 8px" ${escludi?'disabled':''} />
    </label>
    <p class="text-muted" style="font-size:11px;line-height:1.4;margin:6px 0 10px">
      Il numero auto si ricalcola escludendo le righe con override o escludi.<br>
      Esempio: digiti <code>3b</code> → questa riga mostra "3b", le altre slittano.
    </p>
    <div style="display:flex;gap:6px;justify-content:flex-end">
      <button type="button" class="secondary" id="pp-cancel" style="padding:4px 12px;font-size:12px">Annulla</button>
      <button type="button" id="pp-save" style="padding:4px 12px;font-size:12px">Salva</button>
    </div>
  `;
  document.body.appendChild(popover);

  const cbEsc = popover.querySelector("#pp-escludi");
  const inOv = popover.querySelector("#pp-override");
  cbEsc.addEventListener("change", () => {
    inOv.disabled = cbEsc.checked;
    if (cbEsc.checked) inOv.value = "";
  });

  function closeOnOutside(e) {
    if (!popover.contains(e.target) && e.target !== btn) {
      popover.remove();
      document.removeEventListener("mousedown", closeOnOutside);
    }
  }
  setTimeout(() => document.addEventListener("mousedown", closeOnOutside), 50);

  popover.querySelector("#pp-cancel").onclick = () => popover.remove();
  popover.querySelector("#pp-save").onclick = async () => {
    const newEscludi = cbEsc.checked;
    const newOverride = (inOv.value || "").trim();
    popover.remove();
    btn.style.opacity = "0.5";
    try {
      await window.SB.salvaMovimento({
        id,
        escludi_progr: newEscludi,
        progressivo_override: newOverride || null,
      });
      flash("Progressivo aggiornato", "success", 2000);
      primanotaLoad();
    } catch (e) {
      flash("Errore: " + e.message, "error", 6000);
      btn.style.opacity = "1";
    }
  };
  // Focus su input override per quick edit
  setTimeout(() => { if (!escludi) inOv.focus(); }, 100);
}

// === CHECK DOPPIONI ===
async function checkDoppioniPrimaSalvataggio(data, excludeId = null) {
  if (!data.data || !data.importo || +data.importo <= 0) return true;
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  let dups;
  try {
    dups = await window.SB.cercaDoppioni({
      data: data.data,
      importo: data.importo,
      fornitore_cliente: data.fornitore_cliente || "",
      excludeId: excludeId,
    });
  } catch { return true; }
  if (!dups.length) return true;

  return new Promise(resolve => {
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="alert alert-warning">
        <strong>⚠️ Possibili doppioni (${dups.length}):</strong>
        <p class="text-muted" style="font-size:12px;margin-top:4px">Stesso importo, stesso fornitore, data entro ±3 giorni.</p>
      </div>
      ${dups.map(d => `<div style="padding:8px 10px;border:1px solid var(--grigio-bordo);border-radius:4px;margin-bottom:6px">
        <strong>${escapeHtml(d.progressivo)}</strong> · ${fmtData(d.data)} · ${escapeHtml(d.descrizione)}
        <span class="${d.tipo==='ENTRATA'?'importo-entrata':'importo-uscita'}" style="float:right">${d.tipo==='ENTRATA'?'+':'−'} ${fmtImporto(d.importo)}</span>
      </div>`).join("")}
    `;
    const host = document.getElementById("modal-host");
    host.innerHTML = "";
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><h2>Possibile doppione</h2><button class="close-btn" type="button">×</button></div>
        <div class="modal-body"></div>
        <div class="modal-footer">
          <button class="secondary" data-act="cancel">Annulla</button>
          <button data-act="save" style="background:var(--rosso);color:white">Salva comunque</button>
        </div>
      </div>`;
    overlay.querySelector(".modal-body").appendChild(body);
    const close = (val) => { host.innerHTML = ""; resolve(val); };
    overlay.querySelector(".close-btn").addEventListener("click", () => close(false));
    overlay.querySelector('[data-act="cancel"]').addEventListener("click", () => close(false));
    overlay.querySelector('[data-act="save"]').addEventListener("click", () => close(true));
    host.appendChild(overlay);
  });
}
window.checkDoppioniPrimaSalvataggio = checkDoppioniPrimaSalvataggio;

// =====================================================================
// ABBINAMENTO EC
// =====================================================================
async function renderAbbinamento() {
  const sec = document.getElementById("abbinamento-content");
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  sec.innerHTML = `
    <div class="form-card mb-2">
      <h3 style="margin:0 0 12px;color:var(--blu-scuro)">Importa estratto conto</h3>
      <div class="flex" style="gap:12px;flex-wrap:wrap">
        <div><label>File CSV BPE/NEXI</label><input type="file" id="ec-file" accept=".csv,.txt,.xlsx,.xls" /></div>
        <div><label>Conto</label>
          <select id="ec-conto"><option>BPE</option><option>NEXI</option></select></div>
        <div><label>&nbsp;</label><button id="btn-ec-import" class="secondary">Importa</button></div>
      </div>
      <div id="ec-preview" class="mt-2"></div>
    </div>

    <div class="filters" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="filter-group"><label>Anno</label>
        <select id="m-anno">${[ANNO_CORRENTE-1,ANNO_CORRENTE,ANNO_CORRENTE+1].map(a=>`<option ${a===STATE.match.anno?"selected":""}>${a}</option>`).join("")}</select></div>
      <div class="filter-group"><label>Mese</label>
        <select id="m-mese"><option value="">Tutti</option>
          ${["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"]
            .map((nm,i)=>`<option value="${i+1}" ${i+1===STATE.match.mese?"selected":""}>${nm}</option>`).join("")}</select></div>
      <div class="filter-group"><label>Conto</label>
        <select id="m-conto"><option value="BPE">BPE</option><option value="NEXI">NEXI</option></select></div>
    </div>

    <div class="match-status-bar" id="match-status"></div>
    ${CURRENT_USER.ruolo === "admin" ? `
    <div class="flex mb-2">
      <button class="secondary" id="btn-auto-create">⚡ Crea bozze movimenti dalle righe EC libere</button>
      <span class="text-muted" style="font-size:12px">Solo admin: un movimento per ogni riga EC senza abbinamento, con categoria auto-inferita.</span>
    </div>` : ""}
    <div class="match-grid">
      <div class="match-col"><h3>Movimenti da abbinare</h3><div class="match-list" id="match-mov"></div></div>
      <div class="match-col"><h3>Righe estratto conto libere</h3><div class="match-list" id="match-ec"></div></div>
    </div>
  `;
  document.getElementById("m-anno").addEventListener("change", e => { STATE.match.anno = +e.target.value; loadMatch(); });
  document.getElementById("m-mese").addEventListener("change", e => { STATE.match.mese = e.target.value?+e.target.value:null; loadMatch(); });
  document.getElementById("m-conto").addEventListener("change", e => { STATE.match.conto = e.target.value; loadMatch(); });
  document.getElementById("btn-ec-import").addEventListener("click", () => importaECFlow());
  const btnAutoCreate = document.getElementById("btn-auto-create");
  if (btnAutoCreate) btnAutoCreate.addEventListener("click", async () => {
    const { anno, mese, conto } = STATE.match;
    if (!confirm(`Creare bozze di movimenti per TUTTE le righe EC libere (conto ${conto}, anno ${anno})?\nLa categoria sarà inferita dalla descrizione. Potrai correggerla in Prima Nota.`)) return;
    const btn = document.getElementById("btn-auto-create");
    btn.disabled = true; btn.textContent = "⏳ Creazione in corso...";
    try {
      const r = await window.SB.creaBozzeDaECLibere({ anno, conto });
      flash(`Create ${r.created} bozze · saltate ${r.skipped}`, "success", 6000);
      if (r.errors.length) console.warn("Errori:", r.errors);
      loadMatch();
    } catch (e) {
      flash("Errore: " + e.message, "error", 6000);
    } finally {
      btn.disabled = false; btn.textContent = "⚡ Crea bozze movimenti dalle righe EC libere";
    }
  });
  await loadMatch();
}

async function importaECFlow() {
  const fileInput = document.getElementById("ec-file");
  const conto = document.getElementById("ec-conto").value;
  const file = fileInput.files[0];
  if (!file) return flash("Seleziona un file", "warning");
  try {
    const righe = await window.EXPORT_SCREEN.parseECFile(file, conto);
    if (!righe.length) return flash("Nessuna riga valida nel file", "error");
    const { fmtImporto, fmtData, escapeHtml } = window.UI;
    const prev = document.getElementById("ec-preview");
    prev.innerHTML = `
      <p><strong>${righe.length} righe rilevate.</strong> Anteprima prime 5:</p>
      <div class="table-wrap" style="max-height:200px;overflow:auto"><table>
        <thead><tr><th>Data</th><th>Descr.</th><th>Beneficiario</th><th class="num">Importo</th></tr></thead>
        <tbody>${righe.slice(0,5).map(r=>`<tr>
          <td>${fmtData(r.data_valuta)}</td>
          <td>${escapeHtml(r.descrizione_banca)}</td>
          <td>${escapeHtml(r.beneficiario||"")}</td>
          <td class="num">${fmtImporto(r.importo)}</td></tr>`).join("")}</tbody>
      </table></div>
      <button class="success mt-1" id="btn-ec-conf">Importa ${righe.length} righe in Supabase</button>`;
    document.getElementById("btn-ec-conf").addEventListener("click", async () => {
      const inseriti = await window.SB.importaEC(righe, conto);
      flash(`${inseriti.length} righe importate (saltate: ${righe.length - inseriti.length})`);
      prev.innerHTML = ""; fileInput.value = ""; loadMatch();
    });
  } catch (e) { flash("Errore: " + e.message, "error"); }
}

async function loadMatch() {
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  const { anno, mese, conto } = STATE.match;

  const movFilter = { anno, stato: "Lavorato", metodo: conto, size: 500, page: 1 };
  if (mese) movFilter.mese = mese;
  const movResp = await window.SB.getMovimenti(movFilter);
  const movs = movResp.movimenti || [];

  const ecFilter = { anno, conto, stato: "Da abbinare" };
  if (mese) ecFilter.mese = mese;
  const ecs = await window.SB.getEC(ecFilter);

  const totMov = movs.reduce((s, m) => s + (m.tipo === "USCITA" ? -+m.importo : +m.importo), 0);
  const totEC  = ecs.reduce((s, e) => s + +e.importo, 0);
  document.getElementById("match-status").innerHTML = `
    <div class="item">Movimenti da abbinare: <strong>${movs.length}</strong></div>
    <div class="item">EC libere: <strong>${ecs.length}</strong></div>
    <div class="item">Delta: <strong>${fmtImporto(totMov - totEC)}</strong></div>`;

  const suggestion = m => ecs.find(e => Math.abs(+e.importo - Math.abs(+m.importo)) < 0.01
    && Math.abs(new Date(e.data_valuta) - new Date(m.data)) <= 5 * 86400000);

  const movEl = document.getElementById("match-mov");
  const ecEl  = document.getElementById("match-ec");

  movEl.innerHTML = movs.length === 0
    ? `<div class="empty">Nessuno</div>`
    : movs.map(m => {
        const sug = suggestion(m);
        const sel = STATE.match.selectedMov === m.id;
        return `<div class="match-row ${sel?"selected":""} ${sug?"suggested":""}" data-mov="${m.id}">
          <div class="info"><div class="desc">${escapeHtml(m.progressivo)} · ${escapeHtml(m.descrizione)}</div>
            <div class="meta">${fmtData(m.data)} · ${m.tipo} · ${m.categoria||""}</div></div>
          <div class="imp ${m.tipo==='ENTRATA'?'importo-entrata':'importo-uscita'}">${fmtImporto(m.importo)}</div></div>`;
      }).join("");

  ecEl.innerHTML = ecs.length === 0
    ? `<div class="empty">Nessuna riga EC libera</div>`
    : ecs.map(e => `<div class="match-row" data-ec="${e.id}">
        <div class="info"><div class="desc">${escapeHtml(e.descrizione_banca)}</div>
          <div class="meta">${fmtData(e.data_valuta)} · ${escapeHtml(e.beneficiario||"")} · ${e.conto}</div></div>
        <div class="imp">${fmtImporto(e.importo)}</div></div>`).join("");

  movEl.querySelectorAll("[data-mov]").forEach(el => el.addEventListener("click", () => {
    STATE.match.selectedMov = el.dataset.mov; loadMatch();
  }));
  ecEl.querySelectorAll("[data-ec]").forEach(el => el.addEventListener("click", async () => {
    if (!STATE.match.selectedMov) return flash("Seleziona prima un movimento", "warning");
    try {
      await window.SB.abbinaEC(STATE.match.selectedMov, el.dataset.ec);
      flash("Abbinato");
      STATE.match.selectedMov = null; loadMatch();
    } catch (e) { flash(e.message, "error"); }
  }));
}

// =====================================================================
// IMPUTAZIONI ENTE
// =====================================================================
async function openImputazioniModal(movimento_id) {
  const { fmtImporto, escapeHtml } = window.UI;
  const m = await window.SB.getMovimento(movimento_id);
  if (!CACHE_ENTI.length) await preloadEnti();
  const enti = CACHE_ENTI.filter(e => e.attivo);
  const [existing, voci] = await Promise.all([
    window.SB.getImputazioni(movimento_id),
    window.SB.getVociBudget(m.progetto || "Generale"),
  ]);
  const byEnte = Object.fromEntries(existing.map(i => [i.ente_id, i]));

  // Costruisci options dropdown voci (gerarchico, indentato)
  function vociOptions(selected) {
    let opts = `<option value="">— nessuna —</option>`;
    voci.forEach(v => {
      const indent = v.parent_codice ? "&nbsp;&nbsp;&nbsp;&nbsp;" : "";
      const sel = selected === v.codice ? "selected" : "";
      opts += `<option value="${escapeHtml(v.codice)}" ${sel}>${indent}${escapeHtml(v.nome)}</option>`;
    });
    return opts;
  }

  const body = document.createElement("div");
  body.innerHTML = `
    <p class="mb-2"><strong>${escapeHtml(m.progressivo)}</strong> · ${escapeHtml(m.descrizione)}<br>
    <span class="text-muted">Totale movimento: ${fmtImporto(m.importo)} · Progetto: <strong>${escapeHtml(m.progetto || "Generale")}</strong></span></p>
    <p class="text-muted" style="font-size:12px;margin-bottom:8px">Le voci proposte sono quelle del progetto "${escapeHtml(m.progetto || "Generale")}". Cambia il progetto del movimento per averne altre.</p>
    <div class="imp-list">
      ${enti.map(e => {
        const c = byEnte[e.id];
        return `<div class="imp-row" data-ente="${e.id}">
          <div><strong>${escapeHtml(e.nome)}</strong>
            <div class="text-muted" style="font-size:11px">${escapeHtml(e.nome_completo||"")}</div></div>
          <input type="number" step="0.01" min="0" placeholder="Quota €" class="imp-quota" value="${c?+c.quota_importo:""}" />
          <select class="imp-voce">${vociOptions(c?.voce_budget || "")}</select>
          <input type="text" placeholder="Note" class="imp-note" value="${escapeHtml(c?c.note:'')}" />
        </div>`;
      }).join("")}
    </div>
    <div class="imp-totale parziale" id="imp-totale">Totale: ${fmtImporto(0)} / ${fmtImporto(m.importo)}</div>
  `;
  function refresh() {
    let tot = 0;
    body.querySelectorAll(".imp-row").forEach(r => tot += parseFloat(r.querySelector(".imp-quota").value) || 0);
    const div = body.querySelector("#imp-totale");
    div.textContent = `Totale: ${fmtImporto(tot)} / ${fmtImporto(m.importo)}`;
    div.classList.remove("ok","parziale","over");
    if (Math.abs(tot - +m.importo) < 0.01) div.classList.add("ok");
    else if (tot > +m.importo) div.classList.add("over");
    else div.classList.add("parziale");
  }
  body.querySelectorAll(".imp-quota").forEach(i => i.addEventListener("input", refresh));
  setTimeout(refresh, 0);

  openModal({
    title: "Imputazioni enti", body, saveLabel: "Salva", wide: true,
    onSave: async el => {
      const lista = [];
      el.querySelectorAll(".imp-row").forEach(row => {
        lista.push({
          ente_id: row.dataset.ente,
          quota_importo: row.querySelector(".imp-quota").value,
          voce_budget: row.querySelector(".imp-voce").value.trim(),
          note: row.querySelector(".imp-note").value.trim(),
        });
      });
      await window.SB.salvaImputazioni(movimento_id, lista);
      flash("Imputazioni salvate");
      if (location.hash.startsWith("#primanota")) primanotaLoad();
    }
  });
}

// =====================================================================
// ENTI E BUDGET
// =====================================================================
async function renderEnti() {
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  const sec = document.getElementById("enti-content");
  const enti = await window.SB.getEnti({ anno: ANNO_CORRENTE });
  const spese = await window.SB.speseImputatePerEnte(ANNO_CORRENTE);
  const oggi = new Date();

  sec.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Nome</th><th>Anno</th><th class="num">Budget</th>
        <th class="num">Spese imputate</th><th class="num">Residuo</th>
        <th>%</th><th>Scadenza</th><th class="col-azioni">Azioni</th>
      </tr></thead>
      <tbody>
      ${enti.length===0 ? `<tr><td colspan="8" class="empty">Nessun ente</td></tr>` : ""}
      ${enti.map(e => {
        const sp = spese[e.id] || 0;
        const res = +e.importo_assegnato - sp;
        const perc = +e.importo_assegnato > 0 ? Math.round(sp/+e.importo_assegnato*100) : 0;
        const cls = perc < 80 ? "green" : perc <= 100 ? "orange" : "red";
        const scd = e.scadenza_rendicontazione;
        const giorni = scd ? Math.round((new Date(scd) - oggi) / 86400000) : null;
        return `<tr>
          <td><strong>${escapeHtml(e.nome)}</strong><div class="text-muted" style="font-size:11px">${escapeHtml(e.nome_completo||"")}</div></td>
          <td>${e.anno||""}</td>
          <td class="num">${fmtImporto(e.importo_assegnato)}</td>
          <td class="num">${fmtImporto(sp)}</td>
          <td class="num" style="color:${res<0?'var(--rosso)':'inherit'}">${fmtImporto(res)}</td>
          <td>${perc}%<div class="budget-bar"><div class="fill ${cls}" style="width:${Math.min(100,perc)}%"></div></div></td>
          <td>${scd?fmtData(scd):"—"}${giorni!==null?` <span class="text-muted" style="font-size:11px">(${giorni}gg)</span>`:""}</td>
          <td class="col-azioni">
            <button class="icon-btn" data-act="edit" data-id="${e.id}">✎</button>
            <button class="icon-btn" data-act="toggle" data-id="${e.id}">${e.attivo?"🚫":"✓"}</button>
          </td>
        </tr>`;
      }).join("")}
      </tbody>
    </table></div>
  `;

  document.getElementById("btn-add-ente").onclick = () => openEnteModal(null, enti);
  document.querySelectorAll("[data-act=edit]").forEach(b => b.addEventListener("click", () => openEnteModal(b.dataset.id, enti)));
  document.querySelectorAll("[data-act=toggle]").forEach(b => b.addEventListener("click", async () => {
    const e = enti.find(x => x.id === b.dataset.id);
    await window.SB.salvaEnte({ ...e, attivo: !e.attivo });
    flash("Aggiornato"); renderEnti();
  }));
}

async function openEnteModal(id, enti) {
  const { escapeHtml } = window.UI;
  const e = id ? enti.find(x => x.id === id) : null;
  const body = document.createElement("div");
  body.innerHTML = `<div class="form-grid">
    <div class="full"><label>Nome breve</label><input id="en-nome" value="${escapeHtml(e?e.nome:'')}" /></div>
    <div class="full"><label>Nome completo</label><input id="en-nomec" value="${escapeHtml(e?e.nome_completo:'')}" /></div>
    <div><label>Anno</label><input id="en-anno" type="number" value="${e?e.anno:ANNO_CORRENTE}" /></div>
    <div><label>Budget</label><input id="en-imp" type="number" step="0.01" value="${e?+e.importo_assegnato:0}" /></div>
    <div><label>Scadenza rendicontazione</label><input id="en-scd" type="date" value="${e&&e.scadenza_rendicontazione?String(e.scadenza_rendicontazione).slice(0,10):''}" /></div>
  </div>`;
  openModal({
    title: id ? "Modifica ente" : "Nuovo ente", body,
    onSave: async el => {
      const data = {
        id: id || undefined,
        nome: el.querySelector("#en-nome").value.trim(),
        nome_completo: el.querySelector("#en-nomec").value.trim(),
        anno: parseInt(el.querySelector("#en-anno").value, 10),
        importo_assegnato: el.querySelector("#en-imp").value || 0,
        scadenza_rendicontazione: el.querySelector("#en-scd").value || null,
        attivo: e ? e.attivo : true,
      };
      if (!data.nome) return flash("Nome obbligatorio", "error"), false;
      await window.SB.salvaEnte(data);
      await preloadEnti();
      flash("Salvato"); renderEnti();
    }
  });
}

// =====================================================================
// RENDICONTAZIONE — preventivo vs consuntivo per ente
// =====================================================================
async function renderRendicontazione() {
  const { fmtImporto, escapeHtml } = window.UI;
  const PROGETTI = progettiNomi();
  const sec = document.getElementById("rendicontazione-content");
  if (!CACHE_ENTI.length) await preloadEnti();

  // Stato locale (riusa STATE per ricordare scelte)
  if (!STATE.rendicontazione) STATE.rendicontazione = {};
  const enti = CACHE_ENTI.filter(e => e.attivo);
  if (!STATE.rendicontazione.ente_id && enti[0]) STATE.rendicontazione.ente_id = enti[0].id;
  if (!STATE.rendicontazione.progetto) STATE.rendicontazione.progetto = "SSF Estivo";
  if (!STATE.rendicontazione.anno) STATE.rendicontazione.anno = ANNO_CORRENTE;

  const { ente_id, progetto, anno } = STATE.rendicontazione;

  sec.innerHTML = `
    <div class="filters">
      <div class="filter-group"><label>Ente</label>
        <select id="rc-ente">${enti.map(e => `<option value="${e.id}" ${ente_id===e.id?"selected":""}>${escapeHtml(e.nome)}</option>`).join("")}</select></div>
      <div class="filter-group"><label>Progetto</label>
        <select id="rc-progetto">${PROGETTI.map(p => `<option ${progetto===p?"selected":""}>${p}</option>`).join("")}</select></div>
      <div class="filter-group"><label>Anno</label>
        <select id="rc-anno">${[ANNO_CORRENTE-1,ANNO_CORRENTE,ANNO_CORRENTE+1].map(a => `<option ${anno===a?"selected":""}>${a}</option>`).join("")}</select></div>
      <div class="filter-group"><label>&nbsp;</label><button id="rc-export">📥 Esporta Excel</button></div>
    </div>
    <div id="rc-table"><div class="empty"><span class="spinner"></span> Caricamento...</div></div>
  `;
  document.getElementById("rc-ente").onchange = e => { STATE.rendicontazione.ente_id = e.target.value; renderRendicontazione(); };
  document.getElementById("rc-progetto").onchange = e => { STATE.rendicontazione.progetto = e.target.value; renderRendicontazione(); };
  document.getElementById("rc-anno").onchange = e => { STATE.rendicontazione.anno = +e.target.value; renderRendicontazione(); };
  document.getElementById("rc-export").onclick = async () => {
    try {
      flash("Genero Excel...", "info", 2000);
      console.log("[Export] avvio rendicontazione", { ente_id, progetto, anno });
      await window.EXPORT_SCREEN.esportaRendicontazioneFormatoMichele(ente_id, progetto, anno);
      flash("Excel scaricato", "success");
    } catch (e) {
      console.error("[Export] errore:", e);
      flash("Errore export: " + (e.message || e), "error", 8000);
    }
  };

  await loadRendicontazione();
}

async function loadRendicontazione() {
  const { fmtImporto, escapeHtml } = window.UI;
  const { ente_id, progetto, anno } = STATE.rendicontazione;
  const ente = CACHE_ENTI.find(e => e.id === ente_id);

  const [voci, budgetEnte, consuntivi] = await Promise.all([
    window.SB.getVociBudget(progetto),
    window.SB.getBudgetEnteVoce({ ente_id, progetto, anno }),
    window.SB.getConsuntivoEnteVoce({ ente_id, progetto, anno }),
  ]);

  const preventivoMap = Object.fromEntries(budgetEnte.map(b => [b.voce_codice, +b.preventivo || 0]));
  const consuntivoMap = Object.fromEntries(consuntivi.map(c => [c.voce_codice, +c.consuntivo || 0]));

  // Totali
  const totPrev = Object.values(preventivoMap).reduce((s, v) => s + v, 0);
  const totCons = Object.values(consuntivoMap).reduce((s, v) => s + v, 0);

  const rows = voci.map(v => {
    const prev = preventivoMap[v.codice] || 0;
    const cons = consuntivoMap[v.codice] || 0;
    const scost = prev - cons;
    const isParent = !v.parent_codice;
    const indent = v.parent_codice ? "padding-left:30px" : "font-weight:600";
    const bg = isParent ? "background:#f5f6fa" : "";
    return `<tr style="${bg}">
      <td style="${indent}">${escapeHtml(v.nome)}</td>
      <td class="num">
        <input type="number" step="0.01" min="0" data-voce="${escapeHtml(v.codice)}" class="rc-prev"
          value="${prev > 0 ? prev : ""}" style="width:100px;text-align:right" placeholder="—" />
      </td>
      <td class="num ${cons > 0 ? 'importo-uscita' : 'text-muted'}">
        ${cons > 0 ? fmtImporto(cons) : '—'}
      </td>
      <td class="num">${prev > 0 || cons > 0 ? `<span style="color:${scost < 0 ? 'var(--rosso)' : 'var(--verde)'}">${fmtImporto(scost)}</span>` : '—'}</td>
      <td>
        ${cons > 0 ? `<button class="icon-btn" data-act="drill" data-voce="${escapeHtml(v.codice)}" title="Vedi movimenti">📋</button>` : ''}
      </td>
    </tr>`;
  }).join("");

  document.getElementById("rc-table").innerHTML = `
    <p class="text-muted mb-2" style="font-size:13px">
      <strong>${escapeHtml(ente.nome)}</strong> · ${escapeHtml(ente.nome_completo || "")} · Budget ente assegnato: ${fmtImporto(ente.importo_assegnato || 0)}
    </p>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Voce di costo</th>
          <th class="num">Preventivo</th>
          <th class="num">Consuntivo</th>
          <th class="num">Scostamento</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${rows}
          <tr class="totali-row">
            <td><strong>TOTALE</strong></td>
            <td class="num"><strong>${fmtImporto(totPrev)}</strong></td>
            <td class="num"><strong>${fmtImporto(totCons)}</strong></td>
            <td class="num"><strong style="color:${totPrev-totCons<0?'var(--rosso)':'var(--verde)'}">${fmtImporto(totPrev - totCons)}</strong></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="text-muted mt-1" style="font-size:11px">💡 Modifica i preventivi nelle celle bianche — vengono salvati automaticamente sull'uscita dal campo.</p>
  `;

  // Salvataggio automatico preventivo onblur
  document.querySelectorAll(".rc-prev").forEach(inp => {
    inp.addEventListener("blur", async () => {
      const voce_codice = inp.dataset.voce;
      const preventivo = parseFloat(inp.value) || 0;
      try {
        await window.SB.setPreventivo({ ente_id, voce_codice, progetto, anno, preventivo });
        flash("Preventivo salvato", "success", 1500);
      } catch (e) { flash("Errore: " + e.message, "error"); }
    });
  });

  // Drill-down: mostra movimenti che hanno alimentato il consuntivo
  document.querySelectorAll("[data-act=drill]").forEach(b => b.addEventListener("click", async () => {
    const voce_codice = b.dataset.voce;
    const movs = await window.SB.getMovimentiPerVoceEnte({ ente_id, voce_codice, progetto, anno });
    const voce = voci.find(v => v.codice === voce_codice);
    const body = document.createElement("div");
    body.innerHTML = `
      <p><strong>${escapeHtml(voce?.nome || voce_codice)}</strong> · ${escapeHtml(ente.nome)} · ${escapeHtml(progetto)} ${anno}</p>
      <table style="margin-top:12px">
        <thead><tr><th>Progr.</th><th>Data</th><th>Descrizione</th><th>Fornitore</th><th class="num">Quota</th></tr></thead>
        <tbody>${movs.map(m => `<tr>
          <td>${escapeHtml(m.progressivo)}</td>
          <td>${window.UI.fmtData(m.data)}</td>
          <td>${escapeHtml((m.descrizione||"").substring(0,60))}</td>
          <td>${escapeHtml(m.fornitore_cliente||"")}</td>
          <td class="num">${fmtImporto(m.quota_imputata)}</td>
        </tr>`).join("")}</tbody>
      </table>
    `;
    openModal({ title: "Movimenti su questa voce", body, showFooter: false, wide: true });
  }));
}

// =====================================================================
// NOTE SPESE (vista admin/editor)
// =====================================================================
async function renderNoteSpese() {
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  const sec = document.getElementById("note-spese-content");
  const note = await window.SB.getNoteSpese();
  sec.innerHTML = `
    <p class="text-muted mb-2">Le note spese ricevute dal form mobile arrivano qui. Click su "→ Trasforma in movimento" per inserirle in primanota.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Persona</th><th>Evento</th><th>Progetto</th><th class="num">Totale</th><th>Stato</th><th>Azioni</th></tr></thead>
      <tbody>
      ${note.length === 0 ? `<tr><td colspan="7" class="empty">Nessuna nota spese</td></tr>` : ""}
      ${note.map(n => `<tr>
        <td>${fmtData(n.data)}</td>
        <td>${escapeHtml(n.persona)}</td>
        <td>${escapeHtml(n.evento||"")}</td>
        <td>${escapeHtml(n.progetto||"")}</td>
        <td class="num">${fmtImporto(n.totale)}</td>
        <td><span class="badge-stato ${n.stato==='Da elaborare'?'in-lavorazione':'accoppiato'}">${escapeHtml(n.stato)}</span></td>
        <td>
          <button class="icon-btn" data-act="view" data-id="${n.id}" title="Vedi dettagli">👁</button>
          ${n.stato === 'Da elaborare' ? `<button class="small success" data-act="trasforma" data-id="${n.id}">→ Trasforma</button>` : ""}
          ${CURRENT_USER.ruolo === 'admin' ? `<button class="icon-btn" data-act="elimina" data-id="${n.id}" title="Elimina nota spese" style="color:var(--rosso)">🗑</button>` : ""}
        </td>
      </tr>`).join("")}
      </tbody>
    </table></div>
  `;
  document.querySelectorAll("[data-act=view]").forEach(b => b.addEventListener("click", () => {
    const n = note.find(x => x.id === b.dataset.id);
    const voci = Array.isArray(n.voci) ? n.voci : [];
    const body = `
      <p><strong>${escapeHtml(n.persona)}</strong> · ${fmtData(n.data)} · ${escapeHtml(n.progetto||"")}</p>
      <p class="text-muted">${escapeHtml(n.evento||"")}</p>
      <table style="margin-top:12px"><thead><tr><th>Tipo</th><th>Descrizione</th><th class="num">€</th><th>Scontrino</th></tr></thead>
      <tbody>${voci.map(v => `<tr>
        <td>${escapeHtml(v.tipo||"")}</td>
        <td>${escapeHtml(v.descrizione||"")}</td>
        <td class="num">${fmtImporto(v.importo)}</td>
        <td>${v.link_scontrino?`<a href="${escapeHtml(v.link_scontrino)}" target="_blank">link</a>`:"—"}</td>
      </tr>`).join("")}</tbody></table>
      <p class="mt-2"><strong>Totale:</strong> ${fmtImporto(n.totale)} · Metodo: ${escapeHtml(n.metodo_pagamento||"")}</p>
    `;
    openModal({ title: "Nota spese", body, showFooter: false });
  }));
  document.querySelectorAll("[data-act=trasforma]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm2("Trasformare in movimento di primanota?")) return;
    try {
      await window.SB.trasformaNotaInMovimento(b.dataset.id);
      flash("Trasformata in movimento");
      renderNoteSpese();
    } catch (e) { flash(e.message, "error", 6000); }
  }));

  document.querySelectorAll("[data-act=elimina]").forEach(b => b.addEventListener("click", async () => {
    const n = note.find(x => x.id === b.dataset.id);
    const nLink = (n.voci || []).filter(v => v.link_scontrino).length;
    const msg = `Eliminare DEFINITIVAMENTE questa nota spese?\n\n` +
                `${escapeHtml(n.persona)} · ${fmtData(n.data)} · ${fmtImporto(n.totale)}\n` +
                `${(n.voci||[]).length} voci, ${nLink} con allegato.\n\n` +
                `(I file Drive/Storage rimangono al loro posto — viene cancellato solo il record nota spese.)`;
    if (!confirm2(msg)) return;
    try {
      await window.SB.eliminaNotaSpese(b.dataset.id);
      flash("Nota spese eliminata", "success");
      renderNoteSpese();
    } catch (e) { flash("Errore: " + e.message, "error", 6000); }
  }));
}

// =====================================================================
// IMPOSTAZIONI
// =====================================================================
async function renderImpostazioni() {
  if (CURRENT_USER.ruolo !== "admin") return;
  const sec = document.getElementById("impostazioni-content");
  sec.innerHTML = `
    <div class="cards-grid" style="grid-template-columns:1fr">
      <div class="card">
        <h3 style="margin:0 0 12px">Gestione utenti e ruoli</h3>
        <p class="text-muted" style="font-size:13px">Gli utenti si gestiscono direttamente da Supabase: <a href="${window.CONFIG.SUPABASE_URL.replace('/rest/v1','')}" target="_blank">Apri dashboard</a> → <strong>Authentication → Users</strong>.</p>
        <ol style="font-size:13px;line-height:1.7;margin:8px 0 0 16px;padding:0">
          <li><strong>Aggiungere utente</strong>: Add user → Create new user → email + password + spunta "Auto Confirm User"</li>
          <li><strong>Cambiare ruolo</strong>: click sull'utente → scorri fino a "Raw user metadata" → modifica:
            <pre style="background:#f5f6fa;padding:8px;border-radius:4px;margin:4px 0;font-size:12px">{ "nome": "Mario Rossi", "ruolo": "admin" }</pre>
            ruoli ammessi: <code>admin</code> · <code>editor</code> · <code>viewer</code>
          </li>
          <li><strong>Effetto</strong>: l'utente deve fare logout + login per vedere il nuovo ruolo</li>
        </ol>
      </div>

      <div class="card">
        <h3 style="margin:0 0 12px">Progetti dell'associazione</h3>
        <p class="text-muted" style="font-size:13px">Definisci i progetti che usi per classificare i movimenti (es. SSF Estivo, SSF EDU, Silent Tales...). Disattivare un progetto lo nasconde dai dropdown ma non cancella i movimenti già assegnati.</p>
        <div id="progetti-list" class="mt-1"></div>
        <button class="mt-1" id="btn-add-progetto">+ Aggiungi progetto</button>
      </div>

      <div class="card">
        <h3 style="margin:0 0 12px">Voci budget</h3>
        <p class="text-muted" style="font-size:13px">Le voci di costo gerarchiche per progetto. Usate nelle imputazioni e nella rendicontazione.</p>
        <div class="form-grid" style="grid-template-columns:1fr auto">
          <select id="vb-prog-select"></select>
          <button class="secondary" id="btn-add-voce">+ Aggiungi voce</button>
        </div>
        <div id="voci-list" class="mt-1"></div>
      </div>

      <div class="card">
        <h3 style="margin:0 0 12px">Backup dati</h3>
        <p class="text-muted" style="font-size:13px">Esporta tutte le tabelle in un singolo file JSON. Consigliato settimanale.</p>
        <button id="btn-backup">Esporta backup JSON</button>
        <p class="text-muted" style="font-size:12px;margin-top:8px">
          💡 Per resettare i dati di prova: SQL Editor di Supabase → incolla <code>supabase_reset_dati.sql</code>.
        </p>
      </div>

      <div class="card">
        <h3 style="margin:0 0 12px">Rinumerazione progressivi</h3>
        <p class="text-muted" style="font-size:13px">
          La numerazione progressivo è <strong>automatica</strong>: ogni movimento riceve un numero in ordine cronologico, ad esclusione delle righe segnate come "escludi" (es. commissioni bancarie, bolli). I cambi data, escludi o suffisso scatenano un ricalcolo automatico.<br>
          Usa il bottone qui sotto SOLO se sospetti uno stato inconsistente:
        </p>
        <div class="form-grid" style="grid-template-columns:auto auto;align-items:end;gap:8px">
          <div><label>Anno</label><select id="rinum-anno">
            <option value="${ANNO_CORRENTE-1}">${ANNO_CORRENTE-1}</option>
            <option value="${ANNO_CORRENTE}" selected>${ANNO_CORRENTE}</option>
            <option value="${ANNO_CORRENTE+1}">${ANNO_CORRENTE+1}</option>
          </select></div>
          <div><button id="btn-rinum" class="secondary">Forza ricalcolo</button></div>
        </div>
      </div>

      <div class="card">
        <h3 style="margin:0 0 12px">Form Note Spese</h3>
        <p class="text-muted" style="font-size:13px">PIN configurato in <code>config.js</code>: <strong>${window.CONFIG.NOTE_SPESE_PIN}</strong></p>
        <a href="form-note-spese.html" target="_blank" class="btn">Apri form note spese</a>
      </div>

      <div class="card">
        <h3 style="margin:0 0 12px">Anomalie aperte</h3>
        <div id="anomalie-list"></div>
      </div>
    </div>
  `;

  // === Gestione Progetti ===
  await caricaProgettiUI();
  document.getElementById("btn-add-progetto").onclick = () => openProgettoModal();

  // === Gestione Voci Budget ===
  const vbSel = document.getElementById("vb-prog-select");
  vbSel.innerHTML = progettiNomi().map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  vbSel.addEventListener("change", () => caricaVociUI(vbSel.value));
  document.getElementById("btn-add-voce").onclick = () => openVoceModal(vbSel.value);
  await caricaVociUI(vbSel.value);

  document.getElementById("btn-rinum").onclick = async () => {
    const anno = +document.getElementById("rinum-anno").value;
    if (!confirm2(`Rinumerare tutti i progressivi dell'anno ${anno} in ordine cronologico?\n\n⚠️ Eventuali numeri custom verranno sovrascritti.`)) return;
    try {
      await window.SB.ricalcolaProgressivi(anno);
      flash(`Progressivi ${anno} ricompattati`, "success");
    } catch (e) {
      flash("Errore: " + e.message, "error", 6000);
    }
  };

  document.getElementById("btn-backup").onclick = async () => {
    flash("Esporto backup...", "info");
    const data = await window.SB.esportaBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `roerso_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash("Backup scaricato");
  };

  // Anomalie
  try {
    const anom = await window.SB.getAnomalie("aperta");
    const div = document.getElementById("anomalie-list");
    if (!anom.length) {
      div.innerHTML = `<p class="text-muted">Nessuna anomalia aperta.</p>`;
    } else {
      div.innerHTML = anom.map(a => `<div style="padding:8px;border:1px solid var(--grigio-bordo);border-radius:4px;margin-bottom:6px">
        <strong>${window.UI.escapeHtml(a.tipo)}</strong> · ${window.UI.escapeHtml(a.descrizione)}
        <button class="icon-btn" style="float:right" data-risolvi="${a.id}">✓ Risolvi</button>
      </div>`).join("");
      div.querySelectorAll("[data-risolvi]").forEach(b => b.addEventListener("click", async () => {
        await window.SB.risolviAnomalia(b.dataset.risolvi);
        renderImpostazioni();
      }));
    }
  } catch {}
}

// =====================================================================
// RECOVERY PASSWORD
// Supabase invia link tipo /#access_token=...&type=recovery&...
// In quel caso il client crea sessione "PASSWORD_RECOVERY" automaticamente
// e noi mostriamo un form per impostare la nuova password.
// =====================================================================
function isRecoveryFlow() {
  const hash = window.location.hash || "";
  return /[#&?]type=recovery(?:&|$)/.test(hash);
}

function isRecoveryError() {
  const hash = window.location.hash || "";
  return /error=access_denied|otp_expired|error_code=/.test(hash);
}

function parseHashParams() {
  const hash = (window.location.hash || "").replace(/^#/, "");
  const out = {};
  hash.split("&").forEach(p => {
    const [k, v] = p.split("=");
    if (k) out[decodeURIComponent(k)] = decodeURIComponent((v || "").replace(/\+/g, " "));
  });
  return out;
}

function showRecoveryError() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app-shell").style.display = "none";
  const params = parseHashParams();
  const msg = params.error_description || "Link non valido";

  const old = document.getElementById("recovery-screen");
  if (old) old.remove();
  const host = document.createElement("div");
  host.id = "recovery-screen";
  host.className = "login-screen";
  host.innerHTML = `
    <div class="login-box" style="text-align:center">
      <h1 style="color:var(--rosso)">Link scaduto</h1>
      <p style="color:var(--grigio-testo);margin:8px 0 16px">${escapeHTMLLocal(msg)}</p>
      <p style="font-size:13px;line-height:1.5">
        Il link di reimpostazione password è scaduto (i link Supabase durano 1 ora).
        Richiedi un nuovo link dall'admin del progetto o usa il pannello Supabase per
        impostare la password manualmente.
      </p>
      <button id="back-to-login" style="margin-top:16px;width:100%;padding:10px">Torna al login</button>
    </div>
  `;
  document.body.appendChild(host);
  document.getElementById("back-to-login").onclick = () => {
    window.location.replace(window.location.origin + window.location.pathname);
  };
}

function escapeHTMLLocal(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function showRecoveryForm() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app-shell").style.display = "none";

  // Rimuovi eventuale form recovery preesistente
  const old = document.getElementById("recovery-screen");
  if (old) old.remove();

  const host = document.createElement("div");
  host.id = "recovery-screen";
  host.className = "login-screen";
  host.innerHTML = `
    <form id="recovery-form" class="login-box">
      <h1>Reimposta password</h1>
      <p class="sottotitolo">Inserisci la nuova password per il tuo account</p>
      <div style="margin-bottom:12px">
        <label for="rec-pwd">Nuova password</label>
        <input id="rec-pwd" type="password" required minlength="8" autocomplete="new-password" />
      </div>
      <div style="margin-bottom:16px">
        <label for="rec-pwd2">Conferma password</label>
        <input id="rec-pwd2" type="password" required minlength="8" autocomplete="new-password" />
      </div>
      <button type="submit" style="width:100%;padding:10px">Imposta password</button>
      <p id="rec-err" style="color:var(--rosso);font-size:12px;margin-top:10px;display:none"></p>
      <p id="rec-ok" style="color:var(--verde);font-size:13px;margin-top:10px;display:none;text-align:center">
        ✓ Password aggiornata. Ti sto reindirizzando al login...
      </p>
    </form>
  `;
  document.body.appendChild(host);

  document.getElementById("recovery-form").addEventListener("submit", async e => {
    e.preventDefault();
    const p1 = document.getElementById("rec-pwd").value;
    const p2 = document.getElementById("rec-pwd2").value;
    const errEl = document.getElementById("rec-err");
    const okEl  = document.getElementById("rec-ok");
    errEl.style.display = "none";

    if (p1.length < 8) {
      errEl.textContent = "La password deve essere di almeno 8 caratteri.";
      errEl.style.display = "block"; return;
    }
    if (p1 !== p2) {
      errEl.textContent = "Le due password non coincidono.";
      errEl.style.display = "block"; return;
    }

    try {
      const { error } = await window.sb.auth.updateUser({ password: p1 });
      if (error) throw error;
      okEl.style.display = "block";
      // Logout + URL pulito
      await window.sb.auth.signOut();
      setTimeout(() => {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.location.replace(cleanUrl);
      }, 1500);
    } catch (err) {
      errEl.textContent = err.message || "Errore aggiornamento password";
      errEl.style.display = "block";
    }
  });
}

// =====================================================================
// ALLEGA DOCUMENTO A MOVIMENTO (partendo dal movimento, scegli doc dalla coda)
// =====================================================================
async function apriModaleAllegaDocumentoDaMovimento(movId) {
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  const mov = await window.SB.getMovimento(movId);
  // Carica documenti da abbinare (coda)
  const docs = await window.SB.getDocumentiInCoda({ stato: 'da_abbinare' });
  // Calcola score per ognuno rispetto al movimento
  const ranked = docs.map(d => ({
    ...d,
    score: window.SB.calcolaScoreMatch(mov, {
      importo: d.ai_importo,
      data: d.ai_data_documento,
      data_documento: d.ai_data_documento,
      fornitore_cliente: d.ai_fornitore,
    }),
  })).sort((a, b) => b.score - a.score);

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="alert alert-info" style="font-size:13px">
      Movimento: <strong>${escapeHtml(mov.progressivo!=null?String(mov.progressivo):'—')}</strong> · ${fmtData(mov.data)} · ${escapeHtml(mov.descrizione||'').substring(0,80)} · <strong>${fmtImporto(mov.importo)}</strong>
    </div>
    ${docs.length === 0 ? `<div class="alert alert-warning">Nessun documento in coda "Da abbinare". Importa documenti via Drive Picker o carica manualmente.</div>` : `
    <p style="font-size:13px;margin-bottom:6px">Seleziona il documento da allegare:</p>
    <input id="dochint-search" placeholder="🔍 Filtra per nome file o fornitore..." style="margin-bottom:8px" />
    <div id="dochint-list" style="max-height:380px;overflow-y:auto;display:flex;flex-direction:column;gap:6px"></div>
    `}
  `;

  function renderLista(filtro = "") {
    const host = body.querySelector("#dochint-list");
    if (!host) return;
    const flt = filtro.toLowerCase();
    const items = ranked.filter(d =>
      !flt
      || (d.nome_file||'').toLowerCase().includes(flt)
      || (d.ai_fornitore||'').toLowerCase().includes(flt)
      || (d.ai_descrizione||'').toLowerCase().includes(flt)
    );
    host.innerHTML = items.map(d => `
      <label class="dochint-row" style="display:flex;gap:10px;align-items:center;padding:8px;border:1px solid var(--grigio-bordo);border-radius:4px;cursor:pointer">
        <input type="radio" name="docpick" value="${escapeHtml(d.drive_file_id)}" />
        <div style="flex:1;font-size:13px">
          <strong>${escapeHtml(d.nome_file)}</strong>
          <div class="text-muted" style="font-size:11px">${escapeHtml(d.ai_fornitore||'')} · ${fmtImporto(d.ai_importo||0)} · ${d.ai_data_documento?fmtData(d.ai_data_documento):'(no data)'}</div>
        </div>
        <div style="text-align:right;font-size:11px">
          <a href="${escapeHtml(d.web_view_link||'#')}" target="_blank">apri</a>
          <div class="text-muted">match <strong>${d.score}%</strong></div>
        </div>
      </label>
    `).join("");
  }

  openModal({
    title: "📎 Allega documento al movimento", body, wide: true,
    saveLabel: "Allega selezionato",
    onSave: async () => {
      const sel = body.querySelector('input[name="docpick"]:checked');
      if (!sel) return flash("Seleziona un documento", "warning"), false;
      const driveFileId = sel.value;
      const doc = docs.find(d => d.drive_file_id === driveFileId);
      try {
        await window.SB.allegaDocumentoAMovimento(movId, {
          link_documento: doc.web_view_link,
          data_documento: doc.ai_data_documento,
          numero_documento: doc.ai_numero_documento,
          drive_file_id: driveFileId,
        });
        await window.SB.aggiornaStatoDocumento(driveFileId, 'abbinato', movId, `Allegato da Prima Nota a ${mov.progressivo!=null?mov.progressivo:'—'}`);
        flash("Allegato"); primanotaLoad();
      } catch (e) { flash("Errore: " + e.message, "error"); return false; }
    }
  });
  setTimeout(() => {
    if (docs.length) {
      renderLista("");
      body.querySelector("#dochint-search").addEventListener("input", e => renderLista(e.target.value));
    }
  }, 50);
}

// =====================================================================
// (LEGACY) UNISCI MOVIMENTI — non più nel UI, mantenuto se serve da console
// =====================================================================
async function apriModaleUnisciMovimenti(sourceId) {
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  const src = await window.SB.getMovimento(sourceId);
  // Cerca candidati per il merge: stesso importo ±2, finestra date ampia, escluso source
  const matches = await window.SB.cercaMatchPerDocumento({
    data: src.data,
    data_documento: src.data_documento || src.data,
    importo: src.importo,
    fornitore_cliente: src.fornitore_cliente,
  });
  const candidates = matches.filter(m => m.id !== sourceId);

  const body = document.createElement("div");
  body.innerHTML = `
    <div class="alert alert-warning" style="font-size:13px">
      ⚠️ Unione: il documento (link) di questo movimento verrà trasferito al movimento target. Questo movimento (source) verrà <strong>eliminato</strong>.
    </div>
    <p style="font-size:13px;margin-bottom:6px"><strong>Movimento sorgente</strong> (da eliminare):</p>
    <div style="padding:8px;background:#fde0e0;border-radius:4px;margin-bottom:14px">
      ${escapeHtml(src.progressivo||'—')} · ${fmtData(src.data)} · ${escapeHtml(src.descrizione||'').substring(0,80)} · <strong>${fmtImporto(src.importo)}</strong> · ${src.metodo} · stato ${src.stato}
      ${src.link_documento ? '<br>📄 ha documento allegato' : '<br>(senza documento)'}
    </div>
    <p style="font-size:13px;margin-bottom:6px"><strong>Target</strong> (resterà):</p>
    ${candidates.length === 0 ? `<div class="alert alert-info">Nessun candidato simile. Usa la ricerca manuale.</div>` : `
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
        ${candidates.map(m => `
          <label style="display:flex;gap:10px;align-items:center;padding:8px;border:1px solid var(--grigio-bordo);border-radius:4px;cursor:pointer">
            <input type="radio" name="merge-target" value="${m.id}" />
            <div style="flex:1">
              <strong>${escapeHtml(m.progressivo||'—')}</strong> · ${fmtData(m.data)} · ${escapeHtml(m.descrizione||'').substring(0,60)}
              <div class="text-muted" style="font-size:11px">${escapeHtml(m.fornitore_cliente||'')} · ${m.metodo} · stato ${m.stato}</div>
            </div>
            <div style="text-align:right">
              <div class="${m.tipo==='ENTRATA'?'importo-entrata':'importo-uscita'}" style="font-weight:600">${fmtImporto(m.importo)}</div>
              <div class="text-muted" style="font-size:11px">match <strong>${m.score}%</strong></div>
            </div>
          </label>
        `).join("")}
      </div>
    `}
    <hr>
    <p style="font-size:13px">Oppure ricerca manuale per progressivo / importo:</p>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:6px">
      <input id="search-merge-progr" placeholder="Progressivo" />
      <input id="search-merge-imp" type="number" step="0.01" placeholder="Importo €" />
      <button type="button" class="secondary" id="btn-search-merge" style="grid-column:1/-1">🔍 Cerca</button>
    </div>
    <div id="search-merge-results" class="mt-1"></div>
  `;
  openModal({
    title: "🔀 Unisci con altro movimento", body, wide: true, saveLabel: "Conferma unione",
    onSave: async el => {
      const sel = el.querySelector('input[name="merge-target"]:checked');
      if (!sel) return flash("Seleziona un movimento target", "warning"), false;
      const targetId = sel.value;
      try {
        await window.SB.unisciMovimenti(sourceId, targetId);
        flash("Movimenti uniti", "success"); primanotaLoad();
      } catch (e) { flash("Errore: " + e.message, "error"); return false; }
    }
  });
  // Ricerca manuale
  setTimeout(() => {
    document.getElementById("btn-search-merge").onclick = async () => {
      const progr = document.getElementById("search-merge-progr").value.trim();
      const imp = parseFloat(document.getElementById("search-merge-imp").value) || null;
      let q = window.sb.from("movimenti").select("id, progressivo, data, descrizione, fornitore_cliente, importo, tipo, metodo, stato").neq("id", sourceId);
      if (progr) q = q.eq("progressivo", parseInt(progr, 10));
      if (imp) q = q.gte("importo", imp - 0.5).lte("importo", imp + 0.5);
      q = q.limit(10);
      const { data } = await q;
      const res = document.getElementById("search-merge-results");
      if (!data?.length) { res.innerHTML = `<p class="text-muted">Nessun risultato</p>`; return; }
      res.innerHTML = data.map(m => `
        <label style="display:flex;gap:10px;align-items:center;padding:6px;border:1px solid var(--grigio-bordo);border-radius:4px;margin-bottom:4px;cursor:pointer">
          <input type="radio" name="merge-target" value="${m.id}" />
          <div style="flex:1"><strong>${m.progressivo||'—'}</strong> · ${fmtData(m.data)} · ${escapeHtml(m.descrizione||'').substring(0,60)}</div>
          <div style="font-weight:600">${fmtImporto(m.importo)}</div>
        </label>
      `).join("");
    };
  }, 100);
}

// =====================================================================
// DOCUMENTI — coda triage + storico
// =====================================================================
let STATE_DOC_TAB = "da_abbinare";

async function renderDocumenti() {
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  const sec = document.getElementById("documenti-content");

  sec.innerHTML = `
    <div class="tabs">
      <button class="tab ${STATE_DOC_TAB==='da_abbinare'?'active':''}" data-tab="da_abbinare">📋 Da abbinare</button>
      <button class="tab ${STATE_DOC_TAB==='abbinato'?'active':''}"    data-tab="abbinato">🟢 Già abbinati</button>
      <button class="tab ${STATE_DOC_TAB==='cassa'?'active':''}"       data-tab="cassa">🔵 In cassa</button>
      <button class="tab ${STATE_DOC_TAB==='scartato'?'active':''}"    data-tab="scartato">🗑 Scartati</button>
    </div>
    <div id="documenti-list"><div class="empty"><span class="spinner"></span> Caricamento...</div></div>
  `;
  sec.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    STATE_DOC_TAB = t.dataset.tab;
    renderDocumenti();
  }));
  await caricaListaDocumenti();
}

async function caricaListaDocumenti() {
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  const list = document.getElementById("documenti-list");
  const docs = await window.SB.getDocumentiInCoda({ stato: STATE_DOC_TAB });
  if (!docs.length) {
    list.innerHTML = `<div class="empty">Nessun documento in stato "${STATE_DOC_TAB}".</div>`;
    return;
  }
  list.innerHTML = docs.map(d => {
    const tipoBadge = d.ai_tipo === 'ENTRATA' ? '🟢 ENTRATA' : '🔴 USCITA';
    const importoCls = d.ai_tipo === 'ENTRATA' ? 'importo-entrata' : 'importo-uscita';
    return `
    <div class="doc-card" data-id="${escapeHtml(d.drive_file_id)}">
      <div class="doc-head">
        <div class="doc-title">
          <strong>${escapeHtml(d.nome_file)}</strong>
          ${d.folder_path ? `<span class="text-muted" style="font-size:11px">📁 ${escapeHtml(d.folder_path)}</span>` : ''}
        </div>
        <div class="doc-actions" id="doc-actions-${escapeHtml(d.drive_file_id)}"></div>
      </div>
      <div class="doc-body">
        <div class="doc-fields">
          <div><span class="lbl">Data doc.</span> ${d.ai_data_documento ? fmtData(d.ai_data_documento) : '—'}</div>
          <div><span class="lbl">Importo</span> <strong class="${importoCls}">${fmtImporto(d.ai_importo)}</strong></div>
          <div><span class="lbl">Tipo</span> ${d.ai_tipo || '—'}</div>
          <div><span class="lbl">Metodo</span> ${d.ai_metodo || '—'}</div>
          <div><span class="lbl">Categoria</span> ${d.ai_categoria || '—'}</div>
          <div><span class="lbl">Progetto</span> ${d.ai_progetto || '—'}</div>
          <div class="full"><span class="lbl">Fornitore</span> ${escapeHtml(d.ai_fornitore || '—')} ${d.ai_numero_documento ? '· n. '+escapeHtml(d.ai_numero_documento) : ''}</div>
          <div class="full"><span class="lbl">Descrizione</span> ${escapeHtml(d.ai_descrizione || '—')}</div>
        </div>
        <div class="doc-meta">
          <a href="${escapeHtml(d.web_view_link||'#')}" target="_blank" class="doc-link">📂 Apri PDF</a>
          ${d.movimento_id && d.movimenti ? `<a href="#primanota" class="doc-link">→ Movimento ${escapeHtml(d.movimenti.progressivo||'?')}</a>` : ''}
          ${d.match_score != null ? `<div class="text-muted" style="font-size:11px;margin-top:6px">Match score AI: <strong>${d.match_score}%</strong></div>` : ''}
          ${d.note_match ? `<div class="text-muted" style="font-size:11px">📝 ${escapeHtml(d.note_match)}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join("");

  // Per ognuno: popola le azioni in base allo stato
  for (const d of docs) {
    const host = document.getElementById(`doc-actions-${d.drive_file_id}`);
    if (!host) continue;
    if (d.stato === 'da_abbinare') {
      host.innerHTML = `
        <button class="small" data-act="match" data-id="${escapeHtml(d.drive_file_id)}">📎 Allega a movimento</button>
        <button class="small" data-act="cassa" data-id="${escapeHtml(d.drive_file_id)}">💰 Crea cassa</button>
        <button class="small" data-act="attesa" data-id="${escapeHtml(d.drive_file_id)}">⏳ Attesa EC</button>
        <button class="small secondary" data-act="scarta" data-id="${escapeHtml(d.drive_file_id)}">🗑 Scarta</button>
      `;
    } else if (d.stato === 'abbinato' || d.stato === 'cassa') {
      host.innerHTML = `
        <button class="small" data-act="allega-altro" data-id="${escapeHtml(d.drive_file_id)}" title="Allega lo stesso doc anche ad altri movimenti (N:1)">📎 Allega ad altro movimento</button>
        <button class="small secondary" data-act="riapri" data-id="${escapeHtml(d.drive_file_id)}">↶ Riapri</button>
      `;
    } else if (d.stato === 'scartato') {
      host.innerHTML = `
        <button class="small secondary" data-act="riapri" data-id="${escapeHtml(d.drive_file_id)}">↶ Riapri</button>
      `;
    }
  }

  list.querySelectorAll("[data-act=match]").forEach(b => b.onclick = () => apriModaleAllegaDocumento(b.dataset.id, docs.find(d => d.drive_file_id === b.dataset.id)));
  list.querySelectorAll("[data-act=allega-altro]").forEach(b => b.onclick = () => apriModaleAllegaDocumento(b.dataset.id, docs.find(d => d.drive_file_id === b.dataset.id)));
  list.querySelectorAll("[data-act=cassa]").forEach(b => b.onclick = () => creaMovimentoCassa(docs.find(d => d.drive_file_id === b.dataset.id)));
  list.querySelectorAll("[data-act=attesa]").forEach(b => b.onclick = () => creaMovimentoAttesaEC(docs.find(d => d.drive_file_id === b.dataset.id)));
  list.querySelectorAll("[data-act=scarta]").forEach(b => b.onclick = async () => {
    if (!confirm2("Scartare questo documento? Sarà visibile in 'Scartati' ma non più nella coda.")) return;
    await window.SB.aggiornaStatoDocumento(b.dataset.id, 'scartato', null, 'Scartato manualmente');
    flash("Documento scartato"); caricaListaDocumenti();
  });
  list.querySelectorAll("[data-act=riapri]").forEach(b => b.onclick = async () => {
    if (!confirm2("Riaprire questo documento e rimetterlo nella coda da abbinare?")) return;
    await window.SB.aggiornaStatoDocumento(b.dataset.id, 'da_abbinare', null, 'Riaperto manualmente');
    flash("Documento riaperto"); caricaListaDocumenti();
  });
}

// Modale Allega multi-select: 1 documento → N movimenti
// Mostra: top match (ranked) + lista paginata + filtri/ricerca
async function apriModaleAllegaDocumento(driveFileId, doc) {
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  // Stato locale del modale
  const state = {
    page: 1, size: 30,
    anno: null, mese: null, testo: "",
    selectedIds: new Set(),
  };

  // Primi candidati per score (top)
  const ranked = await window.SB.cercaMatchPerDocumento({
    data: doc.ai_data_documento,
    data_documento: doc.ai_data_documento,
    importo: doc.ai_importo,
    fornitore_cliente: doc.ai_fornitore,
  });

  const body = document.createElement("div");
  body.innerHTML = `
    <p class="text-muted mb-2" style="font-size:13px">
      Documento: <strong>${escapeHtml(doc.nome_file)}</strong> · ${escapeHtml(doc.ai_fornitore||'')} · ${fmtImporto(doc.ai_importo)} · ${fmtData(doc.ai_data_documento)}
    </p>

    ${ranked.length > 0 ? `
    <p style="font-size:13px;margin-bottom:6px"><strong>🎯 Top match suggeriti dall'AI</strong> (per score):</p>
    <div id="ranked-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px"></div>
    ` : ''}

    <hr style="margin:14px 0">
    <p style="font-size:13px;margin-bottom:6px"><strong>📋 Tutti i movimenti senza documento</strong> (Manca doc / Vuoto / Attesa EC):</p>
    <div class="form-grid" style="grid-template-columns:1fr 100px 100px auto;gap:6px;margin-bottom:8px">
      <input id="mlfilter-testo" placeholder="🔍 Cerca per fornitore, descrizione, n. documento..." />
      <select id="mlfilter-anno">
        <option value="">Anno qualsiasi</option>
        <option value="${ANNO_CORRENTE - 1}">${ANNO_CORRENTE - 1}</option>
        <option value="${ANNO_CORRENTE}" selected>${ANNO_CORRENTE}</option>
        <option value="${ANNO_CORRENTE + 1}">${ANNO_CORRENTE + 1}</option>
      </select>
      <select id="mlfilter-mese">
        <option value="">Mese qualsiasi</option>
        ${["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"]
          .map((m,i)=>`<option value="${i+1}">${m}</option>`).join("")}
      </select>
      <button type="button" class="secondary" id="mlfilter-btn">Aggiorna</button>
    </div>
    <div id="movs-libere-list" style="max-height:380px;overflow-y:auto;border:1px solid var(--grigio-bordo);border-radius:4px;padding:6px">
      <div class="empty"><span class="spinner"></span> Caricamento...</div>
    </div>
    <div id="movs-libere-paginazione" class="flex-between mt-1" style="font-size:12px"></div>

    <div id="multi-summary" style="margin-top:12px;padding:8px 12px;background:#e3f2fd;border-radius:4px;font-size:13px">
      <strong id="multi-count">0</strong> movimenti selezionati · <span id="multi-tot" class="text-muted">Totale: € 0,00</span>
    </div>
  `;

  function renderRanked() {
    const host = body.querySelector("#ranked-list");
    if (!host) return;
    host.innerHTML = ranked.slice(0, 5).map(m => rigaMovimento(m, true)).join("");
    bindRowEvents(host);
  }

  function rigaMovimento(m, showScore = false) {
    const checked = state.selectedIds.has(m.id) ? "checked" : "";
    return `
      <label class="ml-row" style="display:flex;gap:10px;align-items:center;padding:7px 10px;border:1px solid var(--grigio-bordo);border-radius:4px;cursor:pointer;${state.selectedIds.has(m.id) ? 'background:#d4edda':'background:white'}">
        <input type="checkbox" class="ml-check" data-id="${escapeHtml(m.id)}" ${checked} />
        <div style="flex:1;font-size:13px;line-height:1.3">
          <strong>${escapeHtml(m.progressivo!=null?String(m.progressivo):'—')}</strong> · ${fmtData(m.data)} · ${escapeHtml((m.descrizione||'').substring(0,60))}
          <div class="text-muted" style="font-size:11px">${escapeHtml(m.fornitore_cliente||'')} · ${m.metodo||''} · stato: ${m.stato||''}</div>
        </div>
        <div style="text-align:right">
          <div class="${m.tipo==='ENTRATA'?'importo-entrata':'importo-uscita'}" style="font-weight:600">${fmtImporto(m.importo)}</div>
          ${showScore && m.score != null ? `<div class="text-muted" style="font-size:11px">match <strong>${m.score}%</strong></div>` : ''}
        </div>
      </label>
    `;
  }

  // Mappa id → dati movimento per il computo totale selezione
  const allMovsCache = new Map();
  ranked.forEach(m => allMovsCache.set(m.id, m));

  function bindRowEvents(host) {
    host.querySelectorAll(".ml-check").forEach(cb => {
      cb.addEventListener("change", () => {
        if (cb.checked) state.selectedIds.add(cb.dataset.id);
        else state.selectedIds.delete(cb.dataset.id);
        cb.closest("label").style.background = cb.checked ? "#d4edda" : "white";
        updateSummary();
      });
    });
  }

  function updateSummary() {
    const ids = [...state.selectedIds];
    const tot = ids.reduce((s, id) => s + (parseFloat(allMovsCache.get(id)?.importo) || 0), 0);
    body.querySelector("#multi-count").textContent = ids.length;
    body.querySelector("#multi-tot").textContent = "Totale: " + fmtImporto(tot);
    // Compara con importo doc se presente
    if (doc.ai_importo && ids.length) {
      const delta = Math.abs(tot - doc.ai_importo);
      const colore = delta < 0.5 ? 'var(--verde)' : delta < 5 ? 'var(--arancio)' : 'var(--rosso)';
      body.querySelector("#multi-tot").innerHTML +=
        ` · doc: ${fmtImporto(doc.ai_importo)} · <span style="color:${colore}">Δ ${fmtImporto(tot - doc.ai_importo)}</span>`;
    }
  }

  async function caricaListaLibere() {
    const host = body.querySelector("#movs-libere-list");
    host.innerHTML = `<div class="empty"><span class="spinner"></span> Caricamento...</div>`;
    const r = await window.SB.cercaMovimentiLiberi({
      anno: state.anno, mese: state.mese, testo: state.testo,
      page: state.page, size: state.size,
    });
    r.movimenti.forEach(m => allMovsCache.set(m.id, m));
    if (!r.movimenti.length) {
      host.innerHTML = `<p class="text-muted text-center" style="padding:14px">Nessun movimento corrisponde ai filtri</p>`;
    } else {
      host.innerHTML = r.movimenti.map(m => rigaMovimento(m, false)).join("");
      bindRowEvents(host);
    }
    const totPages = Math.max(1, Math.ceil(r.total / r.size));
    body.querySelector("#movs-libere-paginazione").innerHTML = `
      <span>${r.total} movimenti · pag ${r.page}/${totPages}</span>
      <span class="flex" style="gap:4px">
        <button class="secondary small" id="ml-prev" ${r.page===1?'disabled':''}>◀</button>
        <button class="secondary small" id="ml-next" ${r.page===totPages?'disabled':''}>▶</button>
      </span>
    `;
    body.querySelector("#ml-prev").onclick = () => { state.page--; caricaListaLibere(); };
    body.querySelector("#ml-next").onclick = () => { state.page++; caricaListaLibere(); };
    updateSummary();
  }

  openModal({
    title: "📎 Allega documento a uno o più movimenti", body, wide: true,
    saveLabel: "Allega ai selezionati",
    onSave: async () => {
      const ids = [...state.selectedIds];
      if (!ids.length) return flash("Seleziona almeno un movimento", "warning"), false;
      try {
        await window.SB.allegaDocumentoAMovimenti(ids, {
          link_documento: doc.web_view_link,
          data_documento: doc.ai_data_documento,
          numero_documento: doc.ai_numero_documento,
          drive_file_id: driveFileId,
        });
        // Aggiorna stato documento: abbinato. Memorizza il primo movimento_id come riferimento (per UX) ma il legame N:1 è nei movimenti via drive_file_id.
        await window.SB.aggiornaStatoDocumento(driveFileId, 'abbinato', ids[0], `Allegato a ${ids.length} movimenti`);
        flash(`Allegato a ${ids.length} movimenti`, "success");
        caricaListaDocumenti();
      } catch (e) {
        flash("Errore: " + e.message, "error", 6000);
        return false;
      }
    }
  });

  // Eventi filtri
  setTimeout(() => {
    body.querySelector("#mlfilter-anno").value = ANNO_CORRENTE;
    body.querySelector("#mlfilter-btn").onclick = () => {
      state.anno = body.querySelector("#mlfilter-anno").value ? +body.querySelector("#mlfilter-anno").value : null;
      state.mese = body.querySelector("#mlfilter-mese").value ? +body.querySelector("#mlfilter-mese").value : null;
      state.testo = body.querySelector("#mlfilter-testo").value.trim();
      state.page = 1;
      caricaListaLibere();
    };
    body.querySelector("#mlfilter-testo").addEventListener("keypress", e => {
      if (e.key === "Enter") body.querySelector("#mlfilter-btn").click();
    });
    state.anno = ANNO_CORRENTE;
    renderRanked();
    caricaListaLibere();
  }, 50);
}

async function creaMovimentoCassa(doc) {
  if (!confirm2(`Creare un NUOVO movimento CASSA da questo documento?\n\n${doc.ai_fornitore} · ${window.UI.fmtImporto(doc.ai_importo)} · ${window.UI.fmtData(doc.ai_data_documento)}`)) return;
  const mov = await window.SB.salvaMovimento({
    data: doc.ai_data_documento || window.UI.todayISO(),
    data_documento: doc.ai_data_documento,
    tipo: doc.ai_tipo || 'USCITA',
    importo: doc.ai_importo || 0,
    descrizione: doc.ai_descrizione || doc.nome_file,
    fornitore_cliente: doc.ai_fornitore || '',
    numero_documento: doc.ai_numero_documento || '',
    categoria: doc.ai_categoria || 'U2',
    metodo: 'CASSA',
    progetto: doc.ai_progetto || 'Generale',
    link_documento: doc.web_view_link,
    drive_file_id: doc.drive_file_id,
    anno: parseInt((doc.ai_data_documento || window.UI.todayISO()).slice(0,4), 10),
  });
  await window.SB.aggiornaStatoDocumento(doc.drive_file_id, 'cassa', mov.id, `Creato movimento CASSA ${mov.progressivo||''}`);
  flash(`Creato movimento cassa ${mov.progressivo||''}`);
  caricaListaDocumenti();
}

async function creaMovimentoAttesaEC(doc) {
  if (!confirm2(`Creare un nuovo movimento "Attesa EC" (sarà pagato in futuro via BPE/NEXI)?\n\n${doc.ai_fornitore} · ${window.UI.fmtImporto(doc.ai_importo)}`)) return;
  const mov = await window.SB.salvaMovimento({
    data: doc.ai_data_documento || window.UI.todayISO(),
    data_documento: doc.ai_data_documento,
    tipo: doc.ai_tipo || 'USCITA',
    importo: doc.ai_importo || 0,
    descrizione: doc.ai_descrizione || doc.nome_file,
    fornitore_cliente: doc.ai_fornitore || '',
    numero_documento: doc.ai_numero_documento || '',
    categoria: doc.ai_categoria || 'U2',
    metodo: doc.ai_metodo || 'BPE',
    progetto: doc.ai_progetto || 'Generale',
    link_documento: doc.web_view_link,
    drive_file_id: doc.drive_file_id,
    anno: parseInt((doc.ai_data_documento || window.UI.todayISO()).slice(0,4), 10),
  });
  await window.SB.aggiornaStatoDocumento(doc.drive_file_id, 'abbinato', mov.id, `Movimento in attesa EC ${mov.progressivo||''}`);
  flash(`Creato movimento in attesa EC ${mov.progressivo||''}`);
  caricaListaDocumenti();
}

// =====================================================================
// CRUD UI: Progetti e Voci Budget (in Impostazioni)
// =====================================================================
async function caricaProgettiUI() {
  const { escapeHtml } = window.UI;
  const list = document.getElementById("progetti-list");
  if (!list) return;
  const progetti = await window.SB.getProgetti({ soloAttivi: false });
  list.innerHTML = `<table style="font-size:13px">
    <thead><tr><th>Nome</th><th>Descrizione</th><th>Ordine</th><th>Stato</th><th></th></tr></thead>
    <tbody>${progetti.map(p => `<tr>
      <td><strong>${escapeHtml(p.nome)}</strong></td>
      <td><span class="text-muted">${escapeHtml(p.descrizione||"")}</span></td>
      <td>${p.ordine||0}</td>
      <td>${p.attivo ? '<span class="badge-stato accoppiato">Attivo</span>' : '<span class="badge-stato no-doc">Disattivo</span>'}</td>
      <td>
        <button class="icon-btn" data-edit-prog="${p.id}">✎</button>
        <button class="icon-btn" data-toggle-prog="${p.id}">${p.attivo?"🚫":"✓"}</button>
        <button class="icon-btn" data-del-prog="${p.id}" style="color:var(--rosso)">🗑</button>
      </td>
    </tr>`).join("")}</tbody></table>`;
  list.querySelectorAll("[data-edit-prog]").forEach(b => b.onclick = () => openProgettoModal(progetti.find(p => p.id === b.dataset.editProg)));
  list.querySelectorAll("[data-toggle-prog]").forEach(b => b.onclick = async () => {
    const p = progetti.find(x => x.id === b.dataset.toggleProg);
    await window.SB.salvaProgetto({ ...p, attivo: !p.attivo });
    await preloadProgetti();
    caricaProgettiUI();
    flash("Progetto aggiornato");
  });
  list.querySelectorAll("[data-del-prog]").forEach(b => b.onclick = async () => {
    const p = progetti.find(x => x.id === b.dataset.delProg);
    if (!confirm2(`Eliminare il progetto "${p.nome}"?\nI movimenti già assegnati non vengono toccati ma perdono il riferimento.`)) return;
    try {
      await window.SB.eliminaProgetto(p.id);
      await preloadProgetti();
      caricaProgettiUI();
      flash("Eliminato");
    } catch (e) { flash("Errore: " + e.message, "error"); }
  });
}

function openProgettoModal(p = null) {
  const { escapeHtml } = window.UI;
  const body = document.createElement("div");
  body.innerHTML = `<div class="form-grid">
    <div class="full"><label>Nome *</label><input id="pr-nome" value="${escapeHtml(p?.nome||"")}" required /></div>
    <div class="full"><label>Descrizione</label><input id="pr-desc" value="${escapeHtml(p?.descrizione||"")}" /></div>
    <div><label>Ordine</label><input id="pr-ord" type="number" value="${p?.ordine ?? 50}" /></div>
    <div><label>Attivo</label><select id="pr-att"><option value="true" ${p?.attivo!==false?"selected":""}>Sì</option><option value="false" ${p?.attivo===false?"selected":""}>No</option></select></div>
  </div>`;
  openModal({
    title: p ? "Modifica progetto" : "Nuovo progetto", body,
    onSave: async el => {
      const data = {
        id: p?.id,
        nome: el.querySelector("#pr-nome").value.trim(),
        descrizione: el.querySelector("#pr-desc").value.trim(),
        ordine: parseInt(el.querySelector("#pr-ord").value, 10) || 50,
        attivo: el.querySelector("#pr-att").value === "true",
      };
      if (!data.nome) return flash("Nome obbligatorio", "error"), false;
      await window.SB.salvaProgetto(data);
      await preloadProgetti();
      caricaProgettiUI();
      const sel = document.getElementById("vb-prog-select");
      if (sel) sel.innerHTML = progettiNomi().map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
      flash("Salvato");
    }
  });
}

async function caricaVociUI(progetto) {
  const { escapeHtml } = window.UI;
  const list = document.getElementById("voci-list");
  if (!list) return;
  if (!progetto) { list.innerHTML = `<p class="text-muted">Seleziona un progetto</p>`; return; }
  const voci = await window.SB.getVociBudget(progetto);
  if (!voci.length) {
    list.innerHTML = `<p class="text-muted">Nessuna voce per "${escapeHtml(progetto)}". Aggiungi la prima col bottone sopra.</p>`;
    return;
  }
  list.innerHTML = `<table style="font-size:13px">
    <thead><tr><th>Codice</th><th>Nome</th><th>Padre</th><th>Ord.</th><th></th></tr></thead>
    <tbody>${voci.map(v => `<tr>
      <td><strong>${escapeHtml(v.codice)}</strong></td>
      <td>${escapeHtml(v.nome)}</td>
      <td>${escapeHtml(v.parent_codice||"—")}</td>
      <td>${v.ordine||0}</td>
      <td>
        <button class="icon-btn" data-edit-voce="${v.id}">✎</button>
        <button class="icon-btn" data-del-voce="${v.id}" style="color:var(--rosso)">🗑</button>
      </td>
    </tr>`).join("")}</tbody></table>`;
  list.querySelectorAll("[data-edit-voce]").forEach(b => b.onclick = () => openVoceModal(progetto, voci.find(v => v.id === b.dataset.editVoce)));
  list.querySelectorAll("[data-del-voce]").forEach(b => b.onclick = async () => {
    const v = voci.find(x => x.id === b.dataset.delVoce);
    if (!confirm2(`Eliminare la voce "${v.codice} ${v.nome}"? Le imputazioni esistenti non vengono toccate.`)) return;
    try {
      await window.SB.eliminaVoceBudget(v.id);
      caricaVociUI(progetto);
      flash("Eliminata");
    } catch (e) { flash("Errore: " + e.message, "error"); }
  });
}

function openVoceModal(progetto, v = null) {
  const { escapeHtml } = window.UI;
  const body = document.createElement("div");
  body.innerHTML = `<div class="form-grid">
    <div><label>Codice * (es. "5.2")</label><input id="vc-cod" value="${escapeHtml(v?.codice||"")}" placeholder="1, 1.1, 2.3..." required /></div>
    <div><label>Padre (es. "5")</label><input id="vc-par" value="${escapeHtml(v?.parent_codice||"")}" placeholder="vuoto = è una voce principale" /></div>
    <div class="full"><label>Nome *</label><input id="vc-nome" value="${escapeHtml(v?.nome||"")}" required /></div>
    <div><label>Ordine</label><input id="vc-ord" type="number" value="${v?.ordine ?? 50}" /></div>
    <div><label>Progetto</label><input value="${escapeHtml(progetto)}" disabled style="background:#f5f6fa" /></div>
  </div>
  <p class="text-muted" style="font-size:12px;margin-top:8px">💡 Le voci con codice tipo "1" sono <strong>raggruppi</strong>; "1.1", "1.2" sono <strong>sotto-voci</strong>.</p>`;
  openModal({
    title: v ? "Modifica voce" : "Nuova voce", body,
    onSave: async el => {
      const data = {
        id: v?.id,
        progetto,
        codice: el.querySelector("#vc-cod").value.trim(),
        nome: el.querySelector("#vc-nome").value.trim(),
        parent_codice: el.querySelector("#vc-par").value.trim() || null,
        ordine: parseInt(el.querySelector("#vc-ord").value, 10) || 50,
        attivo: true,
      };
      if (!data.codice || !data.nome) return flash("Codice e nome obbligatori", "error"), false;
      await window.SB.salvaVoceBudget(data);
      caricaVociUI(progetto);
      flash("Salvata");
    }
  });
}

// =====================================================================
// BOOT
// =====================================================================
document.addEventListener("DOMContentLoaded", async () => {
  // Wait for supabase module to attach window.sb / window.SB
  await new Promise(r => setTimeout(r, 200));

  // 1) Errore link recovery (es. scaduto)
  if (isRecoveryError()) {
    showRecoveryError();
    return;
  }

  // 2) Flow di recovery password (link da email valido)
  if (isRecoveryFlow()) {
    setTimeout(showRecoveryForm, 100);
    return;
  }

  // 2) Reagisci anche all'evento PASSWORD_RECOVERY emesso da Supabase
  //    (se per qualche motivo l'hash è diverso ma l'evento parte lo stesso)
  if (window.sb?.auth?.onAuthStateChange) {
    window.sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && !document.getElementById("recovery-screen")) {
        showRecoveryForm();
      }
    });
  }

  // 3) Flow normale
  setupLogin();
  try {
    CURRENT_USER = await window.SB?.currentUser();
    if (CURRENT_USER) {
      await showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
});
