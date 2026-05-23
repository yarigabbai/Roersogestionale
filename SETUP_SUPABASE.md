# Setup Supabase — Roerso Mondo ETS

Versione **definitiva e consolidata**. Zero patch accumulate.

---

## Quick Start (Reset Completo)

Per azzerare il DB e ricominciare da zero:

1. Apri **Supabase → SQL Editor** del tuo progetto
2. Cambia **Role: postgres** (in alto a destra)
3. Copia-incolla il contenuto di **`supabase_schema.sql`** → **Run**
   - ⏱️ ~5-10 sec
   - ✅ Crea schema + tabelle + trigger + funzioni + seed data (9 enti, 79 voci budget, 5 progetti)

4. Copia-incolla il contenuto di **`supabase_storage_policies.sql`** → **Run**
   - ⏱️ ~2 sec
   - ✅ Configura bucket "scontrini" per upload form note spese (senza login, con PIN)

5. Verifica nel tab **SQL** della console Supabase:
   ```sql
   SELECT COUNT(*) FROM enti;      -- deve dare 9
   SELECT COUNT(*) FROM movimenti; -- deve dare 0
   ```

✅ **Pronto**. Il DB è pulito, con struttura definitiva, trigger e policy RLS.

---

## File Descriptions

### 1. `supabase_schema.sql` — **DEFINITIVO**
- **Quando**: Reset totale o setup iniziale
- **Cosa fa**:
  - DROP tutto (tabelle, viste, trigger, funzioni) se esiste
  - CREATE tabelle (10): progetti, enti, ec_bancario, movimenti, imputazioni, note_spese, anomalie, documenti_drive, voci_budget, budget_ente_voce
  - CREATE viste (3): v_movimenti_ordinati, v_consuntivo_ente_voce, v_anomalie_calcolate
  - CREATE funzioni (5): ricalcola_progressivi(), trigger_ricalcola_progressivi(), ecc.
  - CREATE trigger (2): trg_ricalcola_progressivi, trg_bev_modified
  - INSERT seed data: enti, voci_budget, progetti
- **Contiene**:
  - ✅ Progressivi auto-cronologici con override manuale (`progressivo_override`)
  - ✅ Esclusione da numerazione (`escludi_progr`)
  - ✅ Multi-attach (1 documento → N movimenti)
  - ✅ All latest logic consolidato
- **Nota**: ⚠️ **DISTRUTTIVO** — cancella tutti i dati esistenti

### 2. `supabase_storage_policies.sql`
- **Quando**: Dopo `supabase_schema.sql`
- **Cosa fa**:
  - Crea policy di accesso al bucket Storage **"scontrini"**
  - Permette upload anonimo + lettura (per form note spese con PIN)
  - Permette admin di cancellare file
- **Prerequisito**: Il bucket "scontrini" deve esistere in Storage (Supabase lo crea automaticamente)
- **Non distruttivo**: Ricreabile senza perdere dati

### 3. `supabase_reset_dati.sql` — **Utility (opzionale)**
- **Quando**: Vuoi svuotare dati di test ma mantenere schema + configurazione
- **Cosa fa**:
  - TRUNCATE: movimenti, ec_bancario, imputazioni, note_spese, anomalie, documenti_drive, budget_ente_voce
  - **MANTIENE**: schema, trigger, funzioni, enti, voci_budget, utenti auth.users
- **Differenza da schema.sql**: Soft reset vs hard reset
  - ✅ Veloce (~1 sec)
  - ✅ Non rifare login
  - ✅ Non ricrea tabelle
- **Non distruttivo per schema**: Ripristinabile lanciando subito schema.sql

---

## Setup Procedure (Passo a Passo)

### Scenario A: Setup da zero (first time)
```
1. supabase_schema.sql              (crea tutto)
2. supabase_storage_policies.sql    (configura storage)
3. Ricarica i dati (movimenti, EC, documenti da Excel/Drive)
```

### Scenario B: Reset dopo test fallito
```
1. supabase_schema.sql              (ricrea da zero)
2. supabase_storage_policies.sql    (riconfigura)
3. Ricarica i dati
```

### Scenario C: Svuota dati test, mantieni schema
```
1. supabase_reset_dati.sql          (solo dati, non schema)
2. Ricarica i dati
```

### Scenario D: Aggiorno app con bug fix (schema invariato)
```
→ Non toccare Supabase
→ Solo deploy app.js, supabase.js, ai.js, ecc. su Render
```

---

## Verification Checklist

Dopo aver lanciato `supabase_schema.sql`:

```sql
-- Check tabelle
SELECT COUNT(*) FROM pg_tables WHERE schemaname='public';  -- ~10

-- Check dati seed
SELECT COUNT(*) FROM enti;                  -- 9
SELECT COUNT(*) FROM voci_budget;           -- 79
SELECT COUNT(*) FROM progetti;              -- 5
SELECT COUNT(*) FROM movimenti;             -- 0 (vuota)

-- Check viste
SELECT COUNT(*) FROM information_schema.views WHERE table_schema='public';  -- 3

-- Check funzioni
SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 
  (SELECT oid FROM pg_namespace WHERE nspname = 'public');  -- 5+

-- Check trigger
SELECT trigger_name FROM information_schema.triggers 
WHERE event_object_table='movimenti';  -- trg_ricalcola_progressivi, trg_stato_movimento
```

Dopo aver lanciato `supabase_storage_policies.sql`:

```sql
-- Check policy su bucket
SELECT policy_name FROM pg_policies 
WHERE schemaname='storage' AND tablename='objects';  
-- Must include: "Allow anon upload scontrini", "Allow anon read scontrini", ecc.
```

---

## Troubleshooting

| Problema | Causa | Soluzione |
|----------|-------|-----------|
| "Multiple assignment to column" | Vecchio schema inconsistente | Applica schema.sql (hard reset) |
| "Policy not found" | Storage policies non applicate | Applica supabase_storage_policies.sql |
| "Invalid input syntax for type uuid" | Seed data corrotto | Applica schema.sql da zero |
| RLS error on upload | Bucket non configurato | Verifica che bucket "scontrini" esista in Storage |
| Movimenti non si numerano | Trigger disabilitato | Check trigger con `SELECT trigger_name FROM...` |

---

## Notes

- ✅ Schema è **idempotente** dove possibile (CREATE/DROP ... IF EXISTS)
- ✅ Seed data è **hardcoded** nello schema (enti, voci_budget, progetti)
- ✅ Progressivi seguono logica: auto-numera cronologico, ma override esplicito e escludi disponibili
- ✅ Storage policies è **separate** da schema (può essere ricreata senza danni)
- ⚠️ Non toccare `auth.users` da SQL (Supabase gestisce)
- ⚠️ Non modificare seed data direttamente (modifica da app, triggher aggiorneranno)

---

## Files Removed (Consolidati)

Patch file eliminate perché consolidate nello schema:
- ❌ `supabase_patch_progr_auto_v2.sql` (old suffix model)
- ❌ `supabase_patch_progr_manuale.sql` (disabled trigger)
- ❌ `supabase_patch_multi_doc.sql` (1:N doc model)
- ❌ `supabase_patch_progr_override.sql` (now in schema.sql)

**Reason**: Uno schema definitivo è meglio che patch accumulate.

