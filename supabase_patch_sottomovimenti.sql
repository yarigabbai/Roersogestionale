-- =====================================================================
-- PATCH: sotto-movimenti (parent_id + is_reference)
-- =====================================================================
-- Aggiunge gerarchia movimenti padre → figli
-- Progressivi: padre = 5, figli = 5.1 / 5.2 / 5.3
--
-- Campi aggiunti:
--   parent_id     UUID → punta al movimento padre (NULL = primario)
--   is_reference  BOOL → padre diventato solo "contenitore" (reversibile)
--
-- Regole progressivo:
--   - Padri normali:    1, 2, 3 ... (come prima)
--   - Padri riferimento: NULL (non contano nella numerazione)
--   - Figli:            5.1, 5.2, 5.3 (basati sul progressivo del padre)
--
-- USO: SQL Editor → Role: postgres → Run
-- Idempotente.
-- =====================================================================

-- 1) Aggiungi colonne
ALTER TABLE movimenti ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES movimenti(id) ON DELETE SET NULL;
ALTER TABLE movimenti ADD COLUMN IF NOT EXISTS is_reference BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_mov_parent ON movimenti(parent_id);

-- 2) Drop viste dipendenti
DROP VIEW IF EXISTS v_anomalie_calcolate CASCADE;
DROP VIEW IF EXISTS v_movimenti_ordinati CASCADE;

-- 3) Riscrivi funzione ricalcola_progressivi con supporto figli
CREATE OR REPLACE FUNCTION ricalcola_progressivi(p_anno INTEGER) RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
  -- 3.1) Auto-numera solo righe PRIMARIE senza override/escludi/senza_doc/is_reference
  WITH ordered AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY data, creato_il, id) AS num
    FROM movimenti
    WHERE anno = p_anno
      AND parent_id IS NULL
      AND COALESCE(senza_documento, FALSE) = FALSE
      AND COALESCE(escludi_progr, FALSE) = FALSE
      AND COALESCE(is_reference, FALSE) = FALSE
      AND (progressivo_override IS NULL OR progressivo_override = '')
  )
  UPDATE movimenti m
  SET progressivo = o.num::TEXT
  FROM ordered o
  WHERE m.id = o.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 3.2) Override su primari
  UPDATE movimenti
  SET progressivo = progressivo_override
  WHERE anno = p_anno
    AND parent_id IS NULL
    AND progressivo_override IS NOT NULL
    AND progressivo_override <> '';

  -- 3.3) Primari esclusi/riferimento → NULL
  UPDATE movimenti
  SET progressivo = NULL
  WHERE anno = p_anno
    AND parent_id IS NULL
    AND (COALESCE(senza_documento, FALSE) = TRUE
      OR COALESCE(escludi_progr, FALSE) = TRUE
      OR COALESCE(is_reference, FALSE) = TRUE)
    AND (progressivo_override IS NULL OR progressivo_override = '');

  -- 3.4) Figli: progressivo = progressivo_padre.n
  WITH figli AS (
    SELECT m.id,
           p.progressivo AS progr_padre,
           ROW_NUMBER() OVER (PARTITION BY m.parent_id ORDER BY m.data, m.creato_il, m.id) AS n
    FROM movimenti m
    JOIN movimenti p ON p.id = m.parent_id
    WHERE m.anno = p_anno
      AND m.parent_id IS NOT NULL
      AND p.progressivo IS NOT NULL
  )
  UPDATE movimenti m
  SET progressivo = f.progr_padre || '.' || f.n::TEXT
  FROM figli f
  WHERE m.id = f.id;

  -- 3.5) Figli il cui padre non ha progressivo → NULL
  UPDATE movimenti
  SET progressivo = NULL
  WHERE anno = p_anno
    AND parent_id IS NOT NULL
    AND id NOT IN (
      SELECT m.id FROM movimenti m
      JOIN movimenti p ON p.id = m.parent_id
      WHERE p.progressivo IS NOT NULL AND m.anno = p_anno
    );

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 4) Aggiorna trigger per includere parent_id e is_reference
DROP TRIGGER IF EXISTS trg_ricalcola_progressivi ON movimenti;
CREATE TRIGGER trg_ricalcola_progressivi
AFTER INSERT OR UPDATE OF data, anno, senza_documento, escludi_progr, progressivo_override, parent_id, is_reference OR DELETE
ON movimenti
FOR EACH ROW EXECUTE FUNCTION trigger_ricalcola_progressivi();

-- 5) Ricrea viste
CREATE OR REPLACE VIEW v_anomalie_calcolate AS
  SELECT m.id::TEXT AS riferimento_id, 'mov' AS tipo_rif,
    'Attesa EC > 30gg' AS tipo_anomalia,
    'Movimento ' || COALESCE(m.progressivo, '?') ||
      ' del ' || m.data || ' (' || m.importo || ' EUR) — link documento presente ma nessun EC abbinato dopo ' ||
      EXTRACT(DAY FROM (NOW() - m.data::TIMESTAMP))::INT || ' giorni' AS descrizione,
    m.data AS data_rif, m.importo
  FROM movimenti m
  WHERE m.stato = 'Attesa EC' AND m.data < CURRENT_DATE - INTERVAL '30 days'
UNION ALL
  SELECT e.id::TEXT, 'ec',
    'EC senza documento > 30gg',
    'Riga EC ' || e.descrizione_banca || ' del ' || e.data_valuta ||
      ' (' || e.importo || ' EUR) — nessun movimento abbinato dopo ' ||
      EXTRACT(DAY FROM (NOW() - e.data_valuta::TIMESTAMP))::INT || ' giorni',
    e.data_valuta, e.importo
  FROM ec_bancario e
  WHERE e.movimento_id IS NULL AND e.data_valuta < CURRENT_DATE - INTERVAL '30 days';

CREATE OR REPLACE VIEW v_movimenti_ordinati AS
SELECT m.*,
  ROW_NUMBER() OVER (PARTITION BY m.anno ORDER BY
    CASE WHEN m.ordine_manuale IS NULL THEN 1 ELSE 0 END,
    m.ordine_manuale, m.data, m.creato_il) AS position
FROM movimenti m;

-- 6) Ricalcola tutti gli anni
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT anno FROM movimenti ORDER BY anno LOOP
    PERFORM ricalcola_progressivi(r.anno);
  END LOOP;
END $$;

-- 7) Verifica
SELECT column_name FROM information_schema.columns
WHERE table_name='movimenti' AND column_name IN ('parent_id','is_reference');
