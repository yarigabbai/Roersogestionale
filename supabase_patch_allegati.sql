-- =====================================================================
-- PATCH: allegati_movimento + bucket Storage "allegati"
-- =====================================================================
-- Permette N file per ogni movimento (fattura, distinta, nota spese, ecc.)
-- I file vanno in Supabase Storage bucket "allegati"
-- Il PDF unito viene salvato come allegato separato di tipo "pdf_unito"
--
-- USO: SQL Editor → Role: postgres → Run
-- Idempotente.
-- =====================================================================

-- 1) Tabella allegati
CREATE TABLE IF NOT EXISTS allegati_movimento (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movimento_id  UUID NOT NULL REFERENCES movimenti(id) ON DELETE CASCADE,
  storage_path  TEXT,                        -- path in bucket: {movimento_id}/{nome_file}
  storage_url   TEXT,                        -- URL pubblica (o signed URL)
  drive_file_id TEXT,                        -- se il file viene da Drive
  link          TEXT,                        -- link esterno generico
  nome          TEXT NOT NULL,               -- nome visualizzato
  tipo          TEXT DEFAULT 'altro',        -- fattura | distinta | nota_spese | autofattura | busta_paga | pdf_unito | altro
  mime_type     TEXT,                        -- application/pdf, image/jpeg, ecc.
  dimensione    INTEGER,                     -- bytes
  ordine        INTEGER DEFAULT 0,
  creato_da     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  creato_il     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_all_mov ON allegati_movimento(movimento_id);
CREATE INDEX IF NOT EXISTS idx_all_tipo ON allegati_movimento(tipo);

-- 2) RLS
ALTER TABLE allegati_movimento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allegati: lettura autenticati" ON allegati_movimento;
DROP POLICY IF EXISTS "allegati: scrittura editor+" ON allegati_movimento;
DROP POLICY IF EXISTS "allegati: delete admin+" ON allegati_movimento;

CREATE POLICY "allegati: lettura autenticati"
  ON allegati_movimento FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "allegati: scrittura editor+"
  ON allegati_movimento FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "allegati: update editor+"
  ON allegati_movimento FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "allegati: delete autenticati"
  ON allegati_movimento FOR DELETE
  TO authenticated USING (true);

-- 3) Storage bucket "allegati" (crealo da UI Supabase → Storage → New bucket → name: allegati, Public: false)
-- Poi applica queste policy:
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'allegati',
  'allegati',
  false,
  52428800,   -- 50 MB
  ARRAY['application/pdf','image/jpeg','image/png','image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO NOTHING;

-- Policy Storage
DROP POLICY IF EXISTS "allegati: upload autenticati" ON storage.objects;
DROP POLICY IF EXISTS "allegati: lettura autenticati" ON storage.objects;
DROP POLICY IF EXISTS "allegati: delete autenticati" ON storage.objects;

CREATE POLICY "allegati: upload autenticati"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'allegati');

CREATE POLICY "allegati: lettura autenticati"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'allegati');

CREATE POLICY "allegati: delete autenticati"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'allegati');

-- 4) Verifica
SELECT 'tabella allegati_movimento' AS oggetto, COUNT(*) AS righe FROM allegati_movimento
UNION ALL
SELECT 'bucket allegati', COUNT(*) FROM storage.buckets WHERE id = 'allegati';
