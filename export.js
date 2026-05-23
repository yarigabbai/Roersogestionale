// =====================================================================
// export.js — Export Excel/CSV + parser CSV/XLS estratto conto + schermata Export
// =====================================================================

// =====================================================================
// PARSER EC (CSV/XLS BPE/NEXI)
// =====================================================================
async function parseECFile(file, conto = "BPE") {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "txt") return parseECCsv(file, conto);

  // Per .xls/.xlsx: prima sniffa il contenuto. BPE spesso esporta HTML rinominato .xls.
  if (ext === "xlsx" || ext === "xls" || ext === "html" || ext === "htm") {
    const firstBytes = await file.slice(0, 512).text();
    if (/<\s*(html|table|!doctype)/i.test(firstBytes)) {
      console.log("[parseEC] rilevato HTML disguised in .xls — uso parser HTML");
      return parseECHtml(file, conto);
    }
    return parseECXlsx(file, conto);
  }
  throw new Error("Formato non supportato (usa CSV, XLS, XLSX o HTML)");
}

// =====================================================================
// PARSER HTML — BPE Banca Etica spesso esporta HTML con estensione .xls
// =====================================================================
async function parseECHtml(file, conto) {
  const text = await file.text();
  // Sostituisci entità HTML comuni
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");
  const tables = doc.querySelectorAll("table");
  console.log(`[parseEC HTML] trovate ${tables.length} tabelle`);

  for (let t = 0; t < tables.length; t++) {
    const rows = [...tables[t].querySelectorAll("tr")].map(tr =>
      [...tr.querySelectorAll("td,th")].map(c => c.textContent.trim())
    );
    console.log(`[parseEC HTML] tabella ${t}: ${rows.length} righe`);
    if (rows.length < 2) continue;

    // Trova header
    let hdrIdx = -1;
    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const r = rows[i].map(c => c.toLowerCase());
      const hasData    = r.some(c => /\b(data|valuta)\b/.test(c));
      const hasImporto = r.some(c => /\b(importo|dare|avere)\b/.test(c));
      if (hasData && hasImporto) { hdrIdx = i; break; }
    }
    if (hdrIdx < 0) continue;
    console.log(`[parseEC HTML] header tab ${t} riga ${hdrIdx}:`, rows[hdrIdx]);

    const header = rows[hdrIdx];
    const idx = {
      data:     header.findIndex(h => /data\s*valuta/i.test(h)),
      dataEsec: header.findIndex(h => /esecuzione|scadenza/i.test(h)),
      dataOp:   header.findIndex(h => /data\s*operazione|data\s*creazione|data\s*contabile/i.test(h)),
      dataGen:  header.findIndex(h => /^data$/i.test(h)),
      desc:     header.findIndex(h => /descrizione|causale/i.test(h)),
      importo:  header.findIndex(h => /^importo$/i.test(h)),
      dare:     header.findIndex(h => /^dare$|^uscita$|addebito/i.test(h)),
      avere:    header.findIndex(h => /^avere$|^entrata$|accredito/i.test(h)),
      benef:    header.findIndex(h => /benefic|ordinante|controparte|deb\.\/contr/i.test(h)),
      stato:    header.findIndex(h => /stato/i.test(h)),
      tipo:     header.findIndex(h => /^servizio$|tipo\s*operazione/i.test(h)),
    };

    const dataCol = idx.data >= 0 ? idx.data
                  : idx.dataEsec >= 0 ? idx.dataEsec
                  : idx.dataOp >= 0 ? idx.dataOp
                  : idx.dataGen;
    if (dataCol < 0) continue;

    const out = [];
    for (let i = hdrIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const data = normalizzaData(r[dataCol]);
      if (!data) continue;
      let importo = 0;
      if (idx.importo >= 0) importo = parseImporto(r[idx.importo]);
      if (!importo && idx.dare >= 0) {
        const d = parseImporto(r[idx.dare]); if (d) importo = -Math.abs(d);
      }
      if (!importo && idx.avere >= 0) {
        const a = parseImporto(r[idx.avere]); if (a) importo = Math.abs(a);
      }
      if (!importo) continue;
      const stato = idx.stato >= 0 ? (r[idx.stato] || "").toUpperCase() : "ESEGUITO";
      if (stato && stato !== "ESEGUITO" && stato !== "") continue;
      const servizio = idx.tipo >= 0 ? String(r[idx.tipo] || "").toLowerCase() : "";
      let isUscita = importo < 0;
      if (importo > 0 && servizio) {
        if (/bonifico|pagamento|addebito|distinta|f24|prelievo/.test(servizio)) isUscita = true;
        else if (/accredito|stipendio|incasso|versamento/.test(servizio)) isUscita = false;
      }
      out.push({
        data_valuta: data,
        data_esecuzione: normalizzaData(idx.dataOp >= 0 ? r[idx.dataOp] : r[dataCol]) || data,
        descrizione_banca: r[idx.desc] || "",
        beneficiario: idx.benef >= 0 ? r[idx.benef] || "" : "",
        importo: Math.abs(importo),
        tipo_operazione: isUscita ? "USCITA" : "ENTRATA",
        anno: parseInt(data.slice(0,4), 10),
        mese: parseInt(data.slice(5,7), 10),
        stato_bpe: "ESEGUITO",
      });
    }
    console.log(`[parseEC HTML] estratte ${out.length} righe da tabella ${t}`);
    if (out.length > 0) return out;
  }
  throw new Error("Nessuna tabella valida nell'HTML. Apri F12 → Console per dettagli.");
}

