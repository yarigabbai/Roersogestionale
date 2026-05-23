// =====================================================================
// ai.js — Anthropic Claude Haiku diretto da browser + schermata Analizza PDF
// ⚠️ La API key viaggia nel browser. Per uso interno con limiti di spesa.
// =====================================================================

const PROMPT_BASE = `Sei un assistente contabile italiano specializzato in ETS (Enti del Terzo Settore).
Analizza il documento e restituisci SOLO JSON valido senza markdown, struttura:
{
  "data_documento": "YYYY-MM-DD",
  "importo": 0.00,
  "tipo": "USCITA" | "ENTRATA",
  "fornitore_cliente": "nome",
  "numero_documento_originale": "riferimento",
  "descrizione_primanota": "max 60 caratteri",
  "categoria": "U1|U2|U3|U4|U5|U6|U7|U10|E1|E7|E8|E9|E10|E11",
  "metodo_pagamento": null | "BPE" | "NEXI" | "CASSA",
  "progetto": "SSF EDU|SSF Estivo|Silent Tales|Itinerari EDU VE|Generale",
  "tipo_documento": "fattura|nota_spese|parcella|nota_autore|f24|buono_carburante|altro",
  "confidenza": 0-100
}

IMPORTANTE per metodo_pagamento:
- Imposta a null se NON è esplicitamente indicato nel documento (es. fatture normali non specificano)
- Imposta "BPE" SOLO se il documento cita esplicitamente "Banca Popolare Etica" o "BPE" o un bonifico verso un IBAN BPE
- Imposta "NEXI" SOLO se è un estratto carta NEXI o cita "NEXI"
- Imposta "CASSA" SOLO se è uno scontrino, una nota spese contanti o cita "contanti/cassa"
- NON tirare a indovinare — null è meglio di un valore sbagliato

Riferimenti:
- Wind Tre=U2, Grimaldi/voli=U2, Enilive/SAP=U1, Edenred=U1
- Scarpis/locazioni=U3, Aruba=U3
- Michele Moi BP=U4 (busta paga)
- artisti, parcelle, NP collaboratori occasionali=U7
- F24, bolli, fidejussioni=U5
- Fatture FPR emesse a Comuni=E9
- Invitalia/FDS/anticipi=E10
- CUP E71D26000000002 = SSF Estivo 2026
- CUP E71D24000350002 = SSF EDU

Testo del documento:
`;

async function chiamaClaudePerTesto(testo) {
  const cfg = window.CONFIG;
  if (!cfg.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY mancante in config.js");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cfg.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: PROMPT_BASE + testo.substring(0, 8000) }],
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error("Claude API: " + r.status + " " + err.substring(0, 200));
  }
  const j = await r.json();
  const txt = j.content?.[0]?.text || "";
  const match = txt.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Risposta AI non parsabile");
  return JSON.parse(match[0]);
}

async function chiamaClaudePerPdf(pdfBase64) {
  const cfg = window.CONFIG;
  if (!cfg.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY mancante in config.js");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cfg.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: PROMPT_BASE.replace("Testo del documento:\n", "") },
        ],
      }],
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    if (r.status === 429) {
      const e = new Error("Rate limit Anthropic — attendi qualche secondo");
      e.rateLimited = true;
      throw e;
    }
    throw new Error("Claude API: " + r.status + " " + err.substring(0, 200));
  }
  const j = await r.json();
  const txt = j.content?.[0]?.text || "";
  const match = txt.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Risposta AI non parsabile");
  return JSON.parse(match[0]);
}

async function estraiTestoPDF(file) {
  if (!window.pdfjsLib) throw new Error("PDF.js non caricato");
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  let testo = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    testo += content.items.map(it => it.str).join(" ") + "\n";
  }
  return testo;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function analizzaFile(file) {
  // Strategia: prima estraiamo testo locale (gratis con PDF.js).
  // Se testo > 200 char, usiamo Claude text (più economico).
  // Altrimenti usiamo Claude PDF (più costoso ma legge scansioni).
  try {
    const testo = await estraiTestoPDF(file);
    if (testo.trim().length > 200) {
      return await chiamaClaudePerTesto(testo);
    }
  } catch {}
  // PDF scansione: passiamo i byte direttamente a Claude
  const b64 = await fileToBase64(file);
  return await chiamaClaudePerPdf(b64);
}

// =====================================================================
// SCHERMATA ANALIZZA PDF
// =====================================================================
const PDF_QUEUE = [];

