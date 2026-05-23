# Roerso Mondo ETS — App Amministrativa

Web app HTML+JS vanilla per la gestione amministrativa di Roerso Mondo ETS.

- **Database**: Supabase (PostgreSQL cloud, free tier)
- **Auth**: Supabase Auth (email+password, ruoli admin/editor/viewer)
- **Storage documenti**: Google Drive (solo link, no upload)
- **AI**: Anthropic Claude Haiku per leggere PDF fatture
- **Hosting**: gira in locale (`index.html`) o su Render/Vercel/Netlify
- **Zero build step**: niente npm, niente Python, niente server. Apri e funziona.

---

## Indice

1. [Setup iniziale](#setup)
2. [Setup Supabase (5 min)](#supabase)
3. [Setup Anthropic API (3 min)](#anthropic)
4. [Setup Google Drive (15 min, opzionale)](#google)
5. [Avvio locale](#avvio)
6. [Deploy online](#deploy)
7. [Funzionalità](#funzionalità)
8. [Form note spese mobile](#note-spese)
9. [Backup](#backup)
10. [Sicurezza](#sicurezza)

---

<a id="setup"></a>
## 1. Setup iniziale

Scarica/clona il repo. Nella cartella troverai questi file:

```
roerso-admin/
├── index.html              # shell SPA + login
├── style.css               # design system
├── app.js                  # router, dashboard, primanota, form
├── supabase.js             # client + tutte le query
├── drive.js                # Google Drive API
├── ai.js                   # Claude Haiku
├── export.js               # SheetJS export Excel
├── form-note-spese.html    # pagina mobile standalone
├── config.example.js       # template configurazione
├── config.js               # ⚠️ tue chiavi API — non committare
├── supabase_schema.sql     # DDL tabelle Postgres
├── .gitignore
└── README.md
```

**Copia `config.example.js` in `config.js`** e compila i valori (vedi sezioni sotto).

---

<a id="supabase"></a>
## 2. Setup Supabase

### Crea il progetto
1. Vai su **https://supabase.com** → "Start your project" → login con GitHub o Google
2. **New project** → nome `roerso-mondo` → password DB (salvala) → regione **Europe (Frankfurt)** → Create
3. Aspetta ~1 minuto

### Copia le credenziali in `config.js`
1. Dentro il progetto → **Project Settings** → **API**
2. Copia in `config.js`:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`

### Crea le tabelle
1. Menu sinistra → **SQL Editor** → **New query**
2. Apri `supabase_schema.sql` da questa cartella, **copia tutto il contenuto**, incollalo nell'editor
3. **Run** (in basso a destra)
4. Dovresti vedere "Success. No rows returned" o simili. Le tabelle sono create.

### Crea il primo utente admin
1. Menu sinistra → **Authentication** → **Users** → **Add user** → **Create new user**
2. Email: la tua email — Password: una password robusta
3. Spunta **"Auto Confirm User"** così non deve cliccare nessun link via email
4. Crea
5. Click sull'utente appena creato → in fondo, **Raw user metadata** → modifica e metti:
   ```json
   { "nome": "Yari", "ruolo": "admin" }
   ```
6. Salva

Ora puoi fare login nell'app.

> 💡 Per aggiungere Michele come editor: ripeti i passi 1-4 con la sua email, poi nei metadata
> metti `{ "nome": "Michele Moi", "ruolo": "editor" }`.

---

<a id="anthropic"></a>
## 3. Setup Anthropic API

1. Vai su **https://console.anthropic.com** → API Keys → **Create Key**
2. Nome: `roerso-admin` → copia la chiave (formato `sk-ant-api03-...`)
3. Mettila in `config.js` → `ANTHROPIC_API_KEY`
4. **Billing** → aggiungi 5$ di credito (durerà mesi con uso normale)

> 💰 Claude Haiku 4.5 costa ~$1/M input tokens. Una fattura PDF = ~10K token. 100 fatture ≈ $1.

---

<a id="google"></a>
## 4. Setup Google Drive (opzionale)

Serve solo se vuoi la funzionalità "Analizza cartella Drive" — l'AI legge tutti i PDF di una cartella in batch.

### Crea progetto Google Cloud
1. **https://console.cloud.google.com** → New Project → nome `Roerso Admin`
2. APIs & Services → **Library** → cerca **Google Drive API** → **Enable**

### Crea credenziali OAuth
3. APIs & Services → **OAuth consent screen** → tipo **External** → nome app `Roerso Admin`, support email tua → Save
4. Aggiungi scope `https://www.googleapis.com/auth/drive.readonly`
5. Aggiungi te stesso come **Test user**

6. APIs & Services → **Credentials** → **+ Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `http://localhost:5500` (o porta che usi) + dominio produzione se hai
   - Authorized redirect URIs: lascia vuoto
   - Create → copia il **Client ID** → `config.js` → `GOOGLE_CLIENT_ID`

7. APIs & Services → **Credentials** → **+ Create Credentials** → **API key**
   - Copia la chiave → `config.js` → `GOOGLE_API_KEY`
   - (Consigliato) Limita la chiave a Google Drive API

---

<a id="avvio"></a>
## 5. Avvio locale

Non puoi aprire `index.html` con doppio click — i moduli ES6 e Supabase richiedono che la pagina sia servita da HTTP. Usa uno di questi:

### Opzione 1 — Live Server di VSCode
1. Apri la cartella in VSCode → installa estensione "Live Server"
2. Click destro su `index.html` → "Open with Live Server"
3. Si apre `http://localhost:5500`

### Opzione 2 — Python
```bash
cd roerso-admin
python -m http.server 8000
```
Apri `http://localhost:8000`

### Opzione 3 — Node `serve`
```bash
npx serve .
```

Login con l'utente admin creato in Supabase.

---

<a id="deploy"></a>
## 6. Deploy online (quando vuoi)

L'app è statica (HTML+JS+CSS), si deploya gratis su qualsiasi static host.

### Render (consigliato)
1. Push la cartella su GitHub (assicurati che `config.js` sia in `.gitignore`)
2. Render → New → Static Site → collega il repo
3. Build command: lascia vuoto · Publish directory: `.`
4. Deploy

⚠️ `config.js` non finisce su GitHub: devi caricarlo manualmente nel deploy oppure usare le **environment variables** di Render iniettandole in build time.

### Alternative
- **Vercel**: import GitHub repo → deploy
- **Netlify**: drag & drop della cartella

### Dominio personalizzato
Su Render/Vercel/Netlify aggiungi il tuo dominio (es. `admin.roersomondo.it`) e configura il DNS.

---

<a id="funzionalità"></a>
## 7. Funzionalità principali

| Schermata | Cosa fa |
|---|---|
| **Dashboard** | Saldo BPE, contatori, grafico entrate/uscite, scadenze rendicontazioni con countdown |
| **Prima Nota** | Tabella movimenti con filtri (anno/mese/tipo/categoria/metodo/progetto/ente/stato/testo), colori stato, paginazione, totali dinamici |
| **Aggiungi/Modifica** | Form completo, progressivo automatico, link Drive, rilevamento doppioni |
| **Analizza PDF** | Upload manuale o scansione cartella Drive → Claude legge → form precompilato → conferma |
| **Abbinamento EC** | Import CSV BPE, match automatico per importo+data±5gg, segna no-doc, punti di domanda |
| **Imputazioni Ente** | Splitta un movimento su più enti con quota e voce budget, protezione doppia rendicontazione |
| **Enti e Budget** | Tabella enti, barre avanzamento, scadenze rendicontazione |
| **Export** | Excel primanota (formato Michele), Excel rendicontazione per ente, CSV per commercialista |
| **Note Spese** | Vista note spese ricevute, trasforma in movimento con un click |
| **Impostazioni** | Gestione utenti, backup JSON, import storico |

### Categorie disponibili (come primanota Michele)

**Uscite**: U1 (acquisti) · U2 (servizi) · U3 (locazioni) · U4 (personale) · U5 (imposte/bolli) · U6 (interessi) · U7 (artisti) · U10 (rimborso prestiti)

**Entrate**: E1 (quote/prestiti soci) · E7 (fatture emesse) · E8 (contributi) · E9 (contratti pubblici) · E10 (finanziamenti) · E11 (altre)

### Stati movimento (calcolati automaticamente)

- 🟡 **In lavorazione** — manca il link al documento
- 🔵 **Lavorato** — link documento presente, non ancora abbinato all'EC
- 🟢 **Accoppiato** — abbinato anche al movimento bancario

### Progressivi auto-generati

- `U4` → `BP N/2026`
- descrizione "nota spese" → `NS N/2026`
- descrizione "NP" → `NP N/2026`
- descrizione "F24" → `F24 N/2026`
- `E1` → `E1 N/2026`
- `E10` → `E10 N/2026`
- altre USCITE → `FPR N/2026`
- altre ENTRATE → `E N/2026`

Il numero è atomico via funzione Supabase `genera_progressivo()` — niente conflitti tra utenti.

---

<a id="note-spese"></a>
## 8. Form note spese mobile

Pagina standalone `form-note-spese.html` pensata per essere aperta da telefono dai collaboratori.

### Come funziona
1. Apri `form-note-spese.html` (anche con URL diretto su mobile)
2. Inserisci PIN (configurato in `config.js` → `NOTE_SPESE_PIN`)
3. Compili: nome, data, progetto, voci di spesa (ripetibili), metodo
4. Per ogni voce puoi:
   - 📷 **Caricare foto/PDF scontrino** dal telefono (gallery o fotocamera) → finisce su Supabase Storage
   - 🔗 Oppure incollare un **link Drive**
5. Invia → la nota spese arriva nella tabella `note_spese` su Supabase
6. Admin in app vedi badge "Note spese da elaborare", click → trasforma in movimento

### Due modi per allegare scontrini

Il form note spese mostra **due opzioni** affiancate per ogni voce:

| Bottone | Cosa fa | Pro | Contro |
|---|---|---|---|
| 🔗 **Scegli da Drive** | Apre Google Drive Picker, selezioni o carichi file nel Drive | Zero costo storage, file su Drive Roerso | Serve account Google + popup OAuth |
| 📷 **Carica file** | Upload diretto da fotocamera/galleria → Supabase Storage | Funziona senza account Google, super-veloce | Conta sul piano Supabase (1 GB free) |

**L'utente può scegliere caso per caso**. Tipicamente:
- Da telefono al volo, scontrino preso ora → 📷 Carica
- Documento già su Drive condiviso → 🔗 Drive Picker

### Setup Supabase Storage (per il bottone "Carica file")

1. Dashboard Supabase → **Storage** (menu sinistra)
2. **New bucket** → nome: `scontrini` → spunta **"Public bucket"** → Create
3. (Opzionale) Limita MIME types a `image/*,application/pdf` e max 10 MB per file

**Limiti free tier**:
- 1 GB storage totale (≈1000-2000 scontrini, basta 1-2 anni)
- 50 MB per singolo file
- 5 GB bandwidth/mese
- Quando arrivi al limite: piano Pro $25/mese con 100 GB

### Setup Drive Picker (per il bottone "Scegli da Drive")

Funziona automaticamente se `GOOGLE_CLIENT_ID` e `GOOGLE_API_KEY` sono in `config.js` (vedi sezione 4 — è la stessa configurazione che usi per Analizza PDF da cartella Drive).

**Quale Drive viene usato**: l'utente fa login col suo account Google. Il Picker mostra le cartelle a cui ha accesso (inclusi i Drive condivisi). Quando carica un file dal Picker, finisce sul SUO Drive di default, ma può navigare nella cartella Roerso Mondo condivisa e caricare lì.

Per centralizzare tutto: crea una cartella `Roerso Mondo / Scontrini Note Spese` su Drive, condividila con gli utenti del form note spese in scrittura, e istruiscili a caricare lì.

### URL condivisibile via WhatsApp/Email
Una volta deployato online, manda a Michele:
```
https://admin.roersomondo.it/form-note-spese.html
```
Salva come icona sulla home del telefono → si apre come app.

---

<a id="backup"></a>
## 9. Backup

### Manuale
**Impostazioni → Esporta backup JSON** → scarica un file con TUTTI i dati delle 7 tabelle.

### Automatico (Supabase)
Supabase fa backup giornalieri automatici sul piano gratuito (7 giorni di retention).
Su piano Pro (25$/mese) i backup vanno a 30 giorni con point-in-time recovery.

### Reminder
La dashboard mostra "Ultimo backup: X giorni fa" se passa più di una settimana dall'ultimo export manuale.

---

<a id="sicurezza"></a>
## 10. Sicurezza

### Cosa è OK
- ✅ Supabase ANON KEY: è una chiave **pubblica per design**, sicura nel browser
- ✅ Auth: gestita da Supabase, password hashate bcrypt server-side
- ✅ HTTPS obbligatorio per produzione

### Cosa fare attenzione
- ⚠️ **`ANTHROPIC_API_KEY` nel `config.js`** è esposta nel browser. Per uso interno è accettabile MA:
  - Imposta limite di spesa mensile su Anthropic Console
  - Non committare `config.js` su repo pubblici
  - Per produzione: meglio spostare la chiamata AI dietro una **Supabase Edge Function** (Deno/TS, anche gratis)
- ⚠️ **RLS (Row Level Security)**: disabilitata di default per facilità setup. Attivala da Supabase quando hai più utenti — il file `supabase_schema.sql` ha gli esempi di policy commentate

### Ruoli — 3 livelli di accesso

| Ruolo | Cosa può fare | Tipico utilizzatore |
|---|---|---|
| **admin** | TUTTO: AI/PDF, scansione Drive, auto-creazione bozze da EC, eliminazioni, gestione utenti, backup, impostazioni | Te (Yari) |
| **editor** | Inserimento e modifica MANUALE di movimenti, imputazioni, abbinamento EC, note spese. ❌ niente AI/Drive/auto-creazione | Michele o staff che fa data entry |
| **viewer** | Solo lettura ed export | Commercialista |
| (form-note-spese) | Pagina separata standalone, accesso via PIN, niente login Supabase | Collaboratori in trasferta (compilano scontrini dal telefono) |

I ruoli si impostano in **Supabase Authentication → Users → click utente → Raw user metadata**:
```json
{ "nome": "Mario Rossi", "ruolo": "admin" }      // oppure "editor" / "viewer"
```

**Cosa vede l'editor**:
- ✅ Dashboard, Prima Nota, Aggiungi/Modifica movimento, Abbinamento EC manuale, Imputazioni Ente, Enti, Rendicontazione, Note Spese, Export
- ❌ Analizza PDF (AI), tab Drive in Analizza PDF, bottone "⚡ Crea bozze automatiche", Impostazioni

**Cosa vede il form note spese** (PIN only, no login):
- Solo il form per inserire una nota spese con voci + upload scontrini
- I dati arrivano in tabella `note_spese` dell'app, dove admin li elabora e li trasforma in movimenti

---

## Roadmap funzionalità future

- [ ] Edge Function Anthropic per nascondere chiave AI
- [ ] Unione PDF (fattura + distinta BPE) con `pdf-lib` lato browser
- [ ] Rendiconto RUNTS — mapping automatico categorie → voci ministeriali
- [ ] Notifica email su note spese ricevute
- [ ] App PWA installabile da mobile

---

## Supporto

Per modifiche all'app: apri una chat con Claude e descrivi cosa vuoi cambiare. Il codice è volutamente leggero e modulare per essere facilmente esteso.
