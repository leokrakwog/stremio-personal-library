# Stremio Personal Library

A personal Stremio addon that exposes each user's own Stremio Library as a single Home catalog row named **"Salvati per dopo"**.

Each user connects their own Stremio account and receives a private addon URL. The addon retrieves that user's Library directly from Stremio and displays movies and series together, ordered from newest to oldest.

## Features

- 🔐 Personal Stremio account linking
- 📚 Displays the user's own Stremio Library
- 🎬 Movies and series in a single Home row
- 🆕 Newest saved items first
- 🔗 One private addon URL per connected account
- 💾 Persistent sessions using Supabase
- 🔒 Stremio authentication keys encrypted at rest
- 🛡️ Helmet security headers
- 🚦 Rate limiting on authentication/linking endpoints
- 🌐 HTTPS through Render
- 🚫 No Stremio authentication key in the addon URL

## How it works

The application uses Stremio's remote account-linking flow.

```text
User
 │
 │ Connect Stremio
 ▼
Stremio Link API
 │
 │ authentication token
 ▼
Backend
 │
 ├── authenticates with Stremio
 ├── generates a random session ID
 ├── encrypts the Stremio auth key
 └── stores the encrypted session in Supabase
 │
 ▼
Private addon URL
 │
 ▼
Stremio
 │
 └── requests the user's Library
       │
       ▼
   Stremio API
```

The `authKey` is never included in the addon URL.

The addon URL contains only a cryptographically random session identifier.

## Security

The application is designed so that sensitive Stremio credentials are kept server-side.

### Authentication keys

Stremio authentication keys are encrypted using:

- AES-256-GCM
- a randomly generated 12-byte IV for every encryption
- an authentication tag provided by AES-GCM

The encryption key is stored exclusively as the `SESSION_ENCRYPTION_KEY` environment variable on the server.

It must never be committed to GitHub.

### Database

Supabase stores:

- `session_id`
- `created_at`
- `last_used_at`
- `auth_key_encrypted`

The plaintext Stremio authentication key is not stored in the database.

Sessions that have been inactive for more than 30 days are automatically removed.

### Session identifiers

Each session ID is generated using 32 cryptographically secure random bytes.

The session ID is used as an opaque identifier and does not contain the Stremio authentication key.

### HTTP security

The server uses:

- Helmet
- HTTPS through Render
- CORS headers required by Stremio
- rate limiting on account-linking endpoints
- trusted proxy configuration for Render

Catalog requests are intentionally not rate-limited because Stremio clients can make repeated catalog requests during normal operation.

## Environment variables

The production server requires:

```text
SUPABASE_URL
SUPABASE_KEY
SESSION_ENCRYPTION_KEY
```

### `SUPABASE_URL`

The URL of the Supabase project.

### `SUPABASE_KEY`

A Supabase server-side secret key.

This key must never be exposed to the browser or committed to the repository.

### `SESSION_ENCRYPTION_KEY`

A 32-byte encryption key represented as 64 hexadecimal characters.

Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Database

Create a `sessions` table in Supabase:

```sql
create table sessions (
  session_id text primary key,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  auth_key_encrypted text
);
```

Row Level Security should be enabled.

The application accesses the database server-side using the Supabase secret key.

## Local development

Install dependencies:

```bash
npm install
```

Set the required environment variables and start the server:

```bash
npm start
```

The default local port is:

```text
7700
```

Open:

```text
http://127.0.0.1:7700
```

## Deployment

The production deployment runs as a Render Web Service connected to the GitHub repository.

Every push to the `main` branch triggers a new deployment.

Production URL:

https://stremio-personal-library.onrender.com/

## Project structure

```text
.
├── public/
│   ├── app.js
│   ├── index.html
│   ├── logo.png
│   └── style.css
├── .gitignore
├── package-lock.json
├── package.json
├── README.md
└── server.js
```

## API endpoints

### Health

```text
GET /api/health
```

Returns the service status.

### Create Stremio link

```text
GET /api/link/create
```

Creates a temporary Stremio remote-login link.

### Read Stremio link

```text
GET /api/link/read?code=XXXX
```

Reads the result of the Stremio remote-login process.

### Connect account

```text
POST /api/connect
```

Converts the Stremio authentication result into a persistent private session.

### Manifest

```text
GET /u/:sessionId/manifest.json
```

Returns the personalized addon manifest.

### Personal Library

The addon exposes the connected user's Stremio Library through its catalog endpoint.

The catalog is displayed in Stremio as:

**Salvati per dopo**

## Privacy

The service needs access to the connected Stremio account's Library in order to provide the addon functionality.

The service does not intentionally expose the Stremio authentication key to the client after the account-linking process.

Authentication keys are stored encrypted on the server.

Session records that have been inactive for more than 30 days are automatically deleted.

## Limitations

- The addon depends on Stremio's APIs and remote-linking service.
- Stremio clients may cache addon manifests or catalog information.
- The mixed movie/series catalog relies on behavior supported by the current Stremio client.
- The service does not provide media streams; it only exposes Library metadata.
- A private addon URL should be treated as a secret because possession of it grants access to the associated Library through the addon.

## License

This project is provided as-is for personal use.