function renderAnalizzaPDF() {
  const sec = document.getElementById("analizza-pdf-content");
  const lastFolder = localStorage.getItem("roerso_drive_last_folder") || "";
  sec.innerHTML = `
    <div class="tabs">
      <button class="tab active" data-tab="upload">📁 Carica PDF</button>
      <button class="tab" data-tab="drive">☁️ Da cartella Drive</button>
      <button class="tab" data-tab="xml">📑 Fatture XML (SDI)</button>
    </div>

    <div class="tab-pane" data-pane="upload">
      <div class="alert alert-info mb-2" style="font-size:13px">
        💡 Carica uno o più PDF dal tuo computer. L'AI legge ogni documento e propone una riga di prima nota.
        Per ogni PDF, l'app controlla se esiste già un movimento "Manca doc" che corrisponde — in tal caso suggerisce di allegare invece di creare un nuovo movimento.
      </div>
      <div class="dropzone" id="dz-pdf">
        <div class="dz-icon">📄</div>
        <strong>Trascina qui i PDF</strong>
        <p>oppure clicca per selezionare. L'AI estrae i dati e tu confermi.</p>
        <input type="file" id="dz-input" accept="application/pdf" multiple style="display:none" />
      </div>
      <div class="flex mb-2 mt-2">
        <button class="secondary" id="btn-analyze-all" disabled>▶ Analizza tutti</button>
        <button class="secondary" id="btn-save-all" disabled>💾 Salva tutti i confermati</button>
        <span class="text-muted" id="batch-status" style="font-size:12px"></span>
      </div>
      <div class="pdf-list" id="pdf-list"></div>
    </div>

    <div class="tab-pane" data-pane="xml" style="display:none">
      <div class="alert alert-info mb-2" style="font-size:13px">
        📑 Carica file <strong>XML</strong> di fatture elettroniche SDI (singoli) o <strong>ZIP</strong> scaricati dal cassetto fiscale Agenzia delle Entrate (Fatture e Corrispettivi).
        Il parser estrae i dati senza chiamare l'AI (più veloce e gratis). Le fatture vengono inserite in coda Documenti.
      </div>
      <div class="dropzone" id="dz-xml">
        <div class="dz-icon">📑</div>
        <strong>Trascina qui XML o ZIP</strong>
        <p>Singoli .xml, lotti con N body, o ZIP con N fatture.</p>
        <input type="file" id="dz-xml-input" accept=".xml,.zip" multiple style="display:none" />
      </div>
      <div id="xml-status" class="mt-2 text-muted" style="font-size:12px"></div>
      <div id="xml-list" class="mt-2"></div>
    </div>

    <div class="tab-pane" data-pane="drive" style="display:none">
      <div class="alert alert-info mb-2" style="font-size:13px">
        ☁️ Scansiona una cartella Drive. L'app lista tutti i PDF, esclude quelli già processati, e per ognuno propone allegamento (se trova match) o creazione movimento.
      </div>
      <div class="form-card mb-2">
        <div class="form-grid" style="grid-template-columns:2fr 1fr 1fr;align-items:end">
          <div><label>ID cartella Drive (o URL)</label>
            <input id="drive-folder" type="text" value="${escapeHtmlSimple(lastFolder)}" placeholder="incolla l'ID o l'URL completo della cartella" /></div>
          <div><button id="btn-drive-auth" class="secondary">🔑 Autorizza Google</button></div>
          <div><button id="btn-drive-scan">🔍 Scansiona</button></div>
        </div>
        <p class="text-muted" style="font-size:11px;margin-top:6px">
          La prima volta clicca "Autorizza Google" e accedi col tuo account. Lo script ha accesso in <strong>sola lettura</strong> al Drive.
        </p>
      </div>
      <div id="drive-list"></div>
    </div>
  `;

  // Tab switching
  sec.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    sec.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
    sec.querySelectorAll(".tab-pane").forEach(p => p.style.display = p.dataset.pane === t.dataset.tab ? "" : "none");
  }));

  // Tab Upload
  const dz = document.getElementById("dz-pdf");
  const inp = document.getElementById("dz-input");
  dz.addEventListener("click", () => inp.click());
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("over"); handlePdfFiles(e.dataTransfer.files); });
  inp.addEventListener("change", e => handlePdfFiles(e.target.files));

  // Tab XML
  const dzXml = document.getElementById("dz-xml");
  const dzXmlInput = document.getElementById("dz-xml-input");
  dzXml.addEventListener("click", () => dzXmlInput.click());
  dzXml.addEventListener("dragover", e => { e.preventDefault(); dzXml.classList.add("over"); });
  dzXml.addEventListener("dragleave", () => dzXml.classList.remove("over"));
  dzXml.addEventListener("drop", e => { e.preventDefault(); dzXml.classList.remove("over"); handleXmlFiles(e.dataTransfer.files); });
  dzXmlInput.addEventListener("change", e => handleXmlFiles(e.target.files));

  // Tab Drive
  document.getElementById("btn-drive-auth").addEventListener("click", async () => {
    try {
      await window.DRIVE.authDrive();
      window.flash("Google Drive autorizzato", "success");
    } catch (e) { window.flash("Errore: " + e.message, "error", 6000); }
  });
  document.getElementById("btn-drive-scan").addEventListener("click", driveScan);
}

