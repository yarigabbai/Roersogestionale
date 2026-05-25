// =====================================================================
// CONFIGURAZIONE LOCALE — NON committare su git
// Vedi config.example.js per la struttura di base
// =====================================================================

const CONFIG = {
  // Supabase
  SUPABASE_URL: "https://jcnsocxdpwkrloeegrug.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjbnNvY3hkcHdrcmxvZWVncnVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzQ4MjEsImV4cCI6MjA5NDUxMDgyMX0.73L3LrMj6jo8O5STxj5z4Fj02-CmHlu6MNZ2uaLR5qA",

  // Anthropic — ⚠️ esposta in browser, gestire con limiti di spesa
  ANTHROPIC_API_KEY: "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",
  ANTHROPIC_MODEL: "claude-haiku-4-5-20251001",

  // Google Drive — da configurare in fase 2
  GOOGLE_CLIENT_ID: "178801987497-k9d1hk66222c44fraidubot7s49mtnrm.apps.googleusercontent.com",
  GOOGLE_API_KEY: "AIzaSyA92dMzAVfZRg0n1yj2ppiZJaXiUuYv-PY",

  // PIN form note spese
  NOTE_SPESE_PIN: "1234",
};

window.CONFIG = CONFIG;
