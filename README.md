# Iron Vault

Vault comunitario per i personaggi challenge di ChromieCraft (Hardcore, Ironman, Bloodthirsty e combinazioni).
Chi ha oggetti in più carica il proprio inventario; chi ne ha bisogno vede lo stock dei giocatori con la sua stessa
combinazione e ottiene il messaggio da mandare in gioco al donatore.

Sito statico (GitHub Pages) + database Supabase. Nessun account richiesto ai giocatori.

## Contenuto

| Percorso | Cosa contiene |
| --- | --- |
| `index.html` | Pagina di atterraggio: cos'è il vault, come installare l'addon, avviso che è un progetto non ufficiale. Generata da `src/landing.html`. |
| `vault.html` | Il vault vero e proprio (catalogo, richieste, caricamento, registro delle richieste). Generato da `src/` con `python3 build.py`. Non modificare a mano i due file. |
| `config.js` | Indirizzo e chiave pubblica di Supabase. Vuoto = modalità demo. |
| `supabase/schema.sql` | Tabella, regole di accesso e funzioni di caricamento. |
| `supabase/migration-002-requests.sql` | Da eseguire dopo `schema.sql`: razza dei personaggi e registro pubblico delle richieste (`requests`, `log_request()`). |
| `supabase/migration-003-inbox.sql` | Da eseguire dopo la 002: richieste in attesa per i donatori e conferma di consegna (`delivered_at`, `mark_request()`). |
| `supabase/migration-004-cancel.sql` | Da eseguire dopo la 003: annullamento delle richieste da parte di chi le ha fatte o del donatore (`cancel_request()`). |
| `supabase/migration-005-stock.sql` | Da eseguire dopo la 004: segnare una richiesta come consegnata scala gli oggetti dalla lista del donatore. |
| `addon/IronVault/` | Addon per il client 3.3.5a. `IronVault.zip` è lo stesso addon pronto da scaricare dal sito. Dalla 0.4 salva l'export da solo a ogni uscita dal gioco (`IronVaultDB.chars[nome].export` nel file SavedVariables), che il sito può leggere per aggiornare le liste (Chrome/Edge). |
| `src/` | Sorgenti della pagina (HTML, CSS, JavaScript, icone, dati demo). |

## Messa in linea

1. **Supabase**: crea un progetto, apri *SQL Editor*, incolla `supabase/schema.sql` ed esegui; poi fai lo stesso con `supabase/migration-002-requests.sql` , `supabase/migration-003-inbox.sql`, `supabase/migration-004-cancel.sql` e `supabase/migration-005-stock.sql`.
2. **Chiavi**: in *Project Settings > API* copia l'URL del progetto e la chiave pubblica (`anon` o `publishable`)
   dentro `config.js`. Non usare mai la chiave `service_role` / `secret`.
3. **GitHub**: carica il contenuto di questa cartella in un repository e attiva *Settings > Pages* sul ramo principale, cartella `/`.

## Come funziona la protezione

- La tabella `vaults` si può solo leggere. La colonna con l'hash del codice non è leggibile.
- Si scrive solo tramite `upload_vault()`: il primo caricamento di un personaggio crea la lista e restituisce un codice
  (mostrato una volta sola); i caricamenti successivi e la cancellazione richiedono quel codice.
- Freni: massimo 40 liste nuove all'ora in tutto il sito, 1500 oggetti e 300 kB per lista, un secondo di attesa a ogni codice sbagliato.
- Il nome del personaggio non è verificato: chi arriva primo lo prende. Per togliere una lista abusiva:
  `delete from public.vaults where character = 'Nome';` nell'SQL Editor.

## Modifiche

Modifica i file in `src/`, poi `python3 build.py`. Per l'addon, dopo ogni modifica rigenera lo zip:
`cd addon && zip -r ../IronVault.zip IronVault`.