// =====================================================================
// IMPORT FATTURE XML SDI — parser + matching auto
// =====================================================================
async function handleXmlFiles(files) {
  const status = document.getElementById("xml-status");
  const list = document.getElementById("xml-list");
  list.innerHTML = "";
  status.textContent = "⏳ Analisi file XML/ZIP...";

  let fatture = [];
  for (const f of files) {
    try {
      const parsed = await window.XML_PARSER.parseFileFatturaXML(f);
      fatture.push(...parsed);
    } catch (e) {
      list.innerHTML += `<div class="alert alert-error" style="font-size:12px">${escapeHtmlSimple(f.name)}: ${escapeHtmlSimple(e.message)}</div>`;
    }
  }

  if (!fatture.length) {
    status.textContent = "Nessuna fattura estratta dai file.";
    return;
  }

  status.innerHTML = `<strong>${fatture.length}</strong> fatture estratte. Click "Importa tutte" per processarle (match auto + coda).`;
  list.innerHTML += `
    <div class="flex mb-1">
      <button id="btn-xml-import-all">🚀 Importa tutte le ${fatture.length} fatture</button>
      <span class="text-muted" style="font-size:12px">Per ogni fattura: match ≥95% → allega auto, &lt;95% → coda Documenti</span>
    </div>
    <div class="table-wrap" style="max-height:400px;overflow:auto"><table style="font-size:12px">
      <thead><tr><th>File</th><th>N. doc</th><th>Data</th><th>Fornitore</th><th>Tipo</th><th class="num">Imp.bile</th><th class="num">IVA</th><th class="num">Totale</th></tr></thead>
      <tbody>${fatture.map(f => `<tr>
        <td>${escapeHtmlSimple((f.nome_file_origine||'').substring(0,40))}</td>
        <td>${escapeHtmlSimple(f.numero_documento||'')}</td>
        <td>${f.data_documento ? window.UI.fmtData(f.data_documento) : ''}</td>
        <td>${escapeHtmlSimple((f.fornitore_cliente||'').substring(0,30))}</td>
        <td>${f.tipo}</td>
        <td class="num">${window.UI.fmtImporto(f.imponibile)}</td>
        <td class="num">${window.UI.fmtImporto(f.iva)}</td>
        <td class="num"><strong>${window.UI.fmtImporto(f.importo)}</strong></td>
      </tr>`).join("")}</tbody>
    </table></div>
  `;

  document.getElementById("btn-xml-import-all").onclick = async () => {
    const btn = document.getElementById("btn-xml-import-all");
    btn.disabled = true;
    let ok = 0, allegate = 0, errori = 0;
    for (let i = 0; i < fatture.length; i++) {
      const f = fatture[i];
      btn.textContent = `⏳ ${i+1}/${fatture.length}: ${f.numero_documento||''}`;
      try {
        // Genera un drive_file_id sintetico per tracking
        const fakeFileId = `xml_${f.tipo_documento || 'TD'}_${(f.numero_documento||'no').replace(/[^\w]/g,'_')}_${f.data_documento||'nodate'}_${Math.random().toString(36).substring(2,8)}`;

        // Match check
        const matches = await window.SB.cercaMatchPerDocumento({
          data: f.data_documento,
          data_documento: f.data_documento,
          importo: f.importo,
          fornitore_cliente: f.fornitore_cliente,
        });
        const best = matches[0];
        const score = best?.score || 0;

        const ai = {
          data_documento: f.data_documento,
          tipo: f.tipo,
          importo: f.importo,
          fornitore_cliente: f.fornitore_cliente,
          numero_documento: f.numero_documento,
          descrizione: f.descrizione,
          metodo: null,
          confidenza: 100, // XML è dato strutturato, non interpretato
        };

        if (score >= 95) {
          await window.SB.allegaDocumentoAMovimento(best.id, {
            link_documento: null, // XML non ha web_view_link
            data_documento: f.data_documento,
            numero_documento: f.numero_documento,
            drive_file_id: fakeFileId,
          });
          await window.SB.salvaDocumentoDaTriagre({
            drive_file_id: fakeFileId,
            nome_file: f.nome_file_origine || (f.numero_documento + '.xml'),
            ai, match_score: score,
            stato: 'abbinato', movimento_id: best.id,
            note_match: `XML allegato auto, score ${score}% a ${best.progressivo}`,
          });
          allegate++;
        } else {
          await window.SB.salvaDocumentoDaTriagre({
            drive_file_id: fakeFileId,
            nome_file: f.nome_file_origine || (f.numero_documento + '.xml'),
            ai, match_score: score,
            stato: 'da_abbinare',
            note_match: best ? `Miglior match ${score}% sotto soglia` : 'Nessun match',
          });
          ok++;
        }
      } catch (e) {
        console.error("XML import errore:", e);
        errori++;
      }
    }
    btn.textContent = `✓ Fatto`;
    btn.disabled = false;
    window.flash(`XML import: ${allegate} allegate, ${ok} in coda, ${errori} errori`, "success", 8000);
  };
}

