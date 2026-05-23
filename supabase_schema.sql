-- =====================================================================
-- Roerso Mondo ETS — Schema Supabase definitivo
-- =====================================================================
-- USO:
--   1) Apri il progetto Supabase
--   2) SQL Editor → New query
--   3) Cambia Role: postgres (in alto destra)
--   4) Incolla TUTTO questo file → Run
--
-- ATTENZIONE: questo script DROPPA e ricrea tutto. Lo schema, i dati,
-- i trigger, le funzioni, le viste. Usalo se vuoi ripartire da zero.
-- I dati esistenti vengono CANCELLATI (ma utenti auth.users restano).
--
-- Per applicarlo conservando i dati: NON USARE. Usa i file migration
-- v2/v3/v4 separati.
-- =====================================================================

-- =====================================================================
-- DROP TUTTO (in ordine inverso di dipendenza)
-- =====================================================================
DROP VIEW IF EXISTS v_anomalie_calcolate CASCADE;
DROP VIEW IF EXISTS v_consuntivo_ente_voce CASCADE;
DROP VIEW IF EXISTS v_movimenti_ordinati CASCADE;

DROP TRIGGER IF EXISTS trg_stato_movimento ON movimenti;
DROP TRIGGER IF EXISTS trg_ricalcola_progressivi ON movimenti;
DROP TRIGGER IF EXISTS trg_bev_modified ON budget_ente_voce;

DROP FUNCTION IF EXISTS aggiorna_stato_movimento() CASCADE;
DROP FUNCTION IF EXISTS trigger_ricalcola_progressivi() CASCADE;
DROP FUNCTION IF EXISTS ricalcola_progressivi(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS genera_progressivo(TEXT, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS update_bev_modified() CASCADE;

DROP TABLE IF EXISTS imputazioni CASCADE;
DROP TABLE IF EXISTS budget_ente_voce CASCADE;
DROP TABLE IF EXISTS voci_budget CASCADE;
DROP TABLE IF EXISTS anomalie CASCADE;
DROP TABLE IF EXISTS documenti_drive CASCADE;
DROP TABLE IF EXISTS note_spese CASCADE;
DROP TABLE IF EXISTS ec_bancario CASCADE;
DROP TABLE IF EXISTS movimenti CASCADE;
DROP TABLE IF EXISTS enti CASCADE;
DROP TABLE IF EXISTS progetti CASCADE;

-- =====================================================================
-- TABELLE
-- =====================================================================

-- Progetti dell'associazione (es. SSF Estivo, SSF EDU, Silent Tales)
CREATE TABLE progetti (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  descrizione TEXT,
  attivo BOOLEAN DEFAULT TRUE,
  ordine INTEGER DEFAULT 0,
  creato_il TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_progetti_attivo ON progetti(attivo);

-- Enti finanziatori / progetti rendicontati
CREATE TABLE enti (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  nome_completo TEXT,
  anno INTEGER,
  importo_assegnato NUMERIC(12,2) DEFAULT 0,
  scadenza_rendicontazione DATE,
  attivo BOOLEAN DEFAULT TRUE,
  creato_il TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_enti_anno ON enti(anno);
CREATE INDEX idx_enti_attivo ON enti(attivo);

-- Estratti conto bancario (BPE/NEXI)
CREATE TABLE ec_bancario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_valuta DATE,
  data_esecuzione DATE,
  descrizione_banca TEXT NOT NULL,
  beneficiario TEXT,
  tipo_operazione TEXT,
  importo NUMERIC(12,2) NOT NULL,
  conto TEXT DEFAULT 'BPE',
  anno INTEGER,
  mese INTEGER,
  stato_bpe TEXT,
  movimento_id UUID,
  stato TEXT DEFAULT 'Da abbinare',
  importato_il TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ec_anno ON ec_bancario(anno);
CREATE INDEX idx_ec_mese ON ec_bancario(mese);
CREATE INDEX idx_ec_stato ON ec_bancario(stato);
CREATE INDEX idx_ec_conto ON ec_bancario(conto);
CREATE INDEX idx_ec_movimento ON ec_bancario(movimento_id);

-- Movimenti (prima nota)
CREATE TABLE movimenti (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificazione
  progressivo TEXT,                    -- VISUALIZZATO. Popolato dal trigger: override (se valorizzato) o numero auto
  progressivo_override TEXT,           -- forzatura manuale (es. "3b", "12-bis"). Se popolato, sostituisce l'auto
  escludi_progr BOOLEAN DEFAULT FALSE, -- TRUE = la riga è IGNORATA dal counter (nessun numero)
  numero_documento TEXT,               -- riferimento esterno: "FPR 33/2026", "BP marzo", "F24"
  -- Date
  data DATE NOT NULL,               -- data effettiva del flusso bancario/cassa
  data_documento DATE,              -- data emissione fattura/ricevuta
  -- Anagrafica
  descrizione TEXT NOT NULL,
  fornitore_cliente TEXT,
  progetto TEXT,                    -- SSF EDU | SSF Estivo | Silent Tales | Generale | Itinerari EDU VE
  tipo TEXT NOT NULL,               -- ENTRATA | USCITA
  categoria TEXT,                   -- U1..U10, E1..E11
  metodo TEXT,                      -- BPE | NEXI | CASSA
  importo NUMERIC(12,2) NOT NULL,
  anno INTEGER NOT NULL,
  -- Split per metodo (formato Michele)
  cassa_entrata NUMERIC(12,2),
  cassa_uscita  NUMERIC(12,2),
  bpe_entrata   NUMERIC(12,2),
  bpe_uscita    NUMERIC(12,2),
  nexi_entrata  NUMERIC(12,2),
  nexi_uscita   NUMERIC(12,2),
  -- Documenti
  nome_file_grezzo TEXT,
  nome_file_accoppiato TEXT,
  link_documento TEXT,
  link_file_accoppiato TEXT,
  link_pdf_unito TEXT,
  drive_file_id TEXT,           -- NOT unique: 1 documento può essere allegato a N movimenti
  -- Abbinamento EC
  ec_id UUID REFERENCES ec_bancario(id) ON DELETE SET NULL,
  rif_distinta TEXT,
  -- Stato
  stato TEXT DEFAULT 'In lavorazione',
  senza_documento BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE per commissioni/bolli
  ordine_manuale INTEGER,           -- override ordinamento (opzionale)
  -- Meta
  note TEXT,
  creato_da UUID,
  creato_il TIMESTAMPTZ DEFAULT NOW(),
  modificato_il TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_mov_anno ON movimenti(anno);
CREATE INDEX idx_mov_data ON movimenti(data);
CREATE INDEX idx_mov_tipo ON movimenti(tipo);
CREATE INDEX idx_mov_categoria ON movimenti(categoria);
CREATE INDEX idx_mov_progetto ON movimenti(progetto);
CREATE INDEX idx_mov_stato ON movimenti(stato);
CREATE INDEX idx_mov_metodo ON movimenti(metodo);
CREATE INDEX idx_mov_drive ON movimenti(drive_file_id);
CREATE INDEX idx_mov_ordine_manuale ON movimenti(ordine_manuale);

-- FK ec_bancario.movimento_id → movimenti.id (chiusura ciclica)
ALTER TABLE ec_bancario
  ADD CONSTRAINT fk_ec_movimento
  FOREIGN KEY (movimento_id) REFERENCES movimenti(id) ON DELETE SET NULL;

-- Imputazioni (movimento → quote per ente con voce budget)
CREATE TABLE imputazioni (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movimento_id UUID NOT NULL REFERENCES movimenti(id) ON DELETE CASCADE,
  ente_id UUID NOT NULL REFERENCES enti(id) ON DELETE CASCADE,
  quota_importo NUMERIC(12,2) NOT NULL,
  voce_budget TEXT,                 -- codice voce (es. "5.2") da voci_budget
  note TEXT,
  creato_il TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_imp_mov ON imputazioni(movimento_id);
CREATE INDEX idx_imp_ente ON imputazioni(ente_id);

-- Note spese (form mobile standalone)
CREATE TABLE note_spese (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL,
  persona TEXT NOT NULL,
  progetto TEXT,
  evento TEXT,
  voci JSONB,                       -- array: [{tipo, descrizione, importo, link_scontrino}]
  totale NUMERIC(12,2),
  metodo_pagamento TEXT,
  link_documento_drive TEXT,
  stato TEXT DEFAULT 'Da elaborare',
  movimento_id UUID REFERENCES movimenti(id) ON DELETE SET NULL,
  note TEXT,
  inviata_il TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ns_stato ON note_spese(stato);
CREATE INDEX idx_ns_persona ON note_spese(persona);

-- Anomalie manuali (record persistenti)
CREATE TABLE anomalie (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL,
  descrizione TEXT NOT NULL,
  movimento_id UUID REFERENCES movimenti(id) ON DELETE CASCADE,
  ec_id UUID REFERENCES ec_bancario(id) ON DELETE CASCADE,
  stato TEXT DEFAULT 'aperta',
  risolta_il TIMESTAMPTZ,
  creato_il TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_anom_stato ON anomalie(stato);

-- Documenti Drive tracciati (memoria dei file già processati + coda triage)
CREATE TABLE documenti_drive (
  drive_file_id TEXT PRIMARY KEY,
  nome_file TEXT NOT NULL,
  folder_path TEXT,
  web_view_link TEXT,
  movimento_id UUID REFERENCES movimenti(id) ON DELETE SET NULL,
  -- Stato: da_abbinare | abbinato | cassa | scartato
  stato TEXT DEFAULT 'da_abbinare',
  -- Dati estratti dall'AI al momento dell'analisi
  ai_data_documento DATE,
  ai_importo NUMERIC(12,2),
  ai_tipo TEXT,                    -- ENTRATA | USCITA
  ai_fornitore TEXT,
  ai_numero_documento TEXT,
  ai_descrizione TEXT,
  ai_categoria TEXT,
  ai_metodo TEXT,                  -- BPE | NEXI | CASSA
  ai_progetto TEXT,
  ai_confidenza INTEGER,
  match_score INTEGER,             -- score del miglior match trovato (0-100)
  note_match TEXT,                 -- audit log
  importato_il TIMESTAMPTZ DEFAULT NOW(),
  importato_da UUID
);
CREATE INDEX idx_dd_mov ON documenti_drive(movimento_id);
CREATE INDEX idx_dd_folder ON documenti_drive(folder_path);
CREATE INDEX idx_dd_stato ON documenti_drive(stato);

-- Voci budget (template gerarchico per progetto)
CREATE TABLE voci_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  progetto TEXT NOT NULL,
  codice TEXT NOT NULL,
  nome TEXT NOT NULL,
  parent_codice TEXT,
  ordine INTEGER DEFAULT 0,
  attivo BOOLEAN DEFAULT TRUE,
  creato_il TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(progetto, codice)
);
CREATE INDEX idx_vb_progetto ON voci_budget(progetto);
CREATE INDEX idx_vb_parent ON voci_budget(parent_codice);

-- Budget ente x voce (preventivi per combinazione)
CREATE TABLE budget_ente_voce (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ente_id UUID NOT NULL REFERENCES enti(id) ON DELETE CASCADE,
  voce_codice TEXT NOT NULL,
  progetto TEXT NOT NULL,
  anno INTEGER NOT NULL,
  preventivo NUMERIC(12,2) DEFAULT 0,
  note TEXT,
  creato_il TIMESTAMPTZ DEFAULT NOW(),
  modificato_il TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ente_id, voce_codice, progetto, anno)
);
CREATE INDEX idx_bev_ente ON budget_ente_voce(ente_id);
CREATE INDEX idx_bev_voce ON budget_ente_voce(voce_codice);
CREATE INDEX idx_bev_progetto ON budget_ente_voce(progetto);

-- =====================================================================
-- TRIGGER: aggiorna stato del movimento in base a metodo/EC/doc
-- 5 stati: Manca doc | Attesa EC | Cassa | No doc | Accoppiato (+ Vuoto)
-- =====================================================================
CREATE OR REPLACE FUNCTION aggiorna_stato_movimento()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.senza_documento THEN
    NEW.stato := 'No doc';
  ELSIF NEW.metodo = 'CASSA' THEN
    NEW.stato := 'Cassa';
  ELSE
    IF (NEW.link_documento IS NOT NULL AND NEW.link_documento <> '') AND NEW.ec_id IS NOT NULL THEN
      NEW.stato := 'Accoppiato';
    ELSIF NEW.ec_id IS NOT NULL THEN
      NEW.stato := 'Manca doc';
    ELSIF NEW.link_documento IS NOT NULL AND NEW.link_documento <> '' THEN
      NEW.stato := 'Attesa EC';
    ELSE
      NEW.stato := 'Vuoto';
    END IF;
  END IF;
  NEW.modificato_il := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stato_movimento
BEFORE INSERT OR UPDATE ON movimenti
FOR EACH ROW EXECUTE FUNCTION aggiorna_stato_movimento();

-- =====================================================================
-- FUNZIONE: ricalcola progressivi cronologici per un anno
-- Il progressivo è numero (1, 2, 3...) assegnato per anno solo a movimenti
-- che hanno o avranno documento (NON commissioni/bolli con senza_documento).
-- =====================================================================
CREATE OR REPLACE FUNCTION ricalcola_progressivi(p_anno INTEGER) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Auto-numera solo righe SENZA override, SENZA escludi, SENZA senza_documento
  WITH ordered AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY data, creato_il, id) AS num
    FROM movimenti
    WHERE anno = p_anno
      AND COALESCE(senza_documento, FALSE) = FALSE
      AND COALESCE(escludi_progr, FALSE) = FALSE
      AND (progressivo_override IS NULL OR progressivo_override = '')
  )
  UPDATE movimenti m
  SET progressivo = o.num::TEXT
  FROM ordered o
  WHERE m.id = o.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Righe con override → display = override
  UPDATE movimenti
  SET progressivo = progressivo_override
  WHERE anno = p_anno
    AND progressivo_override IS NOT NULL
    AND progressivo_override <> '';

  -- Righe escluse/commissioni → NULL
  UPDATE movimenti
  SET progressivo = NULL
  WHERE anno = p_anno
    AND (COALESCE(senza_documento, FALSE) = TRUE OR COALESCE(escludi_progr, FALSE) = TRUE)
    AND (progressivo_override IS NULL OR progressivo_override = '');

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Trigger: dopo INSERT/UPDATE/DELETE ricalcola la progressione
CREATE OR REPLACE FUNCTION trigger_ricalcola_progressivi() RETURNS TRIGGER AS $$
DECLARE
  v_anno INTEGER;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_anno := OLD.anno;
  ELSE
    v_anno := NEW.anno;
  END IF;
  PERFORM ricalcola_progressivi(v_anno);
  IF (TG_OP = 'UPDATE' AND OLD.anno IS DISTINCT FROM NEW.anno) THEN
    PERFORM ricalcola_progressivi(OLD.anno);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ricalcola_progressivi
AFTER INSERT OR UPDATE OF data, anno, senza_documento, escludi_progr, progressivo_override OR DELETE
ON movimenti
FOR EACH ROW EXECUTE FUNCTION trigger_ricalcola_progressivi();

-- =====================================================================
-- TRIGGER budget_ente_voce: modificato_il auto
-- =====================================================================
CREATE OR REPLACE FUNCTION update_bev_modified()
RETURNS TRIGGER AS $$
BEGIN
  NEW.modificato_il := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bev_modified
BEFORE UPDATE ON budget_ente_voce
FOR EACH ROW EXECUTE FUNCTION update_bev_modified();

-- =====================================================================
-- RPC: generaProgressivo (legacy, per compat — non più usato per movimenti)
-- =====================================================================
CREATE OR REPLACE FUNCTION genera_progressivo(p_prefix TEXT, p_anno INTEGER)
RETURNS TEXT AS $$
DECLARE
  v_max INTEGER;
  v_next INTEGER;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(progressivo FROM '^' || p_prefix || '\s+(\d+)/' || p_anno || '$') AS INTEGER)
  ), 0)
  INTO v_max
  FROM movimenti
  WHERE anno = p_anno
    AND progressivo ~ ('^' || p_prefix || '\s+\d+/' || p_anno || '$');
  v_next := v_max + 1;
  RETURN p_prefix || ' ' || v_next || '/' || p_anno;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- VISTA: consuntivo per ente/voce (somma imputazioni)
-- =====================================================================
CREATE OR REPLACE VIEW v_consuntivo_ente_voce AS
SELECT
  i.ente_id,
  i.voce_budget AS voce_codice,
  m.progetto,
  m.anno,
  SUM(i.quota_importo) AS consuntivo,
  COUNT(*) AS n_imputazioni
FROM imputazioni i
JOIN movimenti m ON m.id = i.movimento_id
WHERE i.voce_budget IS NOT NULL AND i.voce_budget != ''
GROUP BY i.ente_id, i.voce_budget, m.progetto, m.anno;

-- =====================================================================
-- VISTA: anomalie automatiche (mov "Attesa EC" > 30gg + EC libere > 30gg)
-- =====================================================================
CREATE OR REPLACE VIEW v_anomalie_calcolate AS
  SELECT
    m.id::TEXT AS riferimento_id,
    'mov' AS tipo_rif,
    'Attesa EC > 30gg' AS tipo_anomalia,
    'Movimento ' || COALESCE(m.progressivo, '?') ||
      ' del ' || m.data || ' (' || m.importo || ' EUR) — link documento presente ma nessun EC abbinato dopo ' ||
      EXTRACT(DAY FROM (NOW() - m.data::TIMESTAMP))::INT || ' giorni' AS descrizione,
    m.data AS data_rif,
    m.importo
  FROM movimenti m
  WHERE m.stato = 'Attesa EC'
    AND m.data < CURRENT_DATE - INTERVAL '30 days'
UNION ALL
  SELECT
    e.id::TEXT AS riferimento_id,
    'ec' AS tipo_rif,
    'EC senza documento > 30gg' AS tipo_anomalia,
    'Riga EC ' || e.descrizione_banca || ' del ' || e.data_valuta ||
      ' (' || e.importo || ' EUR) — nessun movimento abbinato dopo ' ||
      EXTRACT(DAY FROM (NOW() - e.data_valuta::TIMESTAMP))::INT || ' giorni' AS descrizione,
    e.data_valuta AS data_rif,
    e.importo
  FROM ec_bancario e
  WHERE e.movimento_id IS NULL
    AND e.data_valuta < CURRENT_DATE - INTERVAL '30 days';

-- =====================================================================
-- VISTA: movimenti ordinati (rispetta ordine_manuale)
-- =====================================================================
CREATE OR REPLACE VIEW v_movimenti_ordinati AS
SELECT
  m.*,
  ROW_NUMBER() OVER (
    PARTITION BY m.anno
    ORDER BY
      CASE WHEN m.ordine_manuale IS NULL THEN 1 ELSE 0 END,
      m.ordine_manuale,
      m.data,
      m.creato_il
  ) AS position
FROM movimenti m;

-- =====================================================================
-- SEED: Progetti dell'associazione
-- =====================================================================
INSERT INTO progetti (nome, descrizione, ordine) VALUES
  ('Generale',         'Movimenti generali non legati a un progetto specifico', 1),
  ('SSF Estivo',       'Silent Sardinia Festival edizione estiva',              10),
  ('SSF EDU',          'Silent Sardinia Festival educational',                  11),
  ('Silent Tales',     'Progetto Silent Tales',                                 20),
  ('Itinerari EDU VE', 'Itinerari educativi a Venezia',                         30);

-- =====================================================================
-- SEED: Enti finanziatori 2026
-- =====================================================================
INSERT INTO enti (nome, nome_completo, anno, importo_assegnato, scadenza_rendicontazione) VALUES
  ('RAS',                'Regione Autonoma Sardegna',     2026, 23000.00, '2027-05-31'),
  ('FDS',                'Fondazione di Sardegna',        2026, 20000.00, '2026-10-15'),
  ('STG',                'Comune Santa Teresa Gallura',   2026, 22000.00, '2026-09-15'),
  ('Aglientu',           'Comune di Aglientu',            2026,  8050.00, '2026-09-15'),
  ('CCIA Sassari',       'Camera di Commercio Sassari',   2026,  9000.00, '2026-09-15'),
  ('Arzachena',          'Comune di Arzachena',           2026,     0.00, '2027-11-30'),
  ('OPM Tavola Valdese', 'OPM Tavola Valdese',            2026,     0.00, '2027-01-31'),
  ('Fondi propri',       'Fondi propri Roerso Mondo',     2026,     0.00, NULL),
  ('Invitalia',          'Invitalia',                     2026,     0.00, NULL);

-- =====================================================================
-- SEED: Voci budget per progetti SSF + Generale
-- =====================================================================
DO $$
DECLARE
  prog TEXT;
BEGIN
  FOREACH prog IN ARRAY ARRAY['SSF Estivo', 'SSF EDU']
  LOOP
    INSERT INTO voci_budget (progetto, codice, nome, parent_codice, ordine) VALUES
      (prog, '1',    '1. Artisti',                              NULL, 10),
      (prog, '2',    '2. Adempimenti Piano Sicurezza',          NULL, 20),
      (prog, '2.3',  '2.3 Personale Sicurezza',                 '2',  21),
      (prog, '2.4',  '2.4 Assicurazione',                       '2',  22),
      (prog, '2.5',  '2.5 Presidio medico',                     '2',  23),
      (prog, '2.7',  '2.7 Marche da bollo',                     '2',  24),
      (prog, '2.8',  '2.8 Corsi sicurezza staff',               '2',  25),
      (prog, '2.9',  '2.9 Medico del lavoro',                   '2',  26),
      (prog, '2.10', '2.10 Piano della Sicurezza',              '2',  27),
      (prog, '3',    '3. SIAE e altri costi amministrativi',    NULL, 30),
      (prog, '4',    '4. Tecnica',                              NULL, 40),
      (prog, '4.1',  '4.1 Personale Tecnico',                   '4',  41),
      (prog, '4.8',  '4.8 Acquisti e materiali di consumo',     '4',  42),
      (prog, '5',    '5. Comunicazione',                        NULL, 50),
      (prog, '5.1',  '5.1 Ufficio stampa',                      '5',  51),
      (prog, '5.2',  '5.2 Grafico',                             '5',  52),
      (prog, '5.3',  '5.3 Stampe',                              '5',  53),
      (prog, '5.4',  '5.4 Social Media Manager',                '5',  54),
      (prog, '5.5',  '5.5 Sponsorizzate',                       '5',  55),
      (prog, '5.7',  '5.7 Sito Web',                            '5',  56),
      (prog, '5.8',  '5.8 Video',                               '5',  57),
      (prog, '5.9',  '5.9 Foto',                                '5',  58),
      (prog, '5.10', '5.10 Arredi brandizzati',                 '5',  59),
      (prog, '6',    '6. Ospitalità',                           NULL, 60),
      (prog, '6.1',  '6.1 Viaggi',                              '6',  61),
      (prog, '6.2',  '6.2 Benzina',                             '6',  62),
      (prog, '6.3',  '6.3 Alloggio',                            '6',  63),
      (prog, '6.4',  '6.4 Vitto',                               '6',  64),
      (prog, '7',    '7. Organizzazione',                       NULL, 70),
      (prog, '8',    '8. Consulenti',                           NULL, 80),
      (prog, '8.1',  '8.1 Consulente del lavoro',               '8',  81),
      (prog, '8.2',  '8.2 Commercialista',                      '8',  82),
      (prog, '8.3',  '8.3 Consulente bandi',                    '8',  83),
      (prog, '8.4',  '8.4 DVR e Medico (Sicurezza)',            '8',  84),
      (prog, '8.5',  '8.5 Sede',                                '8',  85),
      (prog, '8.6',  '8.6 Fido di Cassa e Spese C/C BPE',       '8',  86),
      (prog, '9',    '9. Imprevisti',                           NULL, 90);
  END LOOP;
END $$;

INSERT INTO voci_budget (progetto, codice, nome, parent_codice, ordine) VALUES
  ('Generale', '1', '1. Acquisti materiali',         NULL, 10),
  ('Generale', '2', '2. Servizi',                    NULL, 20),
  ('Generale', '3', '3. Locazioni e godimento beni', NULL, 30),
  ('Generale', '4', '4. Personale',                  NULL, 40),
  ('Generale', '5', '5. Imposte e bolli',            NULL, 50),
  ('Generale', '6', '6. Interessi passivi',          NULL, 60),
  ('Generale', '7', '7. Artisti e collaboratori',    NULL, 70),
  ('Generale', '8', '8. Rimborso prestiti',          NULL, 80),
  ('Generale', '9', '9. Altro',                      NULL, 90);

-- =====================================================================
-- FINE — verifica
-- =====================================================================
SELECT 'tabelle' AS tipo, COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public'
UNION ALL SELECT 'viste',     COUNT(*) FROM information_schema.views    WHERE table_schema='public'
UNION ALL SELECT 'funzioni',  COUNT(*) FROM information_schema.routines WHERE routine_schema='public'
UNION ALL SELECT 'enti',      COUNT(*) FROM enti
UNION ALL SELECT 'voci',      COUNT(*) FROM voci_budget;
