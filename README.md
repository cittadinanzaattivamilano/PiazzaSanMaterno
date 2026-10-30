# Piazza San Materno

Pagina pubblica con il contatore delle firme, la provenienza per Municipio e i commenti dei residenti a favore della piazza pedonale a San Materno (Casoretto, Milano).

Promossa da CAMI – Cittadinanza Attiva Milano insieme a Maledette Biciclette Milanesi.

## Come si aggiorna

Ogni 10 minuti un workflow di GitHub legge le risposte del modulo Tally, calcola i numeri e ripubblica la pagina (`scripts/build.mjs`, `index.template.html`). Nella pagina finiscono solo totali, Municipi e commenti con il consenso alla pubblicazione, mai nomi.

- `TALLY_API_KEY` (Settings → Secrets and variables → Actions → Secrets): chiave API di Tally, in sola lettura.
- `EXCLUDE_NAMES` (stessa schermata, scheda Variables, facoltativa): nomi da non contare, separati da virgola (prove, doppioni).
- `data/legacy.json`: le prime 6 firme, raccolte prima della domanda sul Municipio, con il Municipio stimato dal CAP.