function escapeHtmlSimple(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

async function driveScan() {
  const folderInput = document.getElementById("drive-folder").value.trim();
  const list = document.getElementById("drive-list");
  if (!folderInput) { window.flash("Inserisci ID o URL cartella", "warning"); return; }

  const folderId = window.DRIVE.estraiDriveId(folderInput);
  localStorage.setItem("roerso_drive_last_folder", folderInput);
  list.innerHTML = `<div class="empty"><span class="spinner"></span> Scansione cartella Drive...</div>`;

  let files;
  try {
    files = await window.DRIVE.listaPdfCartella(folderId, { maxDepth: 8 });
  } catch (e) {
    list.innerHTML = `<div class="alert alert-error">Errore: ${escapeHtmlSimple(e.message)}<br>
      <small>Hai cliccato "Autorizza Google" prima? La cartella è condivisa con il tuo account?</small></div>`;
    return;
  }
  if (!files.length) { list.innerHTML = `<div class="empty">Nessun PDF nella cartella.</div>`; return; }

  // Carica file già tracciati per evitare ri-processamento
  const tracciati = await window.SB.getDocumentiDrive();
  const tracciatiSet = new Set(tracciati.map(d => d.drive_file_id));

  const nuovi = files.filter(f => !tracciatiSet.has(f.id));
  list.innerHTML = `
    <div class="flex-between mb-2">
      <div class="text-muted" style="font-size:13px">
        ${files.length} PDF trovati · ${nuovi.length} nuovi · ${files.length - nuovi.length} già processati
        · <span id="drive-batch-status"></span>
      </div>
      ${nuovi.length ? `<button id="btn-analizza-drive-batch">▶ Analizza tutti i nuovi (${nuovi.length})</button>` : ''}
    </div>
    <div class="alert alert-info" style="font-size:12px;margin-bottom:8px">
      💡 Il flusso AI: se trova un movimento esistente con match ≥ <strong>95%</strong> (importo±2 EUR, fornitore simile, data ±15gg) → allega automaticamente.
      Sotto soglia → finisce nella sezione <a href="#documenti">Documenti</a> per il triage manuale.
    </div>
    <div class="drive-list">
      ${nuovi.map(f => `
        <div class="drive-row new" data-id="${escapeHtmlSimple(f.id)}" data-name="${escapeHtmlSimple(f.name)}" data-link="${escapeHtmlSimple(f.webViewLink||'')}">
          <div class="info">
            <div class="name">${escapeHtmlSimple(f.name)}</div>
            <div class="meta">
              <span class="badge-stato vuoto">Nuovo</span>
              · ${f.folder_path || ''}
              · <a href="${escapeHtmlSimple(f.webViewLink||'#')}" target="_blank">apri Drive</a>
            </div>
          </div>
          <div class="actions">
            <button class="small" data-act="analyze">🤖 Analizza</button>
          </div>
        </div>
      `).join("")}
      ${tracciati.length ? `
      <details style="margin-top:14px">
        <summary class="text-muted" style="cursor:pointer;font-size:13px">Mostra ${files.length - nuovi.length} già processati</summary>
        ${files.filter(f => tracciatiSet.has(f.id)).map(f => `
          <div class="drive-row imported">
            <div class="info">
              <div class="name">${escapeHtmlSimple(f.name)}</div>
              <div class="meta"><span class="badge-stato accoppiato">✓ già importato</span> · ${f.folder_path || ''}</div>
            </div>
            <div><a href="${escapeHtmlSimple(f.webViewLink||'#')}" target="_blank">↗</a></div>
          </div>
        `).join("")}
      </details>
      ` : ''}
    </div>
  `;

  list.querySelectorAll("[data-act=analyze]").forEach(b => b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "⏳";
    await processaFileDriveAuto(b.closest(".drive-row"));
  }));
  const btnBatch = document.getElementById("btn-analizza-drive-batch");
  if (btnBatch) btnBatch.addEventListener("click", () => analizzaTuttiNuoviDrive(list));
}

