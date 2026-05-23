// =====================================================================
// drive.js — Google Drive API (lettura cartelle, link file)
// Auth: OAuth 2.0 implicit grant via Google Identity Services
// =====================================================================

let GOOGLE_TOKEN = null;
let GOOGLE_TOKEN_EXPIRE = 0;

function isAuthed() {
  return GOOGLE_TOKEN && Date.now() < GOOGLE_TOKEN_EXPIRE;
}

// Carica Google Identity Services (lazy)
function loadGSI() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Impossibile caricare Google Identity Services"));
    document.head.appendChild(s);
  });
}

async function authDrive() {
  const cfg = window.CONFIG;
  if (!cfg.GOOGLE_CLIENT_ID) throw new Error("GOOGLE_CLIENT_ID mancante in config.js");
  await loadGSI();
  return new Promise((resolve, reject) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        GOOGLE_TOKEN = resp.access_token;
        GOOGLE_TOKEN_EXPIRE = Date.now() + (resp.expires_in - 60) * 1000;
        resolve(resp.access_token);
      },
    });
    tc.requestAccessToken({ prompt: "" });
  });
}

async function ensureAuth() {
  if (!isAuthed()) await authDrive();
  return GOOGLE_TOKEN;
}

// Estrai ID cartella da URL Drive o accetta ID puro
function estraiDriveId(input) {
  if (!input) return "";
  const s = String(input).trim();
  const m = s.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  return s;
}

// Lista tutti i PDF in una cartella (ricorsivo opzionale)
async function listaPdfCartella(folderId, opts = {}) {
  const token = await ensureAuth();
  const all = [];
  await scansionaRicorsivo(folderId, token, opts.maxDepth || 8, opts.path || "", all, opts.skipFolders || []);
  all.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)));
  return all;
}

async function scansionaRicorsivo(folderId, token, maxDepth, breadcrumb, out, skipFolders) {
  if (maxDepth < 0) return;
  // PDF nella cartella
  const filesUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`
  )}&fields=files(id,name,mimeType,webViewLink,createdTime,size,parents)&pageSize=200`;
  const r1 = await fetch(filesUrl, { headers: { Authorization: "Bearer " + token } });
  if (!r1.ok) {
    const err = await r1.text();
    throw new Error("Drive API: " + r1.status + " " + err.substring(0, 200));
  }
  const j1 = await r1.json();
  for (const f of j1.files || []) {
    out.push({ ...f, folder_path: breadcrumb });
  }
  // Sottocartelle
  if (maxDepth > 0) {
    const subUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)&pageSize=200`;
    const r2 = await fetch(subUrl, { headers: { Authorization: "Bearer " + token } });
    const j2 = await r2.json();
    for (const sub of j2.files || []) {
      if (skipFolders.some(s => sub.name.toLowerCase().includes(s.toLowerCase()))) continue;
      await scansionaRicorsivo(sub.id, token, maxDepth - 1, breadcrumb + " / " + sub.name, out, skipFolders);
    }
  }
}

// Scarica un PDF da Drive come Blob/File
async function scaricaFile(fileId, fileName = "file.pdf") {
  const token = await ensureAuth();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!r.ok) throw new Error("Download Drive: " + r.status);
  const blob = await r.blob();
  return new File([blob], fileName, { type: "application/pdf" });
}

// Costruisce URL pubblico "view" di un file Drive
function urlVisualizza(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

window.DRIVE = {
  authDrive, isAuthed, estraiDriveId,
  listaPdfCartella, scaricaFile, urlVisualizza,
};
