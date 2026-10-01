const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 7700;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.sendStatus(204);

  next();
});

app.use(express.json());
app.use(express.static("public"));

// Temporary in-memory sessions for this development build.
// The Stremio authKey is never put in the addon URL.
const sessions = new Map();

const LINK_API = "https://link.stremio.com/api";
const STREMIO_API = "https://api.strem.io/api";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function loginWithToken(token) {
  const body = await fetchJson(`${STREMIO_API}/loginWithToken`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      type: "LoginWithToken",
      token
    })
  });

  if (!body?.result?.authKey) {
    const message =
      body?.error?.message ||
      body?.error ||
      "Stremio loginWithToken failed";

    throw new Error(
      typeof message === "string"
        ? message
        : JSON.stringify(message)
    );
  }

  return body.result.authKey;
}

async function datastoreGet(authKey) {
  const body = await fetchJson(`${STREMIO_API}/datastoreGet`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      authKey,
      collection: "libraryItem",
      ids: [],
      all: true
    })
  });

  if (body?.error) {
    const message = body.error.message || body.error;

    throw new Error(
      typeof message === "string"
        ? message
        : JSON.stringify(message)
    );
  }

  const result = body?.result;

  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result?.items)) {
    return result.items;
  }

  if (Array.isArray(result?.changes)) {
    return result.changes;
  }

  if (result && typeof result === "object") {
    for (const value of Object.values(result)) {
      if (Array.isArray(value)) {
        return value;
      }
    }
  }

  return [];
}

function normalizeItem(item) {
  if (!item || (!item._id && !item.id)) {
    return null;
  }

  if (item.type !== "movie" && item.type !== "series") {
    return null;
  }

  return {
    id: item._id || item.id,
    type: item.type,
    name:
      item.name ||
      item.title ||
      item._id ||
      item.id,
    poster: item.poster || undefined,
    background: item.background || undefined,
    logo: item.logo || undefined,
    year: item.year
      ? Number(item.year) || item.year
      : undefined,
    description: item.description || undefined
  };
}

function publicBase(req) {
  const forwardedProto = req.get("x-forwarded-proto");

  const proto = forwardedProto
    ? forwardedProto.split(",")[0]
    : req.protocol;

  return `${proto}://${req.get("host")}`;
}

function manifestForSession(req, sessionId) {
  return {
    id: `com.personal.stremio-library.${sessionId.slice(0, 8)}`,

    version: "0.6.0",

    name: "Salvati per dopo",
    description: "La tua Libreria personale di Stremio.",

    logo: `${publicBase(req)}/logo.png`,

    resources: ["catalog"],

    // Custom type, exactly like StremShare.
    types: [
      "movie",
      "series",
      ""
    ],

    catalogs: [
      {
        type: "",
        name: "Salvati per dopo",
        id: "personal-library",
        extra: [
          {
            name: "skip",
            isRequired: false
          }
        ]
      }
    ],

    behaviorHints: {
      configurable: false
    }
  };
}


// ============================================================
// STREMIO ACCOUNT LINK
// ============================================================

app.get("/api/link/create", async (_req, res) => {
  try {
    const body = await fetchJson(`${LINK_API}/create`);

    if (!body?.link || !body?.code) {
      throw new Error(
        "Stremio link service returned an invalid response"
      );
    }

    res.json({
      link: body.link,
      code: body.code
    });
  } catch (error) {
    console.error(
      "Link create failed:",
      error.message
    );

    res.status(502).json({
      error: "Unable to create Stremio link"
    });
  }
});


app.get("/api/link/read", async (req, res) => {
  const code = String(
    req.query.code || ""
  ).trim();

  if (!code) {
    return res.status(400).json({
      error: "Missing code"
    });
  }

  try {
    const body = await fetchJson(
      `${LINK_API}/read?code=${encodeURIComponent(code)}`
    );

    res.json(body);
  } catch (error) {
    console.error(
      "Link read failed:",
      error.message
    );

    res.status(502).json({
      error: "Unable to read Stremio link"
    });
  }
});