// Soglia minima di match score per allegare automaticamente senza chiedere
const SOGLIA_AUTO_MATCH = 95;

// Processa un singolo file Drive: scarica, analizza, decide auto se allegare o mettere in coda
async function processaFileDriveAuto(row) {
  const fileId = row.dataset.id;
  const nome = row.dataset.name;
  const link = row.dataset.link;
  const meta = row.querySelector(".meta");
  meta.innerHTML = `<span class="spinner"></span> Scaricamento + analisi AI...`;

  try {
    const file = await window.DRIVE.scaricaFile(fileId, nome);
    const dati = await analizzaFile(file);
    // Normalizza i campi estratti dall'AI
    const ai = {
      data_documento: dati.data_documento || null,
      tipo: dati.tipo === "ENTRATA" ? "ENTRATA" : "USCITA",
      importo: parseFloat(dati.importo) || 0,
      descrizione: (dati.descrizione_primanota || dati.descrizione || "").substring(0, 200),
      fornitore_cliente: dati.fornitore_cliente || "",
      numero_documento: dati.numero_documento_originale || "",
      categoria: dati.categoria || "U2",
      metodo: dati.metodo_pagamento || "BPE",
      progetto: dati.progetto || "Generale",
      confidenza: dati.confidenza || null,
    };

    // Cerca match con movimenti esistenti "Manca doc" o "Vuoto"
    const matches = await window.SB.cercaMatchPerDocumento({
      data: ai.data_documento,
      data_documento: ai.data_documento,
      importo: ai.importo,
      fornitore_cliente: ai.fornitore_cliente,
    });
    const best = matches[0];
    const bestScore = best?.score || 0;

    // Decisione automatica
    if (bestScore >= SOGLIA_AUTO_MATCH) {
      // ALLEGA al movimento esistente
      await window.SB.allegaDocumentoAMovimento(best.id, {
        link_documento: link,
        data_documento: ai.data_documento,
        numero_documento: ai.numero_documento,
        drive_file_id: fileId,
      });
      await window.SB.salvaDocumentoDaTriagre({
        drive_file_id: fileId, nome_file: nome, web_view_link: link,
        ai, match_score: bestScore,
        stato: 'abbinato', movimento_id: best.id,
        note_match: `Allegato auto, score ${bestScore}% a ${best.progressivo}`,
      });
      meta.innerHTML = `<span class="badge-stato accoppiato">✓ Allegato auto</span> · score ${bestScore}% → <strong>${best.progressivo}</strong>`;
    } else {
      // Va in CODA — score insufficiente per auto-allega
      await window.SB.salvaDocumentoDaTriagre({
        drive_file_id: fileId, nome_file: nome, web_view_link: link,
        ai, match_score: bestScore,
        stato: 'da_abbinare',
        note_match: best ? `Miglior match ${bestScore}% (${best.progressivo}) sotto soglia` : 'Nessun match trovato',
      });
      meta.innerHTML = `<span class="badge-stato attesa-ec">📋 In coda</span> · ` +
        (best ? `miglior match ${bestScore}% (sotto 95%)` : 'nessun match');
    }
  } catch (e) {
    meta.innerHTML = `<span class="badge-stato vuoto">Errore: ${escapeHtmlSimple(e.message)}</span>`;
  }
}

async function analizzaTuttiNuoviDrive(listEl) {
  const rows = [...listEl.querySelectorAll(".drive-row.new")];
  const btn = document.getElementById("btn-analizza-drive-batch");
  let pause = false;
  btn.textContent = "⏸ Pausa";
  btn.onclick = () => { pause = true; btn.textContent = "⏸ Pausa richiesta..."; };

  let i = 0, ok = 0, ko = 0;
  for (const row of rows) {
    if (pause) {
      btn.textContent = `⏸ Pausa (${i}/${rows.length} completati)`;
      break;
    }
    i++;
    try {
      await processaFileDriveAuto(row);
      ok++;
    } catch { ko++; }
    // Aggiorna contatore live
    const status = document.getElementById("drive-batch-status");
    if (status) status.textContent = `${i}/${rows.length} processati · ${ok} OK · ${ko} errori`;
    // Sleep tra chiamate per rate limit Anthropic
    if (i < rows.length) await new Promise(r => setTimeout(r, 2500));
  }
  btn.textContent = "▶ Analizza tutti i nuovi";
  btn.onclick = () => analizzaTuttiNuoviDrive(listEl);
  window.flash(`Batch Drive: ${ok} OK${ko ? ', '+ko+' errori' : ''}${pause ? ' (interrotto)' : ''}`, "success", 6000);
  // Aggiorna lista per nascondere quelli appena processati
  setTimeout(() => document.getElementById("btn-drive-scan")?.click(), 1500);
}

