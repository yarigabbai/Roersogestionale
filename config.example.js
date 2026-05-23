// =====================================================================
// CONFIGURAZIONE — copia questo file in `config.js` e compila i valori.
// `config.js` è ignorato da git (vedi .gitignore) per non esporre chiavi.
// =====================================================================

const CONFIG = {
  // Supabase — https://supabase.com → Project Settings → API
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGc...",

  // Anthropic — https://console.anthropic.com → API Keys
  // ⚠️ Esposta nel browser. Per uso interno e con limiti di spesa.
  ANTHROPIC_API_KEY: "sk-ant-api03-...",
  ANTHROPIC_MODEL: "claude-haiku-4-5-20251001",

  // Google — https://console.cloud.google.com → API & Servizi
  // Crea Client OAuth tipo "Applicazione web" con origin localhost + dominio prod
  GOOGLE_CLIENT_ID: "xxxxxxxxxxxxxxxx.apps.googleusercontent.com",
  GOOGLE_API_KEY: "AIza...",

  // Form note spese: PIN semplice (4 cifre) per accesso senza login
  NOTE_SPESE_PIN: "1234",
};

window.CONFIG = CONFIG;
