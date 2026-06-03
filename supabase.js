// =====================================================================
// supabase.js — client Supabase + tutte le query del progetto
// =====================================================================

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const sb = createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
window.sb = sb;

// =====================================================================
// AUTH
// =====================================================================
async function login(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
async function logout() {
  await sb.auth.signOut();
}
async function currentUser() {
  const { data } = await sb.auth.getUser();
  if (!data?.user) return null;
  const u = data.user;
  return {
    id: u.id,
    email: u.email,
    nome: u.user_metadata?.nome || u.email,
    ruolo: u.user_metadata?.ruolo || "viewer",
  };
}

// =====================================================================
// MOVIMENTI
// =====================================================================
async function getMovimenti(filtri = {}) {
  let q = sb.from("movimenti").select("*", { count: "exact" });
  // Solo movimenti primari nella lista principale
  q = q.is("parent_id", null);
  if (filtri.anno)       q = q.eq("anno", filtri.anno);
  if (filtri.mese) {
    const y = filtri.anno || new Date().getFullYear();
    const m = filtri.mese;
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    q = q.gte("data", `${y}-${String(m).padStart(2,"0")}-01`)
         .lt("data",  `${nextY}-${String(nextM).padStart(2,"0")}-01`);
  }
  if (filtri.tipo)       q = q.eq("tipo", filtri.tipo);
  if (filtri.categoria)  q = q.eq("categoria", filtri.categoria);
  if (filtri.metodo)     q = q.eq("metodo", filtri.metodo);
  if (filtri.progetto)   q = q.eq("progetto", filtri.progetto);
  if (filtri.stato)      q = q.eq("stato", filtri.stato);
  if (filtri.testo) {
    q = q.or(`descrizione.ilike.%${filtri.testo}%,fornitore_cliente.ilike.%${filtri.testo}%,progressivo.ilike.%${filtri.testo}%,numero_documento.ilike.%${filtri.testo}%`);
  }
  const sortBy  = filtri.sortBy  || "data";
  const sortDir = filtri.sortDir === "asc";
  if (sortBy === "data" || sortBy === "progressivo") {
    q = q.order("ordine_manuale", { ascending: true, nullsFirst: false })
         .order("data",       { ascending: sortDir })
         .order("creato_il",  { ascending: sortDir })
         .order("id",         { ascending: sortDir });
  } else {
    q = q.order(sortBy, { ascending: sortDir });
  }
  const page = filtri.page || 1;
  const size = filtri.size || 50;
  q = q.range((page - 1) * size, page * size - 1);
  const { data, count, error } = await q;
  if (error) throw error;
  const movs = data || [];
  // Carica conteggio figli per ogni movimento
  if (movs.length > 0) {
    const ids = movs.map(m => m.id);
    const { data: figli } = await sb.from("movimenti").select("parent_id").in("parent_id", ids);
    const cc = {};
    (figli || []).forEach(f => { cc[f.parent_id] = (cc[f.parent_id] || 0) + 1; });
    movs.forEach(m => { m.child_count = cc[m.id] || 0; });
  }
  return { movimenti: movs, total: count || 0, page, size };
}

// Carica i sotto-movimenti (figli) di un movimento padre
async function getFigliMovimento(parentId) {
  const { data, error } = await sb.from("movimenti")
    .select("*")
    .eq("parent_id", parentId)
    .order("data", { ascending: true })
    .order("creato_il", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Crea un sotto-movimento figlio
async function creaFiglioMovimento(dati) {
  const { data, error } = await sb.from("movimenti").insert([dati]).select().single();
  if (error) throw error;
  return data;
}

// Promuovi figlio a primario (parent_id = NULL)
// Se il padre non ha altri figli, rimuove is_reference
async function promuoviFiglioAPrimario(figlioId, padreId) {
  const { error } = await sb.from("movimenti").update({ parent_id: null }).eq("id", figlioId);
  if (error) throw error;
  if (padreId) {
    const { data: altriFigli } = await sb.from("movimenti").select("id").eq("parent_id", padreId);
    if (!altriFigli || altriFigli.length === 0) {
      await sb.from("movimenti").update({ is_reference: false }).eq("id", padreId);
    }
  }
}

// Converti padre a riferimento (senza progressivo, contiene i figli)
async function convertePadreARiferimento(padreId) {
  const { error } = await sb.from("movimenti").update({ is_reference: true }).eq("id", padreId);
  if (error) throw error;
}

// Ripristina padre da riferimento a normale
async function ripristinaPadreNormale(padreId) {
  const { error } = await sb.from("movimenti").update({ is_reference: false }).eq("id", padreId);
  if (error) throw error;
}

async function getMovimento(id) {
  const { data, error } = await sb.from("movimenti").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function generaProgressivo(prefix, anno) {
  const { data, error } = await sb.rpc("genera_progressivo", { p_prefix: prefix, p_anno: anno });
  if (error) throw error;
  return data;
}

// Ricalcola tutti i progressivi cronologici per l'anno (chiamato dopo CRUD)
async function ricalcolaProgressivi(anno) {
  const { error } = await sb.rpc("ricalcola_progressivi", { p_anno: anno });
  if (error) console.warn("Ricalcolo progressivi fallito:", error.message);
}

// Normalizza nome fornitore per fuzzy match (rimuove SRL/SAS/spazi/punti/case)
function normalizzaFornitore(s) {
  if (!s) return "";
  return String(s).toLowerCase()
    .replace(/\bs\.?\s?r\.?\s?l\.?(\s|$)/g, " ")
    .replace(/\bs\.?\s?a\.?\s?s\.?(\s|$)/g, " ")
    .replace(/\bs\.?\s?p\.?\s?a\.?(\s|$)/g, " ")
    .replace(/\bsoc\.?\s?coop\.?(\s|$)/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Similarità tra due stringhe (0-100). Basato su token overlap (Jaccard) + substring.
function similaritaFornitore(a, b) {
  const na = normalizzaFornitore(a);
  const nb = normalizzaFornitore(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 90;
  const ta = new Set(na.split(" ").filter(w => w.length > 2));
  const tb = new Set(nb.split(" ").filter(w => w.length > 2));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter(t => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return Math.round((inter / union) * 100);
}

// Calcola score di match (0-100) per un movimento dato un documento estratto
function calcolaScoreMatch(mov, doc) {
  const importoMov = parseFloat(mov.importo) || 0;
  const importoDoc = parseFloat(doc.importo) || 0;
  const deltaImp = Math.abs(importoMov - importoDoc);
  const scoreImporto = deltaImp === 0 ? 100
    : deltaImp <= 0.5 ? 95
    : deltaImp <= 2   ? 80
    : deltaImp <= 5   ? 50
    : 0;
  const scoreFornitore = similaritaFornitore(mov.fornitore_cliente, doc.fornitore_cliente);
  // Differenza date in giorni
  const dataMov = mov.data ? new Date(mov.data) : null;
  const dataDoc = doc.data_documento || doc.data;
  const dataDocD = dataDoc ? new Date(dataDoc) : null;
  let scoreData = 0;
  if (dataMov && dataDocD) {
    const giorni = Math.abs((dataMov - dataDocD) / 86400000);
    scoreData = giorni <= 3 ? 100
      : giorni <= 10 ? 85
      : giorni <= 30 ? 65
      : giorni <= 60 ? 35
      : 0;
  }
  // Peso: importo 50% + fornitore 30% + data 20%
  const total = scoreImporto * 0.5 + scoreFornitore * 0.3 + scoreData * 0.2;
  return Math.round(total);
}

// Cerca movimenti candidati al match con un documento appena analizzato.
// Ritorna lista ordinata per score decrescente. Soglia minima 30% per essere candidato.
async function cercaMatchPerDocumento({ data, data_documento, importo, fornitore_cliente }) {
  if (!importo) return [];
  const baseDate = data_documento || data || new Date().toISOString().slice(0,10);
  const center = new Date(baseDate);
  const min = new Date(center); min.setDate(min.getDate() - 60);
  const max = new Date(center); max.setDate(max.getDate() + 120);

  // Pre-filtro DB largo (importo ±5 EUR, finestra date ampia)
  const importoNum = parseFloat(importo) || 0;
  let q = sb.from("movimenti")
    .select("id, progressivo, data, descrizione, fornitore_cliente, importo, tipo, metodo, stato, ec_id")
    .in("stato", ["Manca doc", "Vuoto"])
    .gte("importo", importoNum - 5)
    .lte("importo", importoNum + 5)
    .gte("data", min.toISOString().slice(0,10))
    .lte("data", max.toISOString().slice(0,10));

  const { data: rows, error } = await q;
  if (error) throw error;

  // Calcola score per ognuno
  const doc = { importo, data, data_documento, fornitore_cliente };
  const ranked = (rows || []).map(m => ({
    ...m,
    score: calcolaScoreMatch(m, doc),
  })).filter(m => m.score >= 30).sort((a, b) => b.score - a.score);
  return ranked.slice(0, 10);
}

// =====================================================================
// CODA DOCUMENTI (documenti analizzati che aspettano triage manuale)
// =====================================================================

// Inserisce/aggiorna un documento Drive in coda con i dati AI estratti
async function salvaDocumentoDaTriagre({ drive_file_id, nome_file, folder_path, web_view_link, ai, match_score, stato, movimento_id, note_match }) {
  const payload = {
    drive_file_id,
    nome_file,
    folder_path,
    web_view_link,
    stato: stato || 'da_abbinare',
    movimento_id: movimento_id || null,
    match_score: match_score || null,
    note_match: note_match || null,
    ai_data_documento: ai?.data_documento || null,
    ai_importo: ai?.importo ?? null,
    ai_tipo: ai?.tipo || null,
    ai_fornitore: ai?.fornitore_cliente || null,
    ai_numero_documento: ai?.numero_documento || null,
    ai_descrizione: ai?.descrizione || null,
    ai_categoria: ai?.categoria || null,
    ai_metodo: ai?.metodo || null,
    ai_progetto: ai?.progetto || null,
    ai_confidenza: ai?.confidenza ?? null,
  };
  const { data, error } = await sb.from("documenti_drive")
    .upsert(payload, { onConflict: "drive_file_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getDocumentiInCoda(filtri = {}) {
  let q = sb.from("documenti_drive").select("*, movimenti(progressivo, data, importo)");
  if (filtri.stato) q = q.eq("stato", filtri.stato);
  q = q.order("importato_il", { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function aggiornaStatoDocumento(drive_file_id, stato, movimento_id = null, note = null) {
  const patch = { stato };
  if (movimento_id !== null) patch.movimento_id = movimento_id;
  if (note) patch.note_match = note;
  const { error } = await sb.from("documenti_drive").update(patch).eq("drive_file_id", drive_file_id);
  if (error) throw error;
}

// Allega un documento a un movimento esistente (compat: 1:1)
async function allegaDocumentoAMovimento(movimento_id, { link_documento, data_documento, numero_documento, drive_file_id }) {
  return allegaDocumentoAMovimenti([movimento_id], { link_documento, data_documento, numero_documento, drive_file_id });
}

// Allega lo STESSO documento a 1 o più movimenti (modello N:1)
// Aggiorna tutti i movimenti in batch con gli stessi link/dati documento.
async function allegaDocumentoAMovimenti(movimento_ids, { link_documento, data_documento, numero_documento, drive_file_id }) {
  if (!Array.isArray(movimento_ids)) movimento_ids = [movimento_ids];
  if (!movimento_ids.length) throw new Error("Nessun movimento selezionato");
  const patch = {};
  if (link_documento)    patch.link_documento = link_documento;
  if (data_documento)    patch.data_documento = data_documento;
  if (numero_documento)  patch.numero_documento = numero_documento;
  if (drive_file_id)     patch.drive_file_id = drive_file_id;
  const { data, error } = await sb.from("movimenti").update(patch).in("id", movimento_ids).select();
  if (error) throw error;
  return data || [];
}

// Cerca movimenti "liberi" (Manca doc, Vuoto, Attesa EC) per il modale Allega.
// Supporta filtri, ricerca testuale e paginazione.
async function cercaMovimentiLiberi({
  anno = null, mese = null,
  testo = null,           // cerca su descrizione/fornitore/numero_documento
  stato_filter = 'liberi', // 'liberi' | 'tutti' | un singolo stato specifico
  page = 1, size = 50,
} = {}) {
  let q = sb.from("movimenti").select(
    "id, progressivo, data, descrizione, fornitore_cliente, importo, tipo, metodo, stato, anno",
    { count: "exact" }
  );

  // Filtro stato:
  // - 'liberi' = solo movimenti che possono ricevere un documento (senza link_documento valorizzato)
  // - 'tutti' = tutti
  // - altro = uno stato specifico
  if (stato_filter === 'liberi') {
    q = q.in("stato", ["Manca doc", "Vuoto", "Attesa EC"]);
  } else if (stato_filter !== 'tutti') {
    q = q.eq("stato", stato_filter);
  }

  if (anno) q = q.eq("anno", anno);
  if (mese) {
    const annoUse = anno || new Date().getFullYear();
    q = q.gte("data", `${annoUse}-${String(mese).padStart(2,"0")}-01`)
         .lt("data",  `${annoUse}-${String(mese).padStart(2,"0")}-31`);
  }
  if (testo) {
    q = q.or(`descrizione.ilike.%${testo}%,fornitore_cliente.ilike.%${testo}%,numero_documento.ilike.%${testo}%`);
  }
  q = q.order("data", { ascending: false }).range((page - 1) * size, page * size - 1);

  const { data, count, error } = await q;
  if (error) throw error;
  return { movimenti: data || [], total: count || 0, page, size };
}

// Determina il prefisso del progressivo in base a tipo/categoria/descrizione
function prefissoProgressivo(mov) {
  const desc = (mov.descrizione || "").toLowerCase();
  if (mov.tipo === "ENTRATA") {
    if (mov.categoria === "E10") return "E10";
    if (mov.categoria === "E1")  return "E1";
    return "E";
  }
  if (mov.categoria === "U4") return "BP";
  if (desc.includes("nota spese") || desc.includes("ns "))  return "NS";
  if (desc.includes(" np ") || desc.startsWith("np "))      return "NP";
  if (desc.includes("f24"))                                  return "F24";
  return "FPR";
}

async function salvaMovimento(mov) {
  // UPDATE PARZIALE: se l'oggetto contiene id + pochi campi
  const camposPasados = Object.keys(mov).filter(k => k !== "id");
  const isPartialUpdate = mov.id && camposPasados.length < 4 && !("importo" in mov);
  if (isPartialUpdate) {
    const payload = { ...mov };
    delete payload.id;
    delete payload.progressivo; // il progressivo NON è scritto dal client (auto via trigger)
    const { data, error } = await sb.from("movimenti").update(payload).eq("id", mov.id).select().single();
    if (error) throw error;
    return data;
  }

  // FULL save: calcola split per metodo
  const importo = parseFloat(mov.importo) || 0;
  const split = {
    cassa_entrata: null, cassa_uscita: null,
    bpe_entrata: null,   bpe_uscita: null,
    nexi_entrata: null,  nexi_uscita: null,
  };
  const key = (mov.metodo || "BPE").toLowerCase() + "_" + (mov.tipo === "ENTRATA" ? "entrata" : "uscita");
  if (key in split) split[key] = importo;

  const anno = mov.anno || parseInt(String(mov.data).slice(0,4), 10);

  // Il progressivo è gestito dal trigger DB. Non lo inviamo dal client.
  const payload = { ...mov, ...split, importo, anno };
  delete payload.progressivo;

  if (mov.id) {
    const { data, error } = await sb.from("movimenti").update(payload).eq("id", mov.id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await sb.from("movimenti").insert(payload).select().single();
    if (error) throw error;
    return data;
  }
}

async function eliminaMovimento(id) {
  const { error } = await sb.from("movimenti").delete().eq("id", id);
  if (error) throw error;
}

// Trasferisce il documento (link + numero_documento + data_documento) dal movimento source
// al movimento target, poi cancella il source. Usato dal bottone "Unisci".
async function unisciMovimenti(source_id, target_id) {
  if (source_id === target_id) throw new Error("Sorgente e destinazione identici");
  const { data: src, error: e1 } = await sb.from("movimenti").select("*").eq("id", source_id).single();
  if (e1) throw e1;
  const { data: tgt, error: e2 } = await sb.from("movimenti").select("*").eq("id", target_id).single();
  if (e2) throw e2;
  // Trasferisci campi documento se presenti su source e mancanti su target
  const patch = {};
  if (src.link_documento && !tgt.link_documento)         patch.link_documento = src.link_documento;
  if (src.link_file_accoppiato && !tgt.link_file_accoppiato) patch.link_file_accoppiato = src.link_file_accoppiato;
  if (src.link_pdf_unito && !tgt.link_pdf_unito)         patch.link_pdf_unito = src.link_pdf_unito;
  if (src.drive_file_id && !tgt.drive_file_id)           patch.drive_file_id = src.drive_file_id;
  if (src.data_documento && !tgt.data_documento)         patch.data_documento = src.data_documento;
  if (src.numero_documento && !tgt.numero_documento)     patch.numero_documento = src.numero_documento;
  if (Object.keys(patch).length) {
    const { error: e3 } = await sb.from("movimenti").update(patch).eq("id", target_id);
    if (e3) throw e3;
  }
  // Aggiorna documenti_drive: se il source era collegato a un documento Drive, sposta il link al target
  if (src.drive_file_id) {
    await sb.from("documenti_drive").update({ movimento_id: target_id }).eq("drive_file_id", src.drive_file_id);
  }
  // Cancella il movimento source
  const { error: e4 } = await sb.from("movimenti").delete().eq("id", source_id);
  if (e4) throw e4;
  return tgt;
}

// Scollega il documento da un movimento (rimuove link_documento, link_file_accoppiato, ecc.)
// Il documento torna in coda 'da_abbinare' se era tracciato in documenti_drive.
async function scollegaDocumento(movimento_id) {
  const { data: mov, error: e1 } = await sb.from("movimenti").select("drive_file_id").eq("id", movimento_id).single();
  if (e1) throw e1;
  const { error: e2 } = await sb.from("movimenti").update({
    link_documento: null,
    link_file_accoppiato: null,
    link_pdf_unito: null,
    drive_file_id: null,
    data_documento: null,
  }).eq("id", movimento_id);
  if (e2) throw e2;
  // Se c'era un documento Drive collegato, riportalo in coda
  if (mov.drive_file_id) {
    await sb.from("documenti_drive").update({
      movimento_id: null,
      stato: 'da_abbinare',
      note_match: 'Scollegato manualmente',
    }).eq("drive_file_id", mov.drive_file_id);
  }
}

// Rilevamento doppioni: stesso importo + fornitore + data ±3 giorni
async function cercaDoppioni({ data, importo, fornitore_cliente, excludeId = null }) {
  if (!data || !importo) return [];
  const dt = new Date(data);
  const min = new Date(dt); min.setDate(min.getDate() - 3);
  const max = new Date(dt); max.setDate(max.getDate() + 3);
  let q = sb.from("movimenti").select("id,progressivo,data,descrizione,fornitore_cliente,importo,tipo")
    .gte("data", min.toISOString().slice(0,10))
    .lte("data", max.toISOString().slice(0,10))
    .gte("importo", importo - 0.005)
    .lte("importo", importo + 0.005);
  if (fornitore_cliente) q = q.ilike("fornitore_cliente", fornitore_cliente);
  if (excludeId)         q = q.neq("id", excludeId);
  const { data: rows, error } = await q;
  if (error) throw error;
  return rows || [];
}

// =====================================================================
// EC BANCARIO
// =====================================================================
async function getEC(filtri = {}) {
  let q = sb.from("ec_bancario").select("*");
  if (filtri.anno)   q = q.eq("anno", filtri.anno);
  if (filtri.mese)   q = q.eq("mese", filtri.mese);
  if (filtri.conto)  q = q.eq("conto", filtri.conto);
  if (filtri.stato)  q = q.eq("stato", filtri.stato);
  q = q.order("data_valuta", { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function importaEC(righe, conto = "BPE") {
  // Dedup: salta righe con stessa data_valuta + importo + descrizione_banca già presenti
  const inseriti = [];
  for (const r of righe) {
    const { count } = await sb.from("ec_bancario").select("id", { count: "exact", head: true })
      .eq("data_valuta", r.data_valuta)
      .eq("importo", r.importo)
      .eq("descrizione_banca", r.descrizione_banca)
      .eq("conto", conto);
    if (count && count > 0) continue;
    const payload = {
      data_valuta: r.data_valuta,
      data_esecuzione: r.data_esecuzione || r.data_valuta,
      descrizione_banca: r.descrizione_banca,
      beneficiario: r.beneficiario || "",
      tipo_operazione: r.tipo_operazione || "",
      importo: r.importo,
      conto,
      anno: r.anno || parseInt(String(r.data_valuta).slice(0,4), 10),
      mese: r.mese || parseInt(String(r.data_valuta).slice(5,7), 10),
      stato_bpe: r.stato_bpe || "ESEGUITO",
      stato: "Da abbinare",
    };
    const { data, error } = await sb.from("ec_bancario").insert(payload).select().single();
    if (!error && data) inseriti.push(data);
  }
  return inseriti;
}

async function abbinaEC(movimento_id, ec_id) {
  const { error: e1 } = await sb.from("movimenti").update({ ec_id }).eq("id", movimento_id);
  if (e1) throw e1;
  const { error: e2 } = await sb.from("ec_bancario").update({ movimento_id, stato: "Abbinato" }).eq("id", ec_id);
  if (e2) throw e2;
}

async function disabbinaEC(ec_id) {
  const { data: ec } = await sb.from("ec_bancario").select("movimento_id").eq("id", ec_id).single();
  if (ec?.movimento_id) {
    await sb.from("movimenti").update({ ec_id: null }).eq("id", ec.movimento_id);
  }
  await sb.from("ec_bancario").update({ movimento_id: null, stato: "Da abbinare" }).eq("id", ec_id);
}

// Auto-categorizza un movimento bancario in base alla descrizione/beneficiario
function inferisciCategoria(desc, benef, tipo) {
  const t = ((desc || "") + " " + (benef || "")).toLowerCase();
  if (tipo === "ENTRATA") {
    if (/contributo|invitalia|fds|fondazione|ras|comune|regione/.test(t)) return "E10";
    if (/fattura|fpr|saldo ft/.test(t)) return "E7";
    if (/quota associativ|prestito.*soci|prestito.*infrutt/.test(t)) return "E1";
    if (/biglietteria|incasso/.test(t)) return "E11";
    return "E11";
  }
  if (/commission|bollo|imposta|tenuta\s*conto|spese\s*c\/c|pagopa|fidejus/.test(t)) return "U5";
  if (/bp\s|busta\s*paga|stipendio|tredicesim|tfr|anticipo\s*bp/.test(t)) return "U4";
  if (/interess/.test(t)) return "U6";
  if (/rata\s*mutuo|quota.*capitale|rimborso.*prestito/.test(t)) return "U10";
  if (/wind|tre\s|tim\s|fastweb|telecom|grimaldi|trenitalia|aereoitalia|volo|traghetto/.test(t)) return "U2";
  if (/amazon|edenred|enilive|buon[ie].*carburant|cancelleria/.test(t)) return "U1";
  if (/scarpis|locazion|affitt|aruba|hosting|sede/.test(t)) return "U3";
  if (/cachet|np\s|nota.?spese|fattura.*artist|fattura.*coop|doc\s*servizi/.test(t)) return "U7";
  return "U2"; // default servizi
}

// Genera prefisso progressivo da categoria/descrizione
function prefissoProgFromCategory(desc, categoria, tipo) {
  const t = (desc || "").toLowerCase();
  if (tipo === "ENTRATA") {
    if (categoria === "E10") return "E10";
    if (categoria === "E1")  return "E1";
    return "E";
  }
  if (categoria === "U4") return "BP";
  if (/nota\s*spese|^ns/.test(t)) return "NS";
  if (/\bnp\b/.test(t)) return "NP";
  if (/f24/.test(t)) return "F24";
  // Le commissioni/bolli non hanno progressivo nel sistema di Michele
  if (categoria === "U5" || categoria === "U6") return null;
  return "FPR";
}

// Crea bozze di movimenti per le righe EC non ancora abbinate
// Ritorna {created, skipped}
async function creaBozzeDaECLibere({ anno, conto } = {}) {
  let q = sb.from("ec_bancario").select("*").is("movimento_id", null).eq("stato", "Da abbinare");
  if (anno)  q = q.eq("anno", anno);
  if (conto) q = q.eq("conto", conto);
  const { data: rows, error } = await q;
  if (error) throw error;

  const out = { created: 0, skipped: 0, errors: [] };
  for (const ec of rows || []) {
    try {
      const tipo = ec.tipo_operazione === "ENTRATA" ? "ENTRATA" : "USCITA";
      const categoria = inferisciCategoria(ec.descrizione_banca, ec.beneficiario, tipo);
      const annoMov = parseInt(String(ec.data_valuta).slice(0,4), 10);

      const desc = (ec.descrizione_banca || "").substring(0, 200);
      // Commissioni, bolli, interessi: senza documento per definizione
      const senza_documento = ["U5", "U6"].includes(categoria) ||
        /commission|^bollo|imposta\s*di\s*bollo|tenuta\s*conto|interess/i.test(desc);

      const mov = {
        // progressivo: gestito dal trigger DB (ricalcola in ordine cronologico)
        data: ec.data_valuta,
        tipo,
        descrizione: desc || "(senza descrizione)",
        fornitore_cliente: ec.beneficiario || "",
        progetto: "Generale",
        categoria,
        metodo: ec.conto,
        importo: ec.importo,
        anno: annoMov,
        ec_id: ec.id,
        senza_documento,
        note: `Auto-creato da EC ${ec.conto} del ${ec.data_valuta}`,
      };
      // Split colonne metodo (importo nel campo giusto)
      const key = (ec.conto || "BPE").toLowerCase() + "_" + (tipo === "ENTRATA" ? "entrata" : "uscita");
      mov[key] = ec.importo;

      const { data: newMov, error: e1 } = await sb.from("movimenti").insert(mov).select().single();
      if (e1) throw e1;
      // Aggiorna EC: ora è abbinato
      await sb.from("ec_bancario").update({ movimento_id: newMov.id, stato: "Abbinato" }).eq("id", ec.id);
      out.created++;
    } catch (e) {
      out.errors.push({ ec_id: ec.id, msg: e.message });
      out.skipped++;
    }
  }
  return out;
}

// =====================================================================
// ENTI
// =====================================================================
async function getEnti(filtri = {}) {
  let q = sb.from("enti").select("*");
  if (filtri.anno)   q = q.eq("anno", filtri.anno);
  if (filtri.attivo !== undefined) q = q.eq("attivo", filtri.attivo);
  q = q.order("nome");
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function salvaEnte(ente) {
  if (ente.id) {
    const { data, error } = await sb.from("enti").update(ente).eq("id", ente.id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await sb.from("enti").insert(ente).select().single();
    if (error) throw error;
    return data;
  }
}

// Spese totali imputate per ente (somma quote dalle imputazioni filtrando per anno del movimento)
async function speseImputatePerEnte(anno) {
  const { data: imp, error } = await sb
    .from("imputazioni")
    .select("ente_id, quota_importo, movimenti!inner(anno)");
  if (error) throw error;
  const totali = {};
  for (const r of imp || []) {
    if (anno && r.movimenti?.anno !== anno) continue;
    totali[r.ente_id] = (totali[r.ente_id] || 0) + parseFloat(r.quota_importo || 0);
  }
  return totali;
}

// =====================================================================
// PROGETTI
// =====================================================================
async function getProgetti({ soloAttivi = true } = {}) {
  let q = sb.from("progetti").select("*").order("ordine").order("nome");
  if (soloAttivi) q = q.eq("attivo", true);
  const { data, error } = await q;
  if (error) {
    // Fallback se la tabella non esiste (DB non patched): ritorna lista hardcoded
    console.warn("Tabella progetti non disponibile, uso fallback hardcoded:", error.message);
    return [
      { nome: "Generale", attivo: true, ordine: 1 },
      { nome: "SSF Estivo", attivo: true, ordine: 10 },
      { nome: "SSF EDU", attivo: true, ordine: 11 },
      { nome: "Silent Tales", attivo: true, ordine: 20 },
      { nome: "Itinerari EDU VE", attivo: true, ordine: 30 },
    ];
  }
  return data || [];
}

async function salvaProgetto(p) {
  if (p.id) {
    const { data, error } = await sb.from("progetti").update(p).eq("id", p.id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await sb.from("progetti").insert(p).select().single();
    if (error) throw error;
    return data;
  }
}

async function eliminaProgetto(id) {
  const { error } = await sb.from("progetti").delete().eq("id", id);
  if (error) throw error;
}

// =====================================================================
// VOCI BUDGET
// =====================================================================
async function getVociBudget(progetto = null) {
  let q = sb.from("voci_budget").select("*").eq("attivo", true).order("ordine");
  if (progetto) q = q.eq("progetto", progetto);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function salvaVoceBudget(voce) {
  if (voce.id) {
    const { data, error } = await sb.from("voci_budget").update(voce).eq("id", voce.id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await sb.from("voci_budget").insert(voce).select().single();
    if (error) throw error;
    return data;
  }
}

async function eliminaVoceBudget(id) {
  const { error } = await sb.from("voci_budget").delete().eq("id", id);
  if (error) throw error;
}

// =====================================================================
// BUDGET ENTE x VOCE (preventivi)
// =====================================================================
async function getBudgetEnteVoce({ ente_id = null, progetto = null, anno = null } = {}) {
  let q = sb.from("budget_ente_voce").select("*, enti(nome)");
  if (ente_id)  q = q.eq("ente_id", ente_id);
  if (progetto) q = q.eq("progetto", progetto);
  if (anno)     q = q.eq("anno", anno);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Imposta o aggiorna un preventivo per (ente, voce, progetto, anno)
async function setPreventivo({ ente_id, voce_codice, progetto, anno, preventivo, note }) {
  const payload = { ente_id, voce_codice, progetto, anno, preventivo: parseFloat(preventivo) || 0, note: note || null };
  const { data, error } = await sb
    .from("budget_ente_voce")
    .upsert(payload, { onConflict: "ente_id,voce_codice,progetto,anno" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Consuntivo aggregato (somma imputazioni per voce/ente/progetto/anno)
async function getConsuntivoEnteVoce({ ente_id = null, progetto = null, anno = null } = {}) {
  let q = sb.from("v_consuntivo_ente_voce").select("*");
  if (ente_id)  q = q.eq("ente_id", ente_id);
  if (progetto) q = q.eq("progetto", progetto);
  if (anno)     q = q.eq("anno", anno);
  const { data, error } = await q;
  if (error) {
    // Fallback se la vista non esiste: query manuale
    return await getConsuntivoEnteVoceFallback({ ente_id, progetto, anno });
  }
  return data || [];
}

async function getConsuntivoEnteVoceFallback({ ente_id, progetto, anno }) {
  let q = sb.from("imputazioni").select("ente_id, voce_budget, quota_importo, movimenti!inner(progetto, anno)");
  if (ente_id) q = q.eq("ente_id", ente_id);
  const { data: imp, error } = await q;
  if (error) throw error;
  const map = {};
  for (const r of imp || []) {
    if (!r.voce_budget) continue;
    const m = r.movimenti;
    if (progetto && m?.progetto !== progetto) continue;
    if (anno && m?.anno !== anno) continue;
    const k = `${r.ente_id}|${r.voce_budget}|${m.progetto}|${m.anno}`;
    if (!map[k]) map[k] = {
      ente_id: r.ente_id, voce_codice: r.voce_budget,
      progetto: m.progetto, anno: m.anno, consuntivo: 0, n_imputazioni: 0
    };
    map[k].consuntivo += parseFloat(r.quota_importo || 0);
    map[k].n_imputazioni++;
  }
  return Object.values(map);
}

// Movimenti collegati a una specifica voce/ente/progetto/anno (per drill-down)
async function getMovimentiPerVoceEnte({ ente_id, voce_codice, progetto, anno }) {
  let q = sb.from("imputazioni")
    .select("quota_importo, voce_budget, note, movimenti!inner(*)")
    .eq("ente_id", ente_id)
    .eq("voce_budget", voce_codice);
  const { data, error } = await q;
  if (error) throw error;
  return (data || [])
    .filter(r => (!progetto || r.movimenti?.progetto === progetto) && (!anno || r.movimenti?.anno === anno))
    .map(r => ({ ...r.movimenti, quota_imputata: r.quota_importo, voce_codice: r.voce_budget, note_imp: r.note }));
}

// =====================================================================
// IMPUTAZIONI
// =====================================================================
async function getImputazioni(movimento_id) {
  const { data, error } = await sb.from("imputazioni").select("*, enti(*)").eq("movimento_id", movimento_id);
  if (error) throw error;
  return data || [];
}

async function salvaImputazioni(movimento_id, lista) {
  // Sostituisce tutte le imputazioni del movimento
  await sb.from("imputazioni").delete().eq("movimento_id", movimento_id);
  const valide = (lista || []).filter(i => i.ente_id && parseFloat(i.quota_importo) > 0);
  if (!valide.length) return [];
  const payload = valide.map(i => ({
    movimento_id,
    ente_id: i.ente_id,
    quota_importo: parseFloat(i.quota_importo),
    voce_budget: i.voce_budget || "",
    note: i.note || "",
  }));
  const { data, error } = await sb.from("imputazioni").insert(payload).select();
  if (error) throw error;
  return data;
}

// =====================================================================
// NOTE SPESE
// =====================================================================
async function getNoteSpese(filtri = {}) {
  let q = sb.from("note_spese").select("*").order("data", { ascending: false });
  if (filtri.stato) q = q.eq("stato", filtri.stato);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function salvaNotaSpese(nota) {
  if (nota.id) {
    const { data, error } = await sb.from("note_spese").update(nota).eq("id", nota.id).select().single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await sb.from("note_spese").insert(nota).select().single();
    if (error) throw error;
    return data;
  }
}

async function eliminaNotaSpese(id) {
  const { error } = await sb.from("note_spese").delete().eq("id", id);
  if (error) throw error;
}

async function trasformaNotaInMovimento(notaId) {
  const { data: nota, error } = await sb.from("note_spese").select("*").eq("id", notaId).single();
  if (error) throw error;
  const totale = parseFloat(nota.totale) || 0;
  const mov = await salvaMovimento({
    data: nota.data,
    descrizione: "Nota spese " + nota.persona + (nota.evento ? " — " + nota.evento : ""),
    fornitore_cliente: nota.persona,
    progetto: nota.progetto || "Generale",
    tipo: "USCITA",
    categoria: "U2",
    metodo: nota.metodo_pagamento === "Contanti" ? "CASSA" : "BPE",
    importo: totale,
    link_documento: nota.link_documento_drive || null,
    note: "Da nota spese: " + JSON.stringify(nota.voci),
  });
  await sb.from("note_spese").update({ stato: "In primanota", movimento_id: mov.id }).eq("id", notaId);
  return mov;
}

// =====================================================================
// ANOMALIE
// =====================================================================
async function getAnomalie(stato = "aperta") {
  const { data, error } = await sb.from("anomalie").select("*").eq("stato", stato).order("creato_il", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Vista calcolata: anomalie automatiche (mov "Attesa EC" > 30gg + EC libere > 30gg)
async function getAnomalieCalcolate() {
  const { data, error } = await sb.from("v_anomalie_calcolate").select("*").order("data_rif");
  if (error) {
    console.warn("Vista anomalie non disponibile:", error.message);
    return [];
  }
  return data || [];
}
async function salvaAnomalia(a) {
  const { data, error } = await sb.from("anomalie").insert(a).select().single();
  if (error) throw error;
  return data;
}
async function risolviAnomalia(id) {
  const { error } = await sb.from("anomalie").update({ stato: "risolta", risolta_il: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// =====================================================================
// DOCUMENTI DRIVE
// =====================================================================
async function getDocumentiDrive() {
  const { data, error } = await sb.from("documenti_drive").select("*, movimenti(progressivo, data, importo)").order("importato_il", { ascending: false });
  if (error) throw error;
  return data || [];
}
async function tracciaDocumentoDrive(d) {
  const { data, error } = await sb.from("documenti_drive").upsert(d, { onConflict: "drive_file_id" }).select().single();
  if (error) throw error;
  return data;
}
async function rimuoviTracciamentoDrive(drive_file_id) {
  const { error } = await sb.from("documenti_drive").delete().eq("drive_file_id", drive_file_id);
  if (error) throw error;
}

// =====================================================================
// BACKUP
// =====================================================================
async function esportaBackup() {
  const tabs = ["enti","movimenti","ec_bancario","imputazioni","note_spese","anomalie","documenti_drive"];
  const out = { esportato_il: new Date().toISOString() };
  for (const t of tabs) {
    const { data } = await sb.from(t).select("*");
    out[t] = data || [];
  }
  return out;
}

// =====================================================================
// COSTANTI UI
// =====================================================================
const CATEGORIE = {
  U1: "Acquisti materiali (Amazon, cancelleria, alimentari, buoni carburante, buoni pasto)",
  U2: "Servizi (consulenze, telefonia, viaggi, traghetti, DHL, cooperative)",
  U3: "Locazioni e godimento beni (affitti sede, licenze software)",
  U4: "Personale (buste paga, tredicesime, TFR, anticipi)",
  U5: "Imposte, bolli, commissioni bancarie, fidejussioni, PagoPA",
  U6: "Interessi passivi su prestiti",
  U7: "Artisti e collaboratori (cachets, parcelle, NP collaboratori occasionali)",
  U10: "Rimborso quota capitale prestiti",
  E1: "Quote associative e prestiti soci infruttiferi",
  E7: "Fatture emesse a terzi",
  E8: "Contributi da enti pubblici",
  E9: "Entrate da contratti con enti pubblici",
  E10: "Finanziamenti ricevuti (Invitalia, Fondazione, anticipi)",
  E11: "Altre entrate (biglietteria, incassi vari)",
};
const CATEGORIE_USCITA  = ["U1","U2","U3","U4","U5","U6","U7","U10"];
const CATEGORIE_ENTRATA = ["E1","E7","E8","E9","E10","E11"];
const PROGETTI = ["Generale","SSF EDU","SSF Estivo","Silent Tales","Itinerari EDU VE"];
const METODI   = ["BPE","NEXI","CASSA"];

// =====================================================================
// HELPERS FORMATO
// =====================================================================
function fmtImporto(n) {
  if (n == null || n === "") return "";
  return Number(n).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}
function fmtData(iso) {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

// =====================================================================
// ALLEGATI MOVIMENTO
// =====================================================================
const BUCKET_ALLEGATI = "allegati";

async function getAllegatiMovimento(movimentoId) {
  const { data, error } = await sb.from("allegati_movimento")
    .select("*")
    .eq("movimento_id", movimentoId)
    .order("ordine", { ascending: true })
    .order("creato_il", { ascending: true });
  if (error) throw error;
  return data || [];
}

// Upload file → Storage, poi salva riga in allegati_movimento
async function uploadAllegato(movimentoId, file, tipo = "altro") {
  const ext = file.name.split(".").pop().toLowerCase();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${movimentoId}/${Date.now()}_${safeName}`;

  const { error: upErr } = await sb.storage.from(BUCKET_ALLEGATI).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (upErr) throw upErr;

  // Genera signed URL valida 10 anni (per link permanente pratico)
  const { data: signed, error: signErr } = await sb.storage.from(BUCKET_ALLEGATI)
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
  if (signErr) throw signErr;

  const { data, error } = await sb.from("allegati_movimento").insert([{
    movimento_id: movimentoId,
    storage_path: path,
    storage_url: signed.signedUrl,
    nome: file.name,
    tipo,
    mime_type: file.type || null,
    dimensione: file.size || null,
  }]).select().single();
  if (error) throw error;
  return data;
}

// Allega link Drive (no upload fisico)
async function allegaDriveAllegato(movimentoId, driveFileId, link, nome, tipo = "altro") {
  const { data, error } = await sb.from("allegati_movimento").insert([{
    movimento_id: movimentoId,
    drive_file_id: driveFileId || null,
    link,
    nome,
    tipo,
  }]).select().single();
  if (error) throw error;
  return data;
}

// Elimina allegato + file Storage (se presente)
async function eliminaAllegato(allegatoId) {
  const { data: all } = await sb.from("allegati_movimento").select("storage_path").eq("id", allegatoId).single();
  if (all?.storage_path) {
    await sb.storage.from(BUCKET_ALLEGATI).remove([all.storage_path]);
  }
  const { error } = await sb.from("allegati_movimento").delete().eq("id", allegatoId);
  if (error) throw error;
}

// Aggiorna tipo / ordine / nome
async function aggiornaAllegato(allegatoId, patch) {
  const { error } = await sb.from("allegati_movimento").update(patch).eq("id", allegatoId);
  if (error) throw error;
}

// Salva PDF unito già generato (Uint8Array) su Storage e registra allegato
async function salvaPdfUnito(movimentoId, pdfBytes, nomeFile = "documento_unito.pdf") {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const file = new File([blob], nomeFile, { type: "application/pdf" });

  // Rimuovi eventuale pdf_unito precedente per questo movimento
  const { data: vecchi } = await sb.from("allegati_movimento")
    .select("id, storage_path")
    .eq("movimento_id", movimentoId)
    .eq("tipo", "pdf_unito");
  for (const v of vecchi || []) {
    if (v.storage_path) await sb.storage.from(BUCKET_ALLEGATI).remove([v.storage_path]);
    await sb.from("allegati_movimento").delete().eq("id", v.id);
  }

  const allegato = await uploadAllegato(movimentoId, file, "pdf_unito");

  // Aggiorna anche link_pdf_unito sul movimento per retro-compatibilità
  await sb.from("movimenti").update({ link_pdf_unito: allegato.storage_url }).eq("id", movimentoId);

  return allegato;
}

// Genera signed URL fresca per un allegato (le signed URL scadono)
async function getSignedUrlAllegato(storagePath) {
  const { data, error } = await sb.storage.from(BUCKET_ALLEGATI)
    .createSignedUrl(storagePath, 60 * 60); // 1 ora
  if (error) throw error;
  return data.signedUrl;
}

// =====================================================================
// EXPORT GLOBALE
// =====================================================================
window.SB = {
  // auth
  login, logout, currentUser,
  // movimenti
  getMovimenti, getMovimento, salvaMovimento, eliminaMovimento, cercaDoppioni, generaProgressivo,
  ricalcolaProgressivi, cercaMatchPerDocumento, allegaDocumentoAMovimento,
  allegaDocumentoAMovimenti, cercaMovimentiLiberi,
  unisciMovimenti, scollegaDocumento,
  // sotto-movimenti
  getFigliMovimento, creaFiglioMovimento, promuoviFiglioAPrimario,
  convertePadreARiferimento, ripristinaPadreNormale,
  // allegati movimento
  getAllegatiMovimento, uploadAllegato, allegaDriveAllegato,
  eliminaAllegato, aggiornaAllegato, salvaPdfUnito, getSignedUrlAllegato,
  // documenti in coda
  salvaDocumentoDaTriagre, getDocumentiInCoda, aggiornaStatoDocumento,
  // helper match (esposti per UI)
  calcolaScoreMatch, similaritaFornitore,
  // ec
  getEC, importaEC, abbinaEC, disabbinaEC, creaBozzeDaECLibere,
  // enti
  getEnti, salvaEnte, speseImputatePerEnte,
  // progetti
  getProgetti, salvaProgetto, eliminaProgetto,
  // imputazioni
  getImputazioni, salvaImputazioni,
  // voci budget + preventivi + consuntivo
  getVociBudget, salvaVoceBudget, eliminaVoceBudget,
  getBudgetEnteVoce, setPreventivo,
  getConsuntivoEnteVoce, getMovimentiPerVoceEnte,
  // note spese
  getNoteSpese, salvaNotaSpese, trasformaNotaInMovimento, eliminaNotaSpese,
  // anomalie
  getAnomalie, salvaAnomalia, risolviAnomalia, getAnomalieCalcolate,
  // drive
  getDocumentiDrive, tracciaDocumentoDrive, rimuoviTracciamentoDrive,
  // backup
  esportaBackup,
};
window.UI = { CATEGORIE, CATEGORIE_USCITA, CATEGORIE_ENTRATA, PROGETTI, METODI,
              fmtImporto, fmtData, todayISO, escapeHtml };