function handlePdfFiles(files) {
  const list = document.getElementById("pdf-list");
  const { escapeHtml } = window.UI;
  for (const f of files) {
    if (!/pdf$/i.test(f.name)) continue;
    const item = { file: f, analyzed: false, confirmed: false, saved: false, error: null, dati: null };
    const div = document.createElement("div");
    div.className = "pdf-item";
    div.innerHTML = `
      <div class="name">${escapeHtml(f.name)}</div>
      <div class="status">In coda</div>
      <button class="small" data-act="analyze">Analizza</button>
      <button class="small secondary" data-act="edit" disabled>Conferma</button>
    `;
    list.appendChild(div);
    item.row = div;
    PDF_QUEUE.push(item);
    div.querySelector("[data-act=analyze]").addEventListener("click", () => analyzePdfItem(item));
    div.querySelector("[data-act=edit]").addEventListener("click", () => editPdfItem(item));
  }
  updateBatchControls();
}

function updateBatchControls() {
  const btnA = document.getElementById("btn-analyze-all");
  const btnS = document.getElementById("btn-save-all");
  const status = document.getElementById("batch-status");
  if (!btnA) return;
  const pending = PDF_QUEUE.filter(p => !p.analyzed && !p.error).length;
  const ready = PDF_QUEUE.filter(p => p.analyzed && p.confirmed && !p.saved).length;
  btnA.disabled = pending === 0;
  btnS.disabled = ready === 0;
  status.textContent = `${PDF_QUEUE.length} file · ${PDF_QUEUE.filter(p=>p.saved).length} salvati`;
  btnA.onclick = async () => {
    btnA.disabled = true;
    for (const p of PDF_QUEUE) {
      if (p.analyzed || p.error) continue;
      await analyzePdfItem(p);
      // sleep tra una chiamata e l'altra per evitare 429
      await new Promise(r => setTimeout(r, 1500));
    }
    updateBatchControls();
  };
  btnS.onclick = async () => {
    for (const p of PDF_QUEUE) {
      if (!p.analyzed || !p.confirmed || p.saved) continue;
      try {
        const ok = await window.checkDoppioniPrimaSalvataggio(p.dati);
        if (!ok) {
          p.row.querySelector(".status").textContent = "Saltato (doppione)";
          continue;
        }
        await window.SB.salvaMovimento(p.dati);
        p.saved = true;
        p.row.querySelector(".status").textContent = "Salvato ✓";
        p.row.querySelector(".status").classList.add("ok");
      } catch (e) {
        p.row.querySelector(".status").textContent = "Err: " + e.message;
        p.row.querySelector(".status").classList.add("err");
      }
    }
    updateBatchControls();
    window.flash("Salvataggio batch completato");
  };
}

async function analyzePdfItem(item) {
  const status = item.row.querySelector(".status");
  status.innerHTML = `<span class="spinner"></span> Analisi AI...`;
  try {
    const dati = await analizzaFile(item.file);
    const { todayISO, fmtImporto } = window.UI;
    item.dati = {
      data: dati.data_documento || todayISO(),
      tipo: dati.tipo === "ENTRATA" ? "ENTRATA" : "USCITA",
      importo: parseFloat(dati.importo) || 0,
      descrizione: (dati.descrizione_primanota || dati.descrizione || "").substring(0, 200),
      fornitore_cliente: dati.fornitore_cliente || "",
      numero_documento: dati.numero_documento_originale || "",
      categoria: dati.categoria || "U2",
      metodo: dati.metodo_pagamento || "BPE",
      progetto: dati.progetto || "Generale",
      anno: parseInt((dati.data_documento || todayISO()).slice(0,4), 10),
      nome_file_grezzo: item.file.name,
    };
    item.analyzed = true;
    item.confirmed = true;
    status.textContent = "Pronto: " + fmtImporto(item.dati.importo) + " · " + item.dati.fornitore_cliente.substring(0, 30);
    status.classList.add("ok");
    item.row.querySelector("[data-act=edit]").disabled = false;
    item.row.querySelector("[data-act=edit]").textContent = "Modifica";
  } catch (e) {
    item.error = e.message;
    status.textContent = "Errore: " + e.message;
    status.classList.add("err");
  }
  updateBatchControls();
}

function editPdfItem(item) {
  if (!item.dati) return;
  const d = item.dati;
  const { CATEGORIE, CATEGORIE_ENTRATA, CATEGORIE_USCITA, METODI, PROGETTI, escapeHtml } = window.UI;
  const body = document.createElement("div");
  body.innerHTML = `
    <p class="text-muted" style="font-size:12px;margin-bottom:14px">File: <strong>${escapeHtml(item.file.name)}</strong></p>
    <div class="form-grid">
      <div><label>Data</label><input id="cp-data" type="date" value="${d.data}" /></div>
      <div><label>Importo</label><input id="cp-importo" type="number" step="0.01" value="${d.importo}" /></div>
      <div><label>Tipo</label><select id="cp-tipo">
        <option value="ENTRATA" ${d.tipo==="ENTRATA"?"selected":""}>ENTRATA</option>
        <option value="USCITA" ${d.tipo==="USCITA"?"selected":""}>USCITA</option></select></div>
      <div><label>Metodo</label><select id="cp-met">${METODI.map(p=>`<option ${d.metodo===p?"selected":""}>${p}</option>`).join("")}</select></div>
      <div><label>Progetto</label><select id="cp-prog">${PROGETTI.map(p=>`<option ${d.progetto===p?"selected":""}>${p}</option>`).join("")}</select></div>
      <div><label>Categoria</label><select id="cp-cat"></select></div>
      <div class="full"><label>Fornitore/Cliente</label><input id="cp-forn" value="${escapeHtml(d.fornitore_cliente)}" /></div>
      <div><label>N. doc.</label><input id="cp-numdoc" value="${escapeHtml(d.numero_documento)}" /></div>
      <div class="full"><label>Descrizione</label><input id="cp-desc" value="${escapeHtml(d.descrizione)}" /></div>
    </div>`;
  const fillCat = t => {
    const sel = body.querySelector("#cp-cat");
    const lista = t === "ENTRATA" ? CATEGORIE_ENTRATA : CATEGORIE_USCITA;
    sel.innerHTML = lista.map(c => `<option value="${c}" ${c===d.categoria?"selected":""}>${c} — ${CATEGORIE[c].substring(0,40)}</option>`).join("");
  };
  setTimeout(() => fillCat(d.tipo), 0);
  body.querySelector("#cp-tipo").addEventListener("change", e => fillCat(e.target.value));

  window.openModal({
    title: "Conferma dati estratti", body, saveLabel: "Conferma e salva",
    onSave: async el => {
      item.dati = {
        ...d,
        data: el.querySelector("#cp-data").value,
        data_documento: el.querySelector("#cp-data").value, // di default = data; potrebbe essere editato
        importo: parseFloat(el.querySelector("#cp-importo").value) || 0,
        tipo: el.querySelector("#cp-tipo").value,
        metodo: el.querySelector("#cp-met").value,
        progetto: el.querySelector("#cp-prog").value,
        fornitore_cliente: el.querySelector("#cp-forn").value.trim(),
        numero_documento: el.querySelector("#cp-numdoc").value.trim(),
        categoria: el.querySelector("#cp-cat").value,
        descrizione: el.querySelector("#cp-desc").value.trim(),
        anno: parseInt(el.querySelector("#cp-data").value.slice(0,4), 10),
      };
      // Step 1: CHECK MATCH — esiste già un movimento "Manca doc" simile?
      const matches = await window.SB.cercaMatchPerDocumento({
        data: item.dati.data,
        data_documento: item.dati.data_documento,
        importo: item.dati.importo,
        fornitore_cliente: item.dati.fornitore_cliente,
      });
      if (matches.length > 0) {
        // Mostra modale di scelta: allega a esistente o crea nuovo
        const scelta = await chiediAllegaOCreaNuovo(matches, item.dati, item.file?.name);
        if (scelta === "annulla") return false;
        if (scelta.startsWith("allega:")) {
          const movId = scelta.split(":")[1];
          await window.SB.allegaDocumentoAMovimento(movId, {
            link_documento: item.dati.link_documento || `local:${item.file?.name || 'pdf'}`,
            data_documento: item.dati.data_documento,
            numero_documento: item.dati.numero_documento,
            drive_file_id: item.driveFileId,
          });
          // Traccia il file Drive se è stato origine
          if (item.driveFileId) {
            try {
              await window.SB.tracciaDocumentoDrive({
                drive_file_id: item.driveFileId,
                nome_file: item.driveName,
                web_view_link: item.driveLink,
                movimento_id: movId,
              });
            } catch {}
          }
          item.saved = true;
          if (item.row?.querySelector) {
            const st = item.row.querySelector(".status");
            if (st) { st.textContent = "Allegato a movimento esistente ✓"; st.classList.add("ok"); }
          }
          window.flash("Documento allegato al movimento esistente", "success");
          updateBatchControls();
          return;
        }
        // scelta === "nuovo" → continua sotto
      }
      // Step 2: nessun match (o l'utente ha scelto "crea nuovo") → check doppioni standard e salva
      const ok = await window.checkDoppioniPrimaSalvataggio(item.dati);
      if (!ok) return false;
      const nuovo = await window.SB.salvaMovimento(item.dati);
      // Traccia file Drive se origine
      if (item.driveFileId) {
        try {
          await window.SB.tracciaDocumentoDrive({
            drive_file_id: item.driveFileId,
            nome_file: item.driveName,
            web_view_link: item.driveLink,
            movimento_id: nuovo.id,
          });
        } catch {}
      }
      item.saved = true; item.confirmed = true;
      if (item.row?.querySelector) {
        const st = item.row.querySelector(".status");
        if (st) { st.textContent = "Salvato ✓"; st.classList.add("ok"); }
      }
      window.flash("Movimento salvato");
      updateBatchControls();
    }
  });
}

// Modale: l'AI ha trovato uno o più movimenti già esistenti che matchano.
// Chiede all'utente: allegare a uno di quelli? oppure creare nuovo movimento?
async function chiediAllegaOCreaNuovo(matches, dati, nomeFile) {
  const { fmtImporto, fmtData, escapeHtml } = window.UI;
  return new Promise(resolve => {
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="alert alert-info">
        <strong>🔍 Trovati ${matches.length} movimenti già in primanota che corrispondono.</strong>
        <p style="font-size:12px;margin-top:6px">Documento <strong>${escapeHtml(nomeFile || '')}</strong> · ${fmtImporto(dati.importo)} · ${escapeHtml(dati.fornitore_cliente)} · ${fmtData(dati.data_documento || dati.data)}</p>
      </div>
      <p style="font-size:13px;margin-bottom:8px">Vuoi <strong>allegare</strong> il documento a uno di questi movimenti esistenti, oppure creare un <strong>nuovo movimento</strong>?</p>
      <div style="display:flex;flex-direction:column;gap:6px;margin:12px 0">
        ${matches.map(m => `
          <label style="display:flex;gap:10px;align-items:center;padding:8px;border:1px solid var(--grigio-bordo);border-radius:4px;cursor:pointer">
            <input type="radio" name="match" value="${m.id}" />
            <div style="flex:1">
              <strong>${escapeHtml(m.progressivo || '—')}</strong> · ${fmtData(m.data)} · <em>${escapeHtml(m.descrizione||'').substring(0,60)}</em>
              <div class="text-muted" style="font-size:11px">${escapeHtml(m.fornitore_cliente||'')} · ${m.metodo} · stato: ${m.stato}</div>
            </div>
            <span class="${m.tipo==='ENTRATA'?'importo-entrata':'importo-uscita'}" style="font-weight:600">${fmtImporto(m.importo)}</span>
          </label>
        `).join("")}
      </div>
    `;
    const host = document.getElementById("modal-host");
    host.innerHTML = "";
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" style="max-width:700px">
        <div class="modal-header"><h2>Match trovato</h2><button class="close-btn" type="button">×</button></div>
        <div class="modal-body"></div>
        <div class="modal-footer">
          <button class="secondary" data-act="cancel">Annulla</button>
          <button data-act="nuovo">Crea nuovo movimento</button>
          <button data-act="allega" style="background:var(--verde);color:white">📎 Allega al selezionato</button>
        </div>
      </div>`;
    overlay.querySelector(".modal-body").appendChild(body);
    const close = v => { host.innerHTML = ""; resolve(v); };
    overlay.querySelector(".close-btn").onclick = () => close("annulla");
    overlay.querySelector('[data-act="cancel"]').onclick = () => close("annulla");
    overlay.querySelector('[data-act="nuovo"]').onclick = () => close("nuovo");
    overlay.querySelector('[data-act="allega"]').onclick = () => {
      const sel = body.querySelector('input[name="match"]:checked');
      if (!sel) {
        window.flash("Seleziona un movimento o scegli 'Crea nuovo'", "warning");
        return;
      }
      close("allega:" + sel.value);
    };
    host.appendChild(overlay);
    // Auto-select primo radio per UX
    setTimeout(() => { const r = body.querySelector('input[name="match"]'); if (r) r.checked = true; }, 100);
  });
}

window.AI_SCREEN = { render: renderAnalizzaPDF };
window.AI = { analizzaFile, estraiTestoPDF, chiamaClaudePerTesto, chiamaClaudePerPdf };
