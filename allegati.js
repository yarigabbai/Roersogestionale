// =====================================================================
// allegati.js — Gestione multi-allegati per movimento di prima nota
// =====================================================================

const TIPI_ALLEGATO = {
  fattura:     "📄 Fattura",
  distinta:    "🏦 Distinta",
  nota_spese:  "🧾 Nota spese",
  autofattura: "📋 Autofattura",
  busta_paga:  "💼 Busta paga",
  pdf_unito:   "🔀 PDF unito",
  altro:       "📎 Altro",
};

// ─────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────
export async function renderAllegatiSection(container, movimentoId) {
  container.innerHTML = `<div style="padding:12px 0;color:#888;font-size:13px"><span class="spinner"></span> Caricamento allegati…</div>`;
  try {
    const allegati = await window.SB.getAllegatiMovimento(movimentoId);
    _renderUI(container, movimentoId, allegati);
  } catch (e) {
    container.innerHTML = `<div class="alert alert-warning" style="font-size:12px">Allegati non disponibili: ${e.message}<br><small>Assicurati di aver eseguito <strong>supabase_patch_allegati.sql</strong> su Supabase.</small></div>`;
  }
}

// ─────────────────────────────────────────────
// UI PRINCIPALE
// ─────────────────────────────────────────────
function _renderUI(container, movimentoId, allegati) {
  const { escapeHtml } = window.UI;
  const canEdit = ["admin", "editor"].includes(window.CURRENT_USER?.ruolo);
  const pdfMergibili = allegati.filter(a =>
    a.tipo !== "pdf_unito" &&
    (a.mime_type === "application/pdf" || (a.nome || "").toLowerCase().endsWith(".pdf"))
  );
  const unitoEsistente = allegati.find(a => a.tipo === "pdf_unito");

  container.innerHTML = `
    <div class="form-card" style="margin-top:0">
      <!-- HEADER -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">📎 Allegati
          <span style="font-size:13px;font-weight:400;color:#888">(${allegati.length})</span>
        </h3>
        ${canEdit ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <!-- Carica dal computer -->
          <button class="secondary" id="btn-carica-file" style="font-size:12px">⬆️ Carica file</button>
          <input type="file" id="input-upload-allegato" multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" style="display:none" />
          <!-- Da Drive -->
          <button class="secondary" id="btn-allega-drive" style="font-size:12px">📂 Drive</button>
          <!-- Link diretto -->
          <button class="secondary" id="btn-allega-link" style="font-size:12px">🔗 Link</button>
        </div>` : ""}
      </div>

      <!-- LISTA ALLEGATI -->
      ${allegati.length === 0
        ? `<p class="text-muted" style="font-size:12px;margin:4px 0 12px">Nessun allegato. Carica un file o allega da Drive.</p>`
        : `<div id="lista-allegati" style="display:flex;flex-direction:column;gap:5px;margin-bottom:12px">
            ${allegati.map(a => _rigaAllegato(a, canEdit)).join("")}
           </div>`
      }

      <!-- TOOLBAR MERGE -->
      ${pdfMergibili.length >= 2 ? `
        <div id="merge-toolbar" style="background:#f0f4ff;border:1px solid #c5d3f0;border-radius:6px;padding:10px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px">
          <span style="color:#1e3a5f;font-weight:600">🔀 Unisci PDF</span>
          <span id="merge-count" style="color:#555">Seleziona i file da unire con le ✓ a sinistra</span>
          <button id="btn-unisci-sel" class="secondary" disabled style="font-size:12px">Unisci selezionati</button>
          <button id="btn-sel-tutti" class="secondary" style="font-size:12px">Seleziona tutti</button>
          ${unitoEsistente ? `<button id="btn-scarica-unito" class="secondary" style="font-size:12px">⬇️ Scarica PDF unito</button>` : ""}
        </div>` : `
        ${unitoEsistente ? `
          <div style="margin-top:8px">
            <button id="btn-scarica-unito" class="secondary" style="font-size:12px">⬇️ Scarica PDF unito esistente</button>
          </div>` : ""}
      `}

      <!-- PROGRESS BAR -->
      <div id="allegati-progress" style="display:none;margin-top:12px">
        <div style="background:#e8eef7;border-radius:6px;height:6px;overflow:hidden">
          <div id="allegati-progress-bar" style="background:var(--blu);height:100%;width:0%;transition:width .3s"></div>
        </div>
        <p id="allegati-progress-msg" style="font-size:11px;color:#888;margin:3px 0 0"></p>
      </div>
    </div>`;

  // ── 1. Carica file (button esplicito, non label-wrap) ──────────────
  const btnCarica = container.querySelector("#btn-carica-file");
  const inputUpload = container.querySelector("#input-upload-allegato");
  if (btnCarica && inputUpload) {
    btnCarica.addEventListener("click", () => {
      inputUpload.value = "";         // reset così change scatta anche per stesso file
      inputUpload.click();
    });
    inputUpload.addEventListener("change", async () => {
      const files = Array.from(inputUpload.files);
      if (!files.length) return;
      const tipo = await _scegliTipo();
      await _uploadMultipli(container, movimentoId, files, tipo);
      await renderAllegatiSection(container, movimentoId);
    });
  }

  // ── 2. Drive picker ────────────────────────────────────────────────
  container.querySelector("#btn-allega-drive")?.addEventListener("click", async () => {
    if (!window.DRIVE?.openPicker) {
      _flash("Autenticazione Google necessaria — vai in Analizza PDF", "warning"); return;
    }
    window.DRIVE.openPicker(async (file) => {
      const tipo = await _scegliTipo();
      await window.SB.allegaDriveAllegato(
        movimentoId, file.id || null,
        file.url || file.webViewLink || "",
        file.name || "File Drive", tipo
      );
      _flash("Allegato aggiunto");
      await renderAllegatiSection(container, movimentoId);
    });
  });

  // ── 3. Link diretto ────────────────────────────────────────────────
  container.querySelector("#btn-allega-link")?.addEventListener("click", async () => {
    const link = prompt("Incolla il link (Drive, URL pubblica):");
    if (!link?.trim()) return;
    const nome = prompt("Nome del documento:", link.split("/").pop()?.split("?")[0] || "Documento") || "Documento";
    const tipo = await _scegliTipo();
    await window.SB.allegaDriveAllegato(movimentoId, null, link.trim(), nome, tipo);
    _flash("Link allegato");
    await renderAllegatiSection(container, movimentoId);
  });

  // ── 4. Merge toolbar ───────────────────────────────────────────────
  _initMergeToolbar(container, movimentoId, pdfMergibili, unitoEsistente);

  // ── 5. Azioni su righe (apri, scarica, elimina) ───────────────────
  container.querySelectorAll("[data-all-act]").forEach(el => {
    const evt = el.tagName === "SELECT" ? "change" : "click";
    el.addEventListener(evt, async (e) => {
      e.stopPropagation();
      const act = el.dataset.allAct;
      const id = el.dataset.id;

      if (act === "apri" || act === "scarica") {
        let url = el.dataset.url || el.dataset.link || "";
        const path = el.dataset.path;
        if (path) {
          try { url = await window.SB.getSignedUrlAllegato(path); } catch {}
        }
        if (!url) { _flash("URL non disponibile", "warning"); return; }
        if (act === "apri") {
          window.open(url, "_blank");
        } else {
          const a = document.createElement("a");
          a.href = url; a.download = el.dataset.nome || "allegato"; a.click();
        }
      } else if (act === "elimina") {
        if (!confirm(`Eliminare "${el.dataset.nome}"?`)) return;
        await window.SB.eliminaAllegato(id);
        _flash("Eliminato");
        await renderAllegatiSection(container, movimentoId);
      } else if (act === "tipo") {
        await window.SB.aggiornaAllegato(id, { tipo: el.value });
      }
    });
  });
}

// ─────────────────────────────────────────────
// RIGA SINGOLO ALLEGATO
// ─────────────────────────────────────────────
function _rigaAllegato(a, canEdit) {
  const { escapeHtml } = window.UI;
  const isPdf = a.mime_type === "application/pdf" || (a.nome || "").toLowerCase().endsWith(".pdf");
  const isUnito = a.tipo === "pdf_unito";
  const icona = isUnito ? "🔀" : isPdf ? "📄" : (a.nome || "").match(/\.(jpe?g|png|webp)$/i) ? "🖼️" : "📎";
  const dim = a.dimensione ? ` · ${(a.dimensione / 1024).toFixed(0)} KB` : "";
  const hasUrl = a.storage_url || a.link;

  return `
  <div class="allegato-riga${isUnito ? " allegato-unito" : ""}" data-id="${a.id}">
    <!-- checkbox merge (solo PDF non-unito) -->
    ${isPdf && !isUnito
      ? `<input type="checkbox" class="chk-merge" data-id="${a.id}"
           title="Seleziona per merge" style="margin:0 2px 0 0;cursor:pointer" />`
      : `<span style="display:inline-block;width:18px"></span>`}

    <span class="allegato-icona">${icona}</span>

    <div class="allegato-info" style="flex:1;min-width:0">
      <span class="allegato-nome" title="${escapeHtml(a.nome||"")}">${escapeHtml((a.nome||"—").substring(0, 60))}</span>
      <small class="text-muted">${TIPI_ALLEGATO[a.tipo] || a.tipo}${dim}</small>
    </div>

    ${canEdit && !isUnito ? `
      <select data-all-act="tipo" data-id="${a.id}"
        title="Cambia tipo" style="font-size:11px;padding:2px 4px;max-width:110px">
        ${Object.entries(TIPI_ALLEGATO).filter(([v]) => v !== "pdf_unito").map(([v, l]) =>
          `<option value="${v}" ${a.tipo === v ? "selected" : ""}>${l}</option>`
        ).join("")}
      </select>` : ""}

    <div class="allegato-azioni">
      ${hasUrl ? `
        <button class="icon-btn" data-all-act="apri"
          data-id="${a.id}" data-path="${escapeHtml(a.storage_path || "")}"
          data-url="${escapeHtml(a.storage_url || a.link || "")}"
          title="Apri in nuova scheda">👁️</button>
        <button class="icon-btn" data-all-act="scarica"
          data-id="${a.id}" data-path="${escapeHtml(a.storage_path || "")}"
          data-url="${escapeHtml(a.storage_url || a.link || "")}"
          data-nome="${escapeHtml(a.nome || "allegato")}"
          title="Scarica">⬇️</button>` : ""}
      ${canEdit ? `
        <button class="icon-btn" data-all-act="elimina"
          data-id="${a.id}" data-nome="${escapeHtml(a.nome || "")}"
          title="Elimina">🗑</button>` : ""}
    </div>
  </div>`;
}

// ─────────────────────────────────────────────
// MERGE TOOLBAR (checkbox-based)
// ─────────────────────────────────────────────
function _initMergeToolbar(container, movimentoId, pdfMergibili, unitoEsistente) {
  const btnUnisci = container.querySelector("#btn-unisci-sel");
  const btnTutti = container.querySelector("#btn-sel-tutti");
  const countEl = container.querySelector("#merge-count");

  if (!btnUnisci) return;   // toolbar non presente (< 2 PDF)

  // Aggiorna stato pulsante in base alle checkbox selezionate
  function aggiornaStato() {
    const checked = container.querySelectorAll(".chk-merge:checked");
    const n = checked.length;
    btnUnisci.disabled = n < 2;
    countEl.textContent = n === 0
      ? "Seleziona almeno 2 file da unire"
      : n === 1
        ? "Seleziona almeno un altro file"
        : `${n} file selezionati → verranno uniti nell'ordine mostrato`;
  }

  container.querySelectorAll(".chk-merge").forEach(chk =>
    chk.addEventListener("change", aggiornaStato)
  );
  aggiornaStato();

  // Seleziona/deseleziona tutti
  let tuttiSelezionati = false;
  btnTutti.addEventListener("click", () => {
    tuttiSelezionati = !tuttiSelezionati;
    container.querySelectorAll(".chk-merge").forEach(c => c.checked = tuttiSelezionati);
    btnTutti.textContent = tuttiSelezionati ? "Deseleziona tutti" : "Seleziona tutti";
    aggiornaStato();
  });

  // Unisci selezionati
  btnUnisci.addEventListener("click", async () => {
    const ids = [...container.querySelectorAll(".chk-merge:checked")].map(c => c.dataset.id);
    const selezionati = pdfMergibili.filter(a => ids.includes(a.id));
    await _unisciPdf(container, movimentoId, selezionati);
  });

  // Scarica PDF unito
  container.querySelector("#btn-scarica-unito")?.addEventListener("click", async () => {
    if (!unitoEsistente) return;
    let url = unitoEsistente.storage_url || unitoEsistente.link;
    if (unitoEsistente.storage_path) {
      try { url = await window.SB.getSignedUrlAllegato(unitoEsistente.storage_path); } catch {}
    }
    if (url) window.open(url, "_blank");
  });
}

