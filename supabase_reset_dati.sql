-- =====================================================================
-- RESET DATI DI PROVA — soft reset
-- =====================================================================
-- USO: SQL Editor → Role: postgres → incolla → Run
--
-- Cancella TUTTI i dati operativi (movimenti, EC, imputazioni, ecc.)
-- ma MANTIENE:
--   - schema (tabelle, trigger, viste, funzioni)
--   - utenti auth.users (resti loggato)
--   - enti (RAS, FDS, STG, Aglientu, ecc.)
--   - voci_budget (template SSF/Generale)
--
-- Differenza con supabase_schema.sql:
--   - questo: solo svuota i dati, veloce, non perde configurazione
--   - quello: ricrea TUTTO da zero (drop + create), usato per cambi schema
-- =====================================================================

BEGIN;

TRUNCATE
  imputazioni,
  ec_bancario,
  movimenti,
  anomalie,
  documenti_drive,
  note_spese,
  budget_ente_voce
RESTART IDENTITY CASCADE;

COMMIT;

-- Verifica: tutti i conteggi sotto devono essere 0,
-- tranne enti (9) e voci_budget (79).
SELECT 'movimenti'         AS tabella, COUNT(*) AS n FROM movimenti
UNION ALL SELECT 'ec_bancario',          COUNT(*) FROM ec_bancario
UNION ALL SELECT 'imputazioni',          COUNT(*) FROM imputazioni
UNION ALL SELECT 'note_spese',           COUNT(*) FROM note_spese
UNION ALL SELECT 'anomalie',             COUNT(*) FROM anomalie
UNION ALL SELECT 'documenti_drive',      COUNT(*) FROM documenti_drive
UNION ALL SELECT 'budget_ente_voce',     COUNT(*) FROM budget_ente_voce
UNION ALL SELECT 'enti (PRESERVATO)',    COUNT(*) FROM enti
UNION ALL SELECT 'voci_budget (PRESERVATO)', COUNT(*) FROM voci_budget;