app.post("/api/connect", async (req, res) => {
  const linkAuthKey = String(
    req.body?.authKey || ""
  ).trim();

  if (!linkAuthKey) {
    return res.status(400).json({
      error: "Missing authKey"
    });
  }

  try {
    const sessionAuthKey =
      await loginWithToken(linkAuthKey);

    const sessionId =
      crypto.randomBytes(32).toString("base64url");

    sessions.set(sessionId, {
      authKey: sessionAuthKey,
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    });

    const addonUrl =
      `${publicBase(req)}/u/` +
      `${encodeURIComponent(sessionId)}` +
      `/manifest.json`;

    res.json({
      addonUrl,
      sessionId
    });

  } catch (error) {
    console.error(
      "Stremio connect failed:",
      error.message
    );

    res.status(502).json({
      error:
        `Stremio login failed: ${error.message}`
    });
  }
});


// ============================================================
// MANIFEST
// ============================================================

app.get(
  "/u/:sessionId/manifest.json",
  (req, res) => {

    const sessionId =
      req.params.sessionId;

    const session =
      sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({
        error: "Session not found"
      });
    }

    session.lastUsedAt = Date.now();

    res.json(manifestForSession(req, sessionId));
    
  }
);


// ============================================================
// LIBRARY
// ============================================================

async function servePersonalLibrary(req, res, sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ metas: [], error: "Session not found" });
  }

  session.lastUsedAt = Date.now();

  const skip = Math.max(
    0,
    parseInt(req.query.skip || "0", 10) || 0
  );

  try {
    const library = (await datastoreGet(session.authKey))
      .filter(item => item && item.removed !== true && item.temp !== true)
      .map(item => ({
        ...item,
        __addedAt:
          item._ctime ||
          item.ctime ||
          item.createdAt ||
          item._mtime ||
          item.mtime ||
          null
      }))
      .sort((a, b) => {
        const ta = a.__addedAt ? Date.parse(a.__addedAt) : 0;
        const tb = b.__addedAt ? Date.parse(b.__addedAt) : 0;
        return tb - ta;
      })
      .map(normalizeItem)
      .filter(Boolean);

    const metas = library.map(item => {
      const meta = {
        id: item.id,
        type: item.type,
        name: item.name
      };

      for (const key of [
        "poster",
        "background",
        "logo",
        "year",
        "description"
      ]) {
        if (item[key] !== undefined) {
          meta[key] = item[key];
        }
      }

      return meta;
    });

    const page = metas.slice(skip, skip + 100);

    console.log(
      `Library served: ${library.length} total items, skip=${skip}, returned=${page.length}`
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res.json({ metas: page });
  } catch (error) {
    console.error("Library request failed:", error.message);

    res.status(502).json({
      metas: [],
      error: error.message
    });
  }
}


// ============================================================
// CATALOG ROUTES
// ============================================================

// Normal Stremio catalog URL:
// /catalog/movie/personal-library.json
app.get(
  "/u/:sessionId/catalog/:type/:id.json",
  async (req, res) => {

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    await servePersonalLibrary(
      req,
      res,
      req.params.sessionId
    );
  }
);


// Catalog URL when type is omitted:
// /catalog/personal-library.json
app.get(
  "/u/:sessionId/catalog/:id.json",
  async (req, res) => {

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    await servePersonalLibrary(
      req,
      res,
      req.params.sessionId
    );
  }
);


// IMPORTANT:
//
// When type="" Stremio can generate:
//
// /catalog//personal-library.json
//
// Express's normal :type route does not match the
// empty segment, so we catch this exact pattern here.

app.get(
  /^\/u\/([^/]+)\/catalog\/(?:[^/]*\/)?([^/]+)\.json$/,
  async (req, res) => {

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const sessionId = req.params[0];
    const catalogId = req.params[1];

    console.log(
      `Catalog request received: session=${sessionId.slice(0, 8)}..., catalog=${catalogId}`
    );

    await servePersonalLibrary(
      req,
      res,
      sessionId
    );
  }
);


// ============================================================
// HEALTH
// ============================================================

app.get(
  "/api/health",
  (_req, res) => {

    res.json({
      ok: true,
      service: "stremio-personal-setup",
      sessions: sessions.size
    });
  }
);


// ============================================================
// SESSION CLEANUP
// ============================================================

setInterval(() => {

  const now = Date.now();

  for (
    const [id, session]
    of sessions
  ) {

    if (
      now - session.lastUsedAt >
      30 * 24 * 60 * 60 * 1000
    ) {
      sessions.delete(id);
    }
  }

}, 60 * 60 * 1000).unref();


// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  () => {

    console.log(
      `Stremio Personal Setup v0.6 running on http://localhost:${PORT}`
    );
  }
);