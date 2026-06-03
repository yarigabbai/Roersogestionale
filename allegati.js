// =====================================================================
// allegati.js — Gestione multi-allegati per movimento di prima nota
// =====================================================================
// Funzionalità:
//   - Lista allegati per movimento (fattura, distinta, nota spese, ecc.)
//   - Upload file diretto → Supabase Storage
//   - Allega link Drive tramite picker
//   - Elimina allegato (Storage + DB)
//   - Merge N PDF → salva PDF unito su Storage + download
// =====================================================================

const TIPI_ALLEGATO = {
  fattura:      "📄 Fattura",
  distinta:     "🏦 Distinta",
  nota_spese:   "🧾 Nota spese",
  autofattura:  "📋 Autofattura",
  busta_paga:   "💼 Busta paga",
  pdf_unito:    "🔀 PDF unito",
  altro:        "📎 Altro",
};

// Renderizza la sezione allegati (da chiamare nel form di modifica)
export async function renderAllegatiSection(container, movimentoId) {
  container.innerHTML = `<div style="padding:12px 0"><span class="spinner"></span> Caricamento allegati…</div>`;
  const allegati = await window.SB.getAllegatiMovimento(movimentoId);
  _renderAllegatiUI(container, movimentoId, allegati);
}

function _renderAllegatiUI(container, movimentoId, allegati) {
  const { escapeHtml } = window.UI;
  const canEdit = ["admin", "editor"].includes(window.CURRENT_USER?.ruolo);

  const hasPdf = allegati.filter(a => a.tipo !== "pdf_unito" &&
    (a.mime_type === "application/pdf" || (a.nome || "").toLowerCase().endsWith(".pdf")));

  container.innerHTML = `
    <div class="form-card" id="allegati-card" style="margin-top:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">📎 Allegati <span style="font-size:13px;font-weight:400;color:#888">(${allegati.length})</span></h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${hasPdf.length >= 2 ? `
            <button class="secondary" id="btn-unisci-pdf" title="Unisci tutti i PDF in un unico file">
              🔀 Unisci PDF (${hasPdf.length})
            </button>` : ""}
          ${allegati.some(a => a.tipo === "pdf_unito") ? `
            <a class="secondary" id="btn-scarica-unito" style="text-decoration:none;padding:6px 12px;border-radius:6px;border:1px solid #ccc;font-size:13px;cursor:pointer">
              ⬇️ Scarica PDF unito
            </a>` : ""}
          ${canEdit ? `
            <button class="secondary" id="btn-allega-drive" title="Allega file da Google Drive">📂 Drive</button>
            <label class="secondary" style="cursor:pointer;padding:6px 12px;border-radius:6px;border:1px solid #ccc;font-size:13px">
              ⬆️ Carica file
              <input type="file" id="input-upload-allegato" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" style="display:none" />
            </label>
          ` : ""}
        </div>
      </div>

      ${allegati.length === 0 ? `
        <p class="text-muted" style="font-size:12px;margin:8px 0">Nessun allegato. Carica un file o allega da Drive.</p>
      ` : `
        <div id="lista-allegati">
          ${allegati.map(a => _rigaAllegato(a, canEdit)).join("")}
        </div>
      `}

      <div id="allegati-progress" style="display:none;margin-top:12px">
        <div style="background:#e8eef7;border-radius:6px;height:8px;overflow:hidden">
          <div id="allegati-progress-bar" style="background:var(--blu);height:100%;width:0%;transition:width 0.3s"></div>
        </div>
        <p id="allegati-progress-msg" style="font-size:11px;color:#888;margin:4px 0 0"></p>
      </div>
    </div>`;

  // === Event listeners ===

  // Upload file(s) locale
  const inputUpload = container.querySelector("#input-upload-allegato");
  if (inputUpload) {
    inputUpload.addEventListener("change", async () => {
      const files = Array.from(inputUpload.files);
      if (!files.length) return;
      const tipoScelto = await _scegliTipo(container);
      await _uploadMultipli(container, movimentoId, files, tipoScelto);
      await renderAllegatiSection(container, movimentoId);
    });
  }

  // Allega da Drive
  const btnDrive = container.querySelector("#btn-allega-drive");
  if (btnDrive) {
    btnDrive.addEventListener("click", async () => {
      if (!window.DRIVE?.openPicker) {
        _flash("Autenticazione Google necessaria — vai in Analizza PDF per autorizzare", "warning");
        return;
      }
      window.DRIVE.openPicker(async (file) => {
        const tipo = await _scegliTipo(container);
        await window.SB.allegaDriveAllegato(
          movimentoId,
          file.id || null,
          file.url || file.webViewLink || "",
          file.name || "File Drive",
          tipo
        );
        await renderAllegatiSection(container, movimentoId);
        _flash("Allegato aggiunto");
      });
    });
  }

  // Unisci PDF
  const btnUnisci = container.querySelector("#btn-unisci-pdf");
  if (btnUnisci) {
    btnUnisci.addEventListener("click", () => _unisciPdf(container, movimentoId, allegati));
  }

  // Scarica PDF unito
  const btnScarica = container.querySelector("#btn-scarica-unito");
  if (btnScarica) {
    const unito = allegati.find(a => a.tipo === "pdf_unito");
    if (unito) {
      btnScarica.addEventListener("click", async () => {
        let url = unito.storage_url;
        if (unito.storage_path) {
          try { url = await window.SB.getSignedUrlAllegato(unito.storage_path); } catch {}
        }
        window.open(url, "_blank");
      });
    }
  }

  // Azioni su ogni riga allegato
  container.querySelectorAll("[data-all-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const act = btn.dataset.allAct;
      const id = btn.dataset.id;
      const path = btn.dataset.path;
      const url = btn.dataset.url || btn.dataset.link;

      if (act === "apri") {
        let finalUrl = url;
        if (path) {
          try { finalUrl = await window.SB.getSignedUrlAllegato(path); } catch {}
        }
        if (finalUrl) window.open(finalUrl, "_blank");
      } else if (act === "scarica") {
        let finalUrl = url;
        if (path) {
          try { finalUrl = await window.SB.getSignedUrlAllegato(path); } catch {}
        }
        if (finalUrl) {
          const a = document.createElement("a");
          a.href = finalUrl;
          a.download = btn.dataset.nome || "allegato.pdf";
          a.click();
        }
      } else if (act === "cambia-tipo") {
        const nuovoTipo = btn.value;
        await window.SB.aggiornaAllegato(id, { tipo: nuovoTipo });
      } else if (act === "elimina") {
        if (!confirm(`Eliminare "${btn.dataset.nome}"?`)) return;
        await window.SB.eliminaAllegato(id);
        await renderAllegatiSection(container, movimentoId);
        _flash("Allegato eliminato");
      }
    });
  });

  // Change su select tipo
  container.querySelectorAll("select[data-all-act='cambia-tipo']").forEach(sel => {
    sel.addEventListener("change", async () => {
      await window.SB.aggiornaAllegato(sel.dataset.id, { tipo: sel.value });
    });
  });
}

function _rigaAllegato(a, canEdit) {
  const { escapeHtml } = window.UI;
  const isPdf = (a.mime_type === "application/pdf" || (a.nome||"").toLowerCase().endsWith(".pdf"));
  const isUnito = a.tipo === "pdf_unito";
  const icona = isUnito ? "🔀" : isPdf ? "📄" : (a.nome||"").match(/\.(jpe?g|png|webp)$/i) ? "🖼️" : "📎";
  const dim = a.dimensione ? ` · ${(a.dimensione/1024).toFixed(0)} KB` : "";
  const hasUrl = a.storage_url || a.link;

  return `<div class="allegato-riga${isUnito ? " allegato-unito" : ""}" data-id="${a.id}">
    <span class="allegato-icona">${icona}</span>
    <div class="allegato-info">
      <span class="allegato-nome">${escapeHtml(a.nome||"—")}</span>
      <small class="text-muted">${dim}</small>
    </div>
    ${canEdit ? `
      <select data-all-act="cambia-tipo" data-id="${a.id}" title="Tipo allegato" style="font-size:11px;padding:2px 4px">
        ${Object.entries(TIPI_ALLEGATO).map(([v,l]) =>
          `<option value="${v}" ${a.tipo===v?"selected":""}>${l}</option>`
        ).join("")}
      </select>
    ` : `<span style="font-size:11px;color:#888">${TIPI_ALLEGATO[a.tipo]||a.tipo}</span>`}
    <div class="allegato-azioni">
      ${hasUrl ? `
        <button class="icon-btn" data-all-act="apri" data-id="${a.id}"
          data-path="${escapeHtml(a.storage_path||"")}" data-url="${escapeHtml(a.storage_url||a.link||"")}"
          title="Apri">👁️</button>
        <button class="icon-btn" data-all-act="scarica" data-id="${a.id}"
          data-path="${escapeHtml(a.storage_path||"")}" data-url="${escapeHtml(a.storage_url||a.link||"")}"
          data-nome="${escapeHtml(a.nome||"allegato")}"
          title="Scarica">⬇️</button>
      ` : ""}
      ${canEdit ? `
        <button class="icon-btn" data-all-act="elimina" data-id="${a.id}"
          data-nome="${escapeHtml(a.nome||"")}" title="Elimina">🗑</button>
      ` : ""}
    </div>
  </div>`;
}

// Dialogo selezione tipo (alert semplice, non blocca UX a lungo)
async function _scegliTipo(container) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center";
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:24px;min-width:260px;box-shadow:0 8px 32px rgba(0,0,0,.3)">
        <h4 style="margin:0 0 16px">Tipo allegato</h4>
        ${Object.entries(TIPI_ALLEGATO).filter(([v]) => v !== "pdf_unito").map(([v, l]) =>
          `<label style="display:block;padding:8px;cursor:pointer;border-radius:6px;margin:2px 0" class="tipo-opt">
            <input type="radio" name="tipo_all" value="${v}" style="margin-right:8px">${l}
          </label>`
        ).join("")}
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
          <button class="secondary" id="tipo-cancel">Annulla</button>
          <button id="tipo-ok">Conferma</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    // default
    overlay.querySelector("input[value='altro']").checked = true;
    overlay.querySelector("#tipo-ok").addEventListener("click", () => {
      const sel = overlay.querySelector("input[name='tipo_all']:checked");
      overlay.remove();
      resolve(sel ? sel.value : "altro");
    });
    overlay.querySelector("#tipo-cancel").addEventListener("click", () => {
      overlay.remove();
      resolve("altro");
    });
  });
}

async function _uploadMultipli(container, movimentoId, files, tipo) {
  const progress = container.querySelector("#allegati-progress");
  const bar = container.querySelector("#allegati-progress-bar");
  const msg = container.querySelector("#allegati-progress-msg");
  if (progress) progress.style.display = "block";

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (msg) msg.textContent = `Caricamento ${i+1}/${files.length}: ${f.name}`;
    if (bar) bar.style.width = `${Math.round(((i) / files.length) * 100)}%`;
    try {
      await window.SB.uploadAllegato(movimentoId, f, tipo);
    } catch (e) {
      _flash(`Errore caricamento ${f.name}: ${e.message}`, "error");
    }
  }
  if (bar) bar.style.width = "100%";
  if (msg) msg.textContent = `✅ ${files.length} file caricati`;
  setTimeout(() => { if (progress) progress.style.display = "none"; }, 2000);
}

async function _unisciPdf(container, movimentoId, allegati) {
  if (!window.PDFLib) {
    _flash("pdf-lib non caricato — ricarica la pagina", "error");
    return;
  }

  const pdfs = allegati.filter(a =>
    a.tipo !== "pdf_unito" &&
    (a.mime_type === "application/pdf" || (a.nome||"").toLowerCase().endsWith(".pdf"))
  ).sort((a, b) => (a.ordine||0) - (b.ordine||0));

  if (pdfs.length < 2) {
    _flash("Servono almeno 2 PDF per unirli", "warning");
    return;
  }

  const progress = container.querySelector("#allegati-progress");
  const bar = container.querySelector("#allegati-progress-bar");
  const msg = container.querySelector("#allegati-progress-msg");
  if (progress) progress.style.display = "block";
  if (msg) msg.textContent = "Avvio unione PDF…";

  try {
    const { PDFDocument } = window.PDFLib;
    const merged = await PDFDocument.create();

    for (let i = 0; i < pdfs.length; i++) {
      const a = pdfs[i];
      if (msg) msg.textContent = `Elaborazione ${i+1}/${pdfs.length}: ${a.nome}`;
      if (bar) bar.style.width = `${Math.round(((i) / pdfs.length) * 80)}%`;

      let url = a.storage_url || a.link;
      if (a.storage_path) {
        try { url = await window.SB.getSignedUrlAllegato(a.storage_path); } catch {}
      }
      if (!url) { console.warn("Allegato senza URL:", a); continue; }

      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const bytes = await resp.arrayBuffer();
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      } catch (e) {
        _flash(`⚠️ Impossibile includere "${a.nome}": ${e.message}. Continuo con gli altri.`, "warning");
      }
    }

    if (merged.getPageCount() === 0) {
      _flash("Nessuna pagina disponibile per l'unione", "error");
      return;
    }

    if (msg) msg.textContent = "Salvataggio PDF unito su Supabase…";
    if (bar) bar.style.width = "90%";

    const pdfBytes = await merged.save();

    // Nome file: data_progressivo_unito.pdf
    const mv = await window.SB.getMovimento(movimentoId);
    const nome = `${mv?.data||""}_${mv?.progressivo||movimentoId.slice(0,8)}_unito.pdf`;

    const allegato = await window.SB.salvaPdfUnito(movimentoId, pdfBytes, nome);

    if (bar) bar.style.width = "100%";
    if (msg) msg.textContent = "✅ PDF unito salvato!";

    // Download automatico
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dlUrl;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(dlUrl);

    setTimeout(async () => {
      if (progress) progress.style.display = "none";
      await renderAllegatiSection(container, movimentoId);
    }, 1500);

  } catch (e) {
    _flash("Errore unione PDF: " + e.message, "error");
    if (progress) progress.style.display = "none";
  }
}

function _flash(msg, type = "success") {
  if (window.flash) window.flash(msg, type, 4000);
  else console.log("[allegati]", type, msg);
}

// Espone la funzione principale
window.ALLEGATI = { render: renderAllegatiSection };