// ─────────────────────────────────────────────
// MERGE PDF (pdf-lib)
// ─────────────────────────────────────────────
async function _unisciPdf(container, movimentoId, allegatiDaUnire) {
  if (!window.PDFLib) {
    _flash("pdf-lib non disponibile — ricarica la pagina", "error"); return;
  }
  if (allegatiDaUnire.length < 2) {
    _flash("Seleziona almeno 2 PDF", "warning"); return;
  }

  const prog = container.querySelector("#allegati-progress");
  const bar = container.querySelector("#allegati-progress-bar");
  const msg = container.querySelector("#allegati-progress-msg");
  if (prog) prog.style.display = "block";

  try {
    const { PDFDocument } = window.PDFLib;
    const merged = await PDFDocument.create();
    let pagineTotali = 0;

    for (let i = 0; i < allegatiDaUnire.length; i++) {
      const a = allegatiDaUnire[i];
      if (msg) msg.textContent = `Elaborazione ${i + 1}/${allegatiDaUnire.length}: ${a.nome}`;
      if (bar) bar.style.width = `${Math.round((i / allegatiDaUnire.length) * 75)}%`;

      let url = a.storage_url || a.link;
      if (a.storage_path) {
        try { url = await window.SB.getSignedUrlAllegato(a.storage_path); } catch {}
      }
      if (!url) { _flash(`⚠️ "${a.nome}" senza URL — saltato`, "warning"); continue; }

      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const bytes = await resp.arrayBuffer();
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach(p => { merged.addPage(p); pagineTotali++; });
      } catch (e) {
        _flash(`⚠️ Impossibile includere "${a.nome}": ${e.message}`, "warning");
      }
    }

    if (pagineTotali === 0) { _flash("Nessuna pagina da unire", "error"); return; }

    if (msg) msg.textContent = "Salvataggio su Supabase Storage…";
    if (bar) bar.style.width = "88%";

    const pdfBytes = await merged.save();
    const mv = await window.SB.getMovimento(movimentoId);
    const nomeFile = `${mv?.data || ""}${mv?.progressivo ? "_" + mv.progressivo : ""}_unito.pdf`;

    await window.SB.salvaPdfUnito(movimentoId, pdfBytes, nomeFile);

    if (bar) bar.style.width = "100%";
    if (msg) msg.textContent = `✅ PDF unito: ${pagineTotali} pagine`;

    // Download automatico
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dlUrl; a.download = nomeFile; a.click();
    URL.revokeObjectURL(dlUrl);

    _flash(`PDF unito: ${pagineTotali} pagine — scaricato e salvato`);
    setTimeout(async () => {
      if (prog) prog.style.display = "none";
      await renderAllegatiSection(container, movimentoId);
    }, 1500);

  } catch (e) {
    _flash("Errore merge PDF: " + e.message, "error");
    if (prog) prog.style.display = "none";
  }
}

// ─────────────────────────────────────────────
// DIALOGO TIPO ALLEGATO
// ─────────────────────────────────────────────
function _scegliTipo() {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center";
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:24px;min-width:240px;box-shadow:0 8px 32px rgba(0,0,0,.3)">
        <h4 style="margin:0 0 14px;font-size:15px">Tipo allegato</h4>
        ${Object.entries(TIPI_ALLEGATO).filter(([v]) => v !== "pdf_unito").map(([v, l]) =>
          `<label style="display:flex;align-items:center;gap:10px;padding:7px 10px;cursor:pointer;border-radius:6px" class="tipo-opt">
            <input type="radio" name="_tipo_all" value="${v}" style="width:auto">${l}
          </label>`
        ).join("")}
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
          <button class="secondary" id="_tipo-cancel">Annulla</button>
          <button id="_tipo-ok">Conferma</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("input[value='altro']").checked = true;
    overlay.querySelector("#_tipo-ok").addEventListener("click", () => {
      const sel = overlay.querySelector("input[name='_tipo_all']:checked");
      overlay.remove(); resolve(sel?.value || "altro");
    });
    overlay.querySelector("#_tipo-cancel").addEventListener("click", () => {
      overlay.remove(); resolve("altro");
    });
    // click fuori chiude
    overlay.addEventListener("click", e => { if (e.target === overlay) { overlay.remove(); resolve("altro"); } });
  });
}

