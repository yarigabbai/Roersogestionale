#!/usr/bin/env node
// =====================================================================
// db.mjs — helper CLI per operare su Supabase da locale
// Legge credenziali da .env.local (gitignored). Nessun segreto nel codice.
// =====================================================================
// USO:
//   node tools/db.mjs select <tabella> [--filter col=val] [--cols a,b] [--limit N] [--order col] [--desc]
//   node tools/db.mjs insert <tabella> '<json|json[]>'
//   node tools/db.mjs update <tabella> --filter col=val '<json patch>'
//   node tools/db.mjs delete <tabella> --filter col=val
//   node tools/db.mjs sql "<query SQL raw>"     (richiede funzione exec_sql nel DB)
//   node tools/db.mjs count <tabella> [--filter col=val]
// =====================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// --- carica .env.local ---
function loadEnv() {
  const env = {};
  for (const p of [join(ROOT, ".env.local"), join(ROOT, ".env")]) {
    try {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) env[m[1]] = m[2].trim();
      }
    } catch {}
  }
  return env;
}
const ENV = loadEnv();
const URL = ENV.SUPABASE_URL;
const KEY = ENV.SUPABASE_SERVICE_ROLE;
if (!URL || !KEY) { console.error("Manca SUPABASE_URL o SUPABASE_SERVICE_ROLE in .env.local"); process.exit(1); }

const REST = `${URL}/rest/v1`;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// --- parse argv ---
const [, , cmd, ...rest] = process.argv;
function parseArgs(arr) {
  const out = { _: [], filter: {}, cols: "*", limit: null, order: null, desc: false };
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    if (a === "--filter") { const [c, v] = arr[++i].split("="); out.filter[c] = v; }
    else if (a === "--cols") out.cols = arr[++i];
    else if (a === "--limit") out.limit = arr[++i];
    else if (a === "--order") out.order = arr[++i];
    else if (a === "--desc") out.desc = true;
    else out._.push(a);
  }
  return out;
}

function filterToQuery(filter) {
  return Object.entries(filter).map(([k, v]) => {
    if (v === "null") return `${k}=is.null`;
    return `${k}=eq.${encodeURIComponent(v)}`;
  }).join("&");
}

async function main() {
  if (cmd === "select" || cmd === "count") {
    const a = parseArgs(rest);
    const table = a._[0];
    let q = `select=${cmd === "count" ? "count" : a.cols}`;
    if (Object.keys(a.filter).length) q += "&" + filterToQuery(a.filter);
    if (a.order) q += `&order=${a.order}.${a.desc ? "desc" : "asc"}`;
    if (a.limit) q += `&limit=${a.limit}`;
    const headers = cmd === "count" ? { ...H, Prefer: "count=exact" } : H;
    const r = await fetch(`${REST}/${table}?${q}`, { headers });
    const data = await r.json();
    console.log(JSON.stringify(data, null, 2));
  }
  else if (cmd === "insert") {
    const a = parseArgs(rest);
    const table = a._[0];
    const body = a._[1];
    const r = await fetch(`${REST}/${table}`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body });
    console.log(r.status, JSON.stringify(await r.json(), null, 2));
  }
  else if (cmd === "update") {
    const a = parseArgs(rest);
    const table = a._[0];
    const body = a._[1];
    if (!Object.keys(a.filter).length) { console.error("update richiede --filter"); process.exit(1); }
    const r = await fetch(`${REST}/${table}?${filterToQuery(a.filter)}`, { method: "PATCH", headers: { ...H, Prefer: "return=representation" }, body });
    console.log(r.status, JSON.stringify(await r.json(), null, 2));
  }
  else if (cmd === "delete") {
    const a = parseArgs(rest);
    const table = a._[0];
    if (!Object.keys(a.filter).length) { console.error("delete richiede --filter (per sicurezza)"); process.exit(1); }
    const r = await fetch(`${REST}/${table}?${filterToQuery(a.filter)}`, { method: "DELETE", headers: { ...H, Prefer: "return=representation" } });
    console.log(r.status, JSON.stringify(await r.json(), null, 2));
  }
  else if (cmd === "sql") {
    const query = rest.join(" ");
    const r = await fetch(`${REST}/rpc/exec_sql`, { method: "POST", headers: H, body: JSON.stringify({ query }) });
    const data = await r.json();
    if (r.status >= 400) { console.error("ERRORE:", JSON.stringify(data)); console.error("(serve la funzione exec_sql — vedi supabase_exec_sql.sql)"); process.exit(1); }
    console.log(JSON.stringify(data, null, 2));
  }
  else {
    console.log("Comandi: select | count | insert | update | delete | sql");
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
