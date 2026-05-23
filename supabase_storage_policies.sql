-- =====================================================================
-- Policy storage bucket "scontrini"
-- Permette upload + lettura anche da utenti non loggati (anon)
-- Necessario per form note spese che gira senza login (solo PIN)
-- =====================================================================
-- USO: SQL Editor → Role: postgres → Run
-- =====================================================================

-- Assicura che le policy non esistano già prima di crearle
DROP POLICY IF EXISTS "Allow anon upload scontrini" ON storage.objects;
DROP POLICY IF EXISTS "Allow anon read scontrini" ON storage.objects;
DROP POLICY IF EXISTS "Allow auth update scontrini" ON storage.objects;
DROP POLICY IF EXISTS "Allow admin delete scontrini" ON storage.objects;

-- INSERT: anyone (anon o authenticated) può uploadare in scontrini
CREATE POLICY "Allow anon upload scontrini"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'scontrini');

-- SELECT: anyone può leggere/visualizzare i file
CREATE POLICY "Allow anon read scontrini"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'scontrini');

-- UPDATE: solo utenti autenticati (admin/editor app)
CREATE POLICY "Allow auth update scontrini"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'scontrini');

-- DELETE: solo utenti autenticati (proteggi da cancellazioni accidentali esterne)
CREATE POLICY "Allow admin delete scontrini"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'scontrini');

-- Verifica
SELECT policyname, cmd, roles::TEXT
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE '%scontrini%'
ORDER BY policyname;
