// =====================================================================
// xml.js — Parser fatture elettroniche SDI (XML standard Agenzia Entrate)
// Supporta: file XML singolo, XML con N body (lotto), ZIP con N file XML
// =====================================================================

// Carica JSZip on-demand
let _jszipLoaded = false;
async function loadJSZip() {
  if (_jszipLoaded) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => { _jszipLoaded = true; resolve(); };
    s.onerror = () => reject(new Error("Impossibile caricare JSZip"));
    document.head.appendChild(s);
  });
}

// Helper: trova il primo nodo con un certo tag (ignora namespace)
function findTag(node, tagName) {
  if (!node) return null;
  const tn = tagName.toLowerCase();
  for (const child of node.children) {
    if (child.localName.toLowerCase() === tn || child.nodeName.toLowerCase().endsWith(":" + tn) || child.nodeName.toLowerCase() === tn) {
      return child;
    }
  }
  return null;
}

function findText(node, tagName) {
  const n = findTag(node, tagName);
  return n ? n.textContent.trim() : null;
}

// Naviga path tipo "FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/Anagrafica/Denominazione"
function findPath(node, path) {
  let n = node;
  for (const tag of path.split("/")) {
    n = findTag(n, tag);
    if (!n) return null;
  }
  return n.textContent.trim();
}

// Estrae i dati da un elemento <FatturaElettronica> (root) o <FatturaElettronicaBody> (sub)
function estraiDatiFattura(bodyNode, headerNode) {
  if (!bodyNode) return null;

  const generali = findTag(findTag(bodyNode, "DatiGenerali"), "DatiGeneraliDocumento");

  const tipoDocumento  = findText(generali, "TipoDocumento");          // TD01, TD04 (NC), TD17, ecc.
  const dataDocumento  = findText(generali, "Data");                    // YYYY-MM-DD
  const numeroDocumento= findText(generali, "Numero");
  const importoTotale  = parseFloat(findText(generali, "ImportoTotaleDocumento") || "0");
  const causale        = findText(generali, "Causale");

  // Cedente (chi emette la fattura)
  const cedente = findTag(headerNode, "CedentePrestatore");
  const cedenteAnagrafica = findTag(findTag(cedente, "DatiAnagrafici"), "Anagrafica");
  const cedenteDenom  = findText(cedenteAnagrafica, "Denominazione")
    || [findText(cedenteAnagrafica, "Nome"), findText(cedenteAnagrafica, "Cognome")].filter(Boolean).join(" ");
  const cedentePIVA   = findPath(headerNode, "CedentePrestatore/DatiAnagrafici/IdFiscaleIVA/IdCodice");

  // Cessionario (a chi è destinata la fattura)
  const cessionario = findTag(headerNode, "CessionarioCommittente");
  const cessAnagrafica = findTag(findTag(cessionario, "DatiAnagrafici"), "Anagrafica");
  const cessDenom = findText(cessAnagrafica, "Denominazione")
    || [findText(cessAnagrafica, "Nome"), findText(cessAnagrafica, "Cognome")].filter(Boolean).join(" ");

  // Determina se è una fattura RICEVUTA (cessionario = Roerso) o EMESSA (cedente = Roerso)
  // Convenzione: per ora la decidiamo in base al nome contenente "ROERSO" o "Roerso"
  const isFatturaEmessa = (cedenteDenom || "").toUpperCase().includes("ROERSO");

  // IVA / Imponibile
  const riepilogo = findTag(bodyNode, "DatiRiepilogo");
  const imponibile = riepilogo ? parseFloat(findText(riepilogo, "ImponibileImporto") || "0") : 0;
  const iva        = riepilogo ? parseFloat(findText(riepilogo, "Imposta") || "0") : 0;

  // Linee descrittive (prendiamo solo la prima per descrizione veloce)
  const dettaglio = findTag(bodyNode, "DatiBeniServizi");
  const primaLinea = dettaglio ? findTag(dettaglio, "DettaglioLinee") : null;
  const descrizione = primaLinea ? findText(primaLinea, "Descrizione") : (causale || "");

  return {
    tipo_documento: tipoDocumento,
    data_documento: dataDocumento,
    numero_documento: numeroDocumento,
    importo: Math.abs(importoTotale),
    imponibile,
    iva,
    descrizione: (descrizione || "").substring(0, 200),
    causale,
    fornitore_cliente: isFatturaEmessa ? cessDenom : cedenteDenom,
    cedente_denominazione: cedenteDenom,
    cedente_piva: cedentePIVA,
    cessionario_denominazione: cessDenom,
    tipo: isFatturaEmessa ? "ENTRATA" : "USCITA",
    metodo: null, // mai dedurre da fattura
  };
}

// Parse un singolo XML stringa → array di fatture (1 o N)
function parseXmlFattura(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");
  const errNode = doc.querySelector("parsererror");
  if (errNode) throw new Error("XML non valido: " + errNode.textContent.substring(0, 100));

  const root = doc.documentElement;
  // Cerca FatturaElettronicaHeader e tutti i FatturaElettronicaBody
  const header = findTag(root, "FatturaElettronicaHeader");
  if (!header) throw new Error("Non è una fattura elettronica SDI valida (manca FatturaElettronicaHeader)");

  // Bodies possono essere 1 o N (lotto)
  const bodies = [...root.children].filter(c => c.localName === "FatturaElettronicaBody" || c.nodeName.toLowerCase().endsWith(":fatturaelettronicabody"));
  if (!bodies.length) throw new Error("Nessun FatturaElettronicaBody trovato");

  return bodies.map(b => estraiDatiFattura(b, header)).filter(Boolean);
}

// Parser principale: accetta File (XML o ZIP) e ritorna array di fatture
async function parseFileFatturaXML(file) {
  const nome = file.name.toLowerCase();
  if (nome.endsWith(".xml")) {
    const text = await file.text();
    return parseXmlFattura(text).map(f => ({ ...f, nome_file_origine: file.name }));
  }
  if (nome.endsWith(".zip") || nome.endsWith(".p7m")) {
    if (nome.endsWith(".p7m")) {
      throw new Error(".p7m non supportato direttamente — vai sul cassetto Agenzia Entrate ed estrai gli .xml, oppure rinomina il file rimuovendo .p7m");
    }
    await loadJSZip();
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const out = [];
    const entries = Object.values(zip.files).filter(e => !e.dir && /\.xml$/i.test(e.name));
    if (!entries.length) throw new Error("ZIP non contiene file XML");
    for (const entry of entries) {
      try {
        const text = await entry.async("text");
        const fatture = parseXmlFattura(text);
        for (const f of fatture) out.push({ ...f, nome_file_origine: entry.name });
      } catch (e) {
        console.warn(`Errore parsing ${entry.name}: ${e.message}`);
      }
    }
    return out;
  }
  throw new Error("Formato non supportato — usa .xml o .zip");
}

window.XML_PARSER = { parseFileFatturaXML, parseXmlFattura };