async function parseECCsv(file, conto) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const sep = lines[0].includes(";") ? ";" : ",";
  const header = lines[0].split(sep).map(h => h.replace(/^"|"$/g, "").trim());
  const idx = {
    data:    header.findIndex(h => /data\s*valuta|data\s*contabile|valuta/i.test(h)),
    desc:    header.findIndex(h => /descrizione|causale/i.test(h)),
    importo: header.findIndex(h => /importo/i.test(h)),
    benef:   header.findIndex(h => /benefic/i.test(h)),
  };
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], sep);
    const dataRaw = cols[idx.data] || cols[0];
    const data = normalizzaData(dataRaw);
    if (!data) continue;
    const importo = parseImporto(cols[idx.importo] || "0");
    if (!importo) continue;
    out.push({
      data_valuta: data,
      data_esecuzione: data,
      descrizione_banca: (cols[idx.desc] || "").replace(/^"|"$/g, ""),
      beneficiario: idx.benef >= 0 ? (cols[idx.benef] || "").replace(/^"|"$/g, "") : "",
      importo: Math.abs(importo),
      tipo_operazione: importo < 0 ? "USCITA" : "ENTRATA",
      anno: parseInt(data.slice(0,4), 10),
      mese: parseInt(data.slice(5,7), 10),
      stato_bpe: "ESEGUITO",
    });
  }
  return out;
}

