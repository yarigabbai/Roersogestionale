#!/usr/bin/env node
// Audit completo stato 2026
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
    .map(m => [m[1], m[2].trim()])
);
const URL = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function get(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H });
  return r.json();
}

const movs = await get("movimenti?anno=eq.2026&select=id,data,importo,tipo,metodo,stato,link_documento,fornitore_cliente,categoria,progetto");
const ecs  = await get("ec_bancario?anno=eq.2026&select=id,data_valuta,importo,conto,stato,movimento_id");
const docs = await get("documenti_drive?select=drive_file_id,stato,movimento_id");

console.log(`\n========== AUDIT 2026 ==========`);
console.log(`Movimenti: ${movs.length}  |  EC: ${ecs.length}  |  Documenti tracciati: ${docs.length}\n`);

console.log("--- MOVIMENTI per STATO ---");
const byStato = {};
movs.forEach(m => { byStato[m.stato] = (byStato[m.stato] || 0) + 1; });
Object.entries(byStato).sort((a,b)=>b[1]-a[1]).forEach(([s,n]) => console.log(`  ${s.padEnd(20)} ${n}`));

console.log("\n--- MOVIMENTI per METODO ---");
const byMet = {};
movs.forEach(m => { byMet[m.metodo || "(null)"] = (byMet[m.metodo || "(null)"] || 0) + 1; });
Object.entries(byMet).sort((a,b)=>b[1]-a[1]).forEach(([s,n]) => console.log(`  ${s.padEnd(15)} ${n}`));

console.log("\n--- MOVIMENTI per MESE ---");
const byMese = {};
movs.forEach(m => {
  const k = m.data.substring(0,7);
  byMese[k] = (byMese[k] || 0) + 1;
});
Object.entries(byMese).sort().forEach(([s,n]) => console.log(`  ${s}  ${n}`));

console.log("\n--- EC per MESE/CONTO ---");
const byEC = {};
ecs.forEach(e => {
  const k = `${(e.data_valuta||"?").substring(0,7)}/${e.conto||"?"}`;
  byEC[k] = (byEC[k] || 0) + 1;
});
Object.entries(byEC).sort().forEach(([s,n]) => console.log(`  ${s.padEnd(15)} ${n}`));

console.log("\n--- DOCUMENTI per STATO ---");
const byDoc = {};
docs.forEach(d => { byDoc[d.stato || "(null)"] = (byDoc[d.stato || "(null)"] || 0) + 1; });
Object.entries(byDoc).sort((a,b)=>b[1]-a[1]).forEach(([s,n]) => console.log(`  ${s.padEnd(20)} ${n}`));

console.log("\n--- MOVIMENTI SENZA LINK DOC (problematici) ---");
const senzaLink = movs.filter(m => !m.link_documento);
console.log(`  ${senzaLink.length} movimenti senza link documento`);
const senzaLinkPerStato = {};
senzaLink.forEach(m => { senzaLinkPerStato[m.stato] = (senzaLinkPerStato[m.stato] || 0) + 1; });
Object.entries(senzaLinkPerStato).forEach(([s,n]) => console.log(`    di cui stato='${s}': ${n}`));

console.log("\n--- EC NON ABBINATI ---");
const ecLibere = ecs.filter(e => !e.movimento_id);
console.log(`  ${ecLibere.length} righe EC senza movimento collegato`);

console.log("\n--- TOP 10 FORNITORI USCITE 2026 ---");
const byForn = {};
movs.filter(m => m.tipo === "USCITA" && m.fornitore_cliente).forEach(m => {
  byForn[m.fornitore_cliente] = (byForn[m.fornitore_cliente] || 0) + +m.importo;
});
Object.entries(byForn).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([f,t]) => console.log(`  €${t.toFixed(2).padStart(10)}  ${f}`));

console.log("\n--- TOTALI ---");
const totE = movs.filter(m=>m.tipo==="ENTRATA").reduce((s,m)=>s+ +m.importo,0);
const totU = movs.filter(m=>m.tipo==="USCITA").reduce((s,m)=>s+ +m.importo,0);
console.log(`  ENTRATE: €${totE.toFixed(2)}`);
console.log(`  USCITE:  €${totU.toFixed(2)}`);
console.log(`  SALDO:   €${(totE-totU).toFixed(2)}`);