// ─────────────────────────────────────────────
// UPLOAD MULTIPLO CON PROGRESS
// ─────────────────────────────────────────────
async function _uploadMultipli(container, movimentoId, files, tipo) {
  const prog = container.querySelector("#allegati-progress");
  const bar = container.querySelector("#allegati-progress-bar");
  const msg = container.querySelector("#allegati-progress-msg");
  if (prog) prog.style.display = "block";
  let ok = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (msg) msg.textContent = `Caricamento ${i + 1}/${files.length}: ${f.name}`;
    if (bar) bar.style.width = `${Math.round((i / files.length) * 90)}%`;
    try {
      await window.SB.uploadAllegato(movimentoId, f, tipo);
      ok++;
    } catch (e) {
      _flash(`Errore "${f.name}": ${e.message}`, "error");
    }
  }

  if (bar) bar.style.width = "100%";
  if (msg) msg.textContent = `✅ ${ok}/${files.length} file caricati`;
  _flash(ok === files.length ? `${ok} file caricati` : `${ok}/${files.length} caricati (vedi errori)`, ok < files.length ? "warning" : "success");
  setTimeout(() => { if (prog) prog.style.display = "none"; }, 2000);
}

// ─────────────────────────────────────────────
// HELPER FLASH
// ─────────────────────────────────────────────
function _flash(msg, type = "success") {
  if (window.flash) window.flash(msg, type, 4000);
  else console.log("[allegati]", type, msg);
}

// ─────────────────────────────────────────────
// EXPORT GLOBALE
// ─────────────────────────────────────────────
window.ALLEGATI = { render: renderAllegatiSection };