async function parseECXlsx(file, conto) {
  const buf = await file.arrayBuffer();
  let wb;
  try {
    wb = XLSX.read(buf, { type: "array", cellDates: true, raw: false });
  } catch (e) {
    throw new Error("Impossibile aprire il file: " + e.message);
  }
  if (!wb.SheetNames.length) throw new Error("Il file non contiene fogli");

  // Cerca su tutti i fogli, non solo il primo (BPE a volte mette header in fogli secondari)
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    console.log(`[parseEC] foglio "${sheetName}" — ${rows.length} righe`);
    if (!rows.length) continue;

    // DEBUG: stampa prime righe per capire la struttura
    console.log("[parseEC] prime 5 righe del foglio:");
    rows.slice(0, 5).forEach((r, i) => console.log(`  riga ${i}:`, r));

    // Trova riga header — cerca su prime 30 righe (BPE Banca Etica a volte ha intestazione lunga)
    let hdrIdx = -1;
    for (let i = 0; i < Math.min(30, rows.length); i++) {
      const r = (rows[i] || []).map(c => String(c || "").toLowerCase().trim());
      const hasData    = r.some(c => /\b(data|valuta)\b/.test(c));
      const hasImporto = r.some(c => /\b(importo|dare|avere|entrata|uscita)\b/.test(c));
      if (hasData && hasImporto) { hdrIdx = i; break; }
    }
    if (hdrIdx < 0) {
      console.warn(`[parseEC] header non trovato in foglio "${sheetName}"`);
      continue;
    }
    console.log(`[parseEC] header trovato alla riga ${hdrIdx}:`, rows[hdrIdx]);

    const header = (rows[hdrIdx] || []).map(c => String(c || "").trim());
    // NOTA: "Valuta" da sola in BPE Banca Etica significa la DIVISA (EUR), non la data!
    // La data effettiva è "Data valuta" oppure "Esecuzione/Scadenza" oppure "Data creazione".
    const idx = {
      data:     header.findIndex(h => /data\s*valuta/i.test(h)),
      dataEsec: header.findIndex(h => /esecuzione|scadenza/i.test(h)),
      dataOp:   header.findIndex(h => /data\s*operazione|data\s*creazione|data\s*contabile/i.test(h)),
      dataGen:  header.findIndex(h => /^data$/i.test(h)),
      desc:     header.findIndex(h => /descrizione|causale/i.test(h)),
      importo:  header.findIndex(h => /^importo$/i.test(h)),
      dare:     header.findIndex(h => /^dare$|^uscita$|addebito/i.test(h)),
      avere:    header.findIndex(h => /^avere$|^entrata$|accredito/i.test(h)),
      benef:    header.findIndex(h => /benefic|ordinante|controparte|deb\.\/contr/i.test(h)),
      stato:    header.findIndex(h => /stato/i.test(h)),
      tipo:     header.findIndex(h => /^servizio$|tipo\s*operazione/i.test(h)),
    };
    console.log("[parseEC] mapping colonne:", idx);

    // Priorità data: Data valuta → Esecuzione/Scadenza → Data operazione → Data generica
    const dataCol = idx.data >= 0 ? idx.data
                  : idx.dataEsec >= 0 ? idx.dataEsec
                  : idx.dataOp >= 0 ? idx.dataOp
                  : idx.dataGen;
    if (dataCol < 0) {
      console.warn("[parseEC] colonna data non trovata");
      continue;
    }

    const out = [];
    let saltati = { senza_data: 0, senza_importo: 0, non_eseguiti: 0 };
    for (let i = hdrIdx + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (!r.length || !r.some(c => c !== "" && c != null)) continue;
      const data = normalizzaData(r[dataCol]);
      if (!data) { saltati.senza_data++; continue; }

      // Importo: prima prova "importo" unico, altrimenti dare/avere
      let importo = 0;
      if (idx.importo >= 0) importo = parseImporto(r[idx.importo]);
      if (!importo && idx.dare >= 0) {
        const dare = parseImporto(r[idx.dare]);
        if (dare) importo = -Math.abs(dare);
      }
      if (!importo && idx.avere >= 0) {
        const avere = parseImporto(r[idx.avere]);
        if (avere) importo = Math.abs(avere);
      }
      if (!importo) { saltati.senza_importo++; continue; }

      const stato = idx.stato >= 0 ? String(r[idx.stato] || "").toUpperCase() : "ESEGUITO";
      if (stato && stato !== "ESEGUITO" && stato !== "") {
        saltati.non_eseguiti++;
        continue;
      }
      // Determina USCITA/ENTRATA dal servizio se importo è sempre positivo (caso BPE Etica)
      const servizio = idx.tipo >= 0 ? String(r[idx.tipo] || "").toLowerCase() : "";
      let isUscita = importo < 0;
      if (importo > 0 && servizio) {
        if (/bonifico|pagamento|addebito|distinta|f24|prelievo/.test(servizio)) isUscita = true;
        else if (/accredito|stipendio|incasso|versamento/.test(servizio)) isUscita = false;
      }

      out.push({
        data_valuta: data,
        data_esecuzione: normalizzaData(idx.dataOp >= 0 ? r[idx.dataOp] : r[dataCol]) || data,
        descrizione_banca: String(r[idx.desc] || "").trim(),
        beneficiario: idx.benef >= 0 ? String(r[idx.benef] || "").trim() : "",
        importo: Math.abs(importo),
        tipo_operazione: isUscita ? "USCITA" : "ENTRATA",
        anno: parseInt(data.slice(0,4), 10),
        mese: parseInt(data.slice(5,7), 10),
        stato_bpe: "ESEGUITO",
      });
    }
    console.log(`[parseEC] estratte ${out.length} righe valide · saltate:`, saltati);
    if (out.length > 0) return out;
  }

  throw new Error(
    "Nessuna riga valida trovata. Apri Console (F12) per vedere il log dettagliato " +
    "della struttura del file. Probabilmente le intestazioni di colonna non sono " +
    "tra quelle riconosciute. Mandami screenshot del log e correggo il parser."
  );
}

