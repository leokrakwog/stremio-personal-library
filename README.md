# Stremio Personal Setup v0.6

Personal Stremio Library as one Home catalog row named **Salvati per dopo**.

This build keeps the account-linking flow from v0.4 and experiments with one catalog row containing both movies and series. The Stremio addon protocol normally separates catalog types, so the mixed row is intentionally a compatibility workaround.

Library items are ordered by Stremio's `_ctime` (creation/addition time), newest first, with `_mtime`/other timestamps as fallback.

## Run

```bash
npm install
npm start
```

Open `http://127.0.0.1:7700`.


## v0.6 experimental mixed catalog
The manifest exposes the personal library as a mixed `all` catalog named exactly `Salvati per dopo`, so Stremio clients that support mixed catalogs should not append `- Film`. The catalog contents remain newest-first by Library creation time. This uses an experimental client-compatible behavior because the public addon protocol documents typed catalogs such as `movie` and `series`.