function parseCsvLine(line, sep) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
    else if (c === '"') q = !q;
    else if (c === sep && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function normalizzaData(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    let y = m[3]; if (y.length === 2) y = "20" + y;
    return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 25569 && n < 60000) {
      const d = new Date((n - 25569) * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function parseImporto(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/[€\s]/g, "");
  if (!s) return 0;
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  return parseFloat(s) || 0;
}

// =====================================================================
// EXPORT EXCEL — Primanota (formato Michele)
// =====================================================================
async function esportaPrimanotaExcel(anno) {
  const { movimenti } = await window.SB.getMovimenti({ anno, size: 5000, page: 1 });
  const data = movimenti.map(m => ({
    "Classif.": m.categoria || "",
    "Progressivo": m.progressivo || "",
    "Data": fmtDataIT(m.data),
    "Descrizione": m.descrizione || "",
    "Fornitore/Cliente": m.fornitore_cliente || "",
    "Progetto": m.progetto || "",
    "Cassa/E": m.cassa_entrata || "",
    "Cassa/U": m.cassa_uscita || "",
    "BPE/E":   m.bpe_entrata || "",
    "BPE/U":   m.bpe_uscita || "",
    "NEXI/E":  m.nexi_entrata || "",
    "NEXI/U":  m.nexi_uscita || "",
    "Link doc":     m.link_documento || "",
    "Link accopp.": m.link_file_accoppiato || "",
    "Link unito":   m.link_pdf_unito || "",
    "Stato": m.stato || "",
  }));
  const row = {
    "Classif.": "TOTALI",
    "Cassa/E": movimenti.reduce((s, m) => s + (parseFloat(m.cassa_entrata) || 0), 0),
    "Cassa/U": movimenti.reduce((s, m) => s + (parseFloat(m.cassa_uscita) || 0), 0),
    "BPE/E":   movimenti.reduce((s, m) => s + (parseFloat(m.bpe_entrata) || 0), 0),
    "BPE/U":   movimenti.reduce((s, m) => s + (parseFloat(m.bpe_uscita) || 0), 0),
    "NEXI/E":  movimenti.reduce((s, m) => s + (parseFloat(m.nexi_entrata) || 0), 0),
    "NEXI/U":  movimenti.reduce((s, m) => s + (parseFloat(m.nexi_uscita) || 0), 0),
  };
  data.push({}, row);
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Primanota ${anno}`);
  XLSX.writeFile(wb, `Primanota_${anno}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// =====================================================================
// EXPORT EXCEL — Rendicontazione per Ente
// =====================================================================
async function esportaRendicontazioneEnte(enteId, anno) {
  let q = window.sb.from("imputazioni").select("*, movimenti!inner(*), enti(nome,nome_completo)").eq("ente_id", enteId);
  if (anno) q = q.eq("movimenti.anno", anno);
  const { data: imp, error } = await q;
  if (error) throw error;
  const enteName = imp[0]?.enti?.nome || "Ente";
  const data = imp.map((r, i) => ({
    "N.": i + 1,
    "Progressivo": r.movimenti?.progressivo || "",
    "Data": fmtDataIT(r.movimenti?.data),
    "Descrizione": r.movimenti?.descrizione || "",
    "Fornitore": r.movimenti?.fornitore_cliente || "",
    "Importo doc.": r.movimenti?.importo || 0,
    "Quota imputata": r.quota_importo || 0,
    "Voce budget": r.voce_budget || "",
    "Link PDF": r.movimenti?.link_pdf_unito || r.movimenti?.link_documento || "",
    "Note": r.note || "",
  }));
  const tot = imp.reduce((s, r) => s + parseFloat(r.quota_importo || 0), 0);
  data.push({}, { "N.": "", "Progressivo": "TOTALE RENDICONTATO", "Quota imputata": tot });

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Rendiconto ${enteName}`.substring(0, 28));
  XLSX.writeFile(wb, `Rendiconto_${enteName}_${anno || "tutti"}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// =====================================================================
// EXPORT CSV
// =====================================================================
async function esportaCSV(anno) {
  const { movimenti } = await window.SB.getMovimenti({ anno, size: 5000, page: 1 });
  const rows = [["Progressivo","Data","Descrizione","Fornitore","Categoria","Metodo","Tipo","Importo","Progetto","Stato"]];
  for (const m of movimenti) {
    rows.push([
      m.progressivo, fmtDataIT(m.data), m.descrizione, m.fornitore_cliente,
      m.categoria, m.metodo, m.tipo, m.importo, m.progetto, m.stato,
    ]);
  }
  const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Movimenti_${anno}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

function fmtDataIT(iso) {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

// =====================================================================
// SCHERMATA EXPORT
// =====================================================================
function renderExportScreen() {
  const sec = document.getElementById("export-content");
  const annoCorr = new Date().getFullYear();
  const annis = [annoCorr - 1, annoCorr, annoCorr + 1];

  sec.innerHTML = `
    <div class="cards-grid">
      <div class="card">
        <div class="label">Export Prima Nota Excel</div>
        <p class="mb-1">Tutti i movimenti dell'anno con formato classico (Cassa/BPE/NEXI Entrata/Uscita).</p>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div><label>Anno</label><select id="ex-anno-pn">${annis.map(a=>`<option ${a===annoCorr?"selected":""}>${a}</option>`).join("")}</select></div>
          <div><label>&nbsp;</label><button id="btn-ex-pn">Scarica Excel</button></div>
        </div>
      </div>

      <div class="card">
        <div class="label">Rendicontazione per Ente</div>
        <p class="mb-1">Excel imputazioni per un singolo ente — pronto per RAS, FDS, ecc.</p>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div><label>Ente</label><select id="ex-ente"></select></div>
          <div><label>Anno</label><select id="ex-anno-ente"><option value="">Tutti</option>${annis.map(a=>`<option>${a}</option>`).join("")}</select></div>
        </div>
        <button class="mt-1" id="btn-ex-ente">Scarica Excel</button>
      </div>

      <div class="card">
        <div class="label">Export CSV (commercialista)</div>
        <p class="mb-1">CSV semplice con tutti i movimenti dell'anno.</p>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div><label>Anno</label><select id="ex-anno-csv">${annis.map(a=>`<option ${a===annoCorr?"selected":""}>${a}</option>`).join("")}</select></div>
          <div><label>&nbsp;</label><button class="secondary" id="btn-ex-csv">Scarica CSV</button></div>
        </div>
      </div>
    </div>
  `;

  window.SB.getEnti().then(list => {
    const sel = document.getElementById("ex-ente");
    sel.innerHTML = list.map(e => `<option value="${e.id}">${e.nome}</option>`).join("");
  });

  document.getElementById("btn-ex-pn").onclick = () => esportaPrimanotaExcel(+document.getElementById("ex-anno-pn").value);
  document.getElementById("btn-ex-ente").onclick = () => {
    const id = document.getElementById("ex-ente").value;
    const a = document.getElementById("ex-anno-ente").value;
    esportaRendicontazioneEnte(id, a ? +a : null);
  };
  document.getElementById("btn-ex-csv").onclick = () => esportaCSV(+document.getElementById("ex-anno-csv").value);
}

// =====================================================================
// EXPORT EXCEL — Rendicontazione formato Michele (foglio per ente)
// Stessa struttura del file BUDGET SSF 2026 EDUCATIONAL → foglio AGLIENTU
// Colonne: N° | VOCE DI COSTO | Preventivo | Consuntivo | PAGATE DA | Note
// =====================================================================
async function esportaRendicontazioneFormatoMichele(enteId, progetto, anno) {
  console.log("[Export Rendiconto] start", { enteId, progetto, anno });
  console.log("[Export Rendiconto] step 1: getEnti...");
  const enti = await window.SB.getEnti();
  console.log("[Export Rendiconto] step 2: getVociBudget(" + progetto + ")");
  const voci = await window.SB.getVociBudget(progetto);
  console.log("[Export Rendiconto]   trovate", voci.length, "voci");
  console.log("[Export Rendiconto] step 3: getBudgetEnteVoce");
  const budgetEnte = await window.SB.getBudgetEnteVoce({ ente_id: enteId, progetto, anno });
  console.log("[Export Rendiconto]   preventivi:", budgetEnte.length);
  console.log("[Export Rendiconto] step 4: getConsuntivoEnteVoce");
  const consuntivi = await window.SB.getConsuntivoEnteVoce({ ente_id: enteId, progetto, anno });
  console.log("[Export Rendiconto]   consuntivi:", consuntivi.length);
  const ente = enti.find(e => e.id === enteId);
  const enteName = ente?.nome || "Ente";

  const preventivoMap = Object.fromEntries(budgetEnte.map(b => [b.voce_codice, +b.preventivo || 0]));
  const consuntivoMap = Object.fromEntries(consuntivi.map(c => [c.voce_codice, +c.consuntivo || 0]));

  // Costruisce righe nel formato di Michele
  const aoa = [];
  aoa.push([null, null, null, `${progetto.toUpperCase()} ${anno} | ${enteName.toUpperCase()}`]);
  aoa.push([null, null, null, "RENDICONTAZIONE"]);
  aoa.push([]);
  aoa.push([null, null, "N°", "VOCE DI COSTO", "Preventivo", "Consuntivo", "PAGATE DA", "Note"]);

  let totPrev = 0, totCons = 0;
  voci.forEach(v => {
    const prev = preventivoMap[v.codice] || 0;
    const cons = consuntivoMap[v.codice] || 0;
    totPrev += prev;
    totCons += cons;
    aoa.push([
      null, null,
      v.codice,
      v.nome,
      prev > 0 ? prev : null,
      cons > 0 ? cons : 0,
      null,
      null,
    ]);
  });

  aoa.push([]);
  aoa.push([null, null, null, "TOTALE", totPrev, totCons, null, null]);

  // Costruisci worksheet con SheetJS
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Larghezze colonne consigliate
  ws["!cols"] = [
    { wch: 3 }, { wch: 3 }, { wch: 6 }, { wch: 50 },
    { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 30 },
  ];

  const wb = XLSX.utils.book_new();
  const sheetName = `${enteName} | ${anno}`.substring(0, 28);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Foglio aggiuntivo: elenco analitico movimenti che alimentano il consuntivo
  const movs = [];
  for (const v of voci) {
    if (!consuntivoMap[v.codice]) continue;
    const lista = await window.SB.getMovimentiPerVoceEnte({ ente_id: enteId, voce_codice: v.codice, progetto, anno });
    lista.forEach(m => movs.push({
      voce_codice: v.codice,
      voce_nome: v.nome,
      progressivo: m.progressivo,
      data: fmtDataIT(m.data),
      descrizione: m.descrizione,
      fornitore: m.fornitore_cliente,
      importo_doc: m.importo,
      quota_imputata: m.quota_imputata,
      link_doc: m.link_documento || "",
    }));
  }
  if (movs.length) {
    const ws2 = XLSX.utils.json_to_sheet(movs, {
      header: ["voce_codice","voce_nome","progressivo","data","descrizione","fornitore","importo_doc","quota_imputata","link_doc"],
    });
    ws2["!cols"] = [{wch:8},{wch:35},{wch:14},{wch:11},{wch:40},{wch:30},{wch:12},{wch:14},{wch:40}];
    XLSX.utils.book_append_sheet(wb, ws2, "Dettaglio movimenti");
  }

  XLSX.writeFile(wb, `Rendicontazione_${enteName}_${progetto}_${anno}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

window.EXPORT_SCREEN = {
  render: renderExportScreen,
  parseECFile,
  esportaPrimanotaExcel,
  esportaRendicontazioneEnte,
  esportaRendicontazioneFormatoMichele,
  esportaCSV,
};
