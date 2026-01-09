let josePromise;
const loadJose = async () => {
  if (!josePromise) josePromise = import("jose");
  return josePromise;
};

const getSupabaseIssuer = () => {
  const base = (process.env.SUPABASE_URL || "").replace(/\/+$|\s+$/g, "");
  if (!base) return null;
  return `${base}/auth/v1`;
};

let jwksClient = null;
const getJwks = async () => {
  if (jwksClient) return jwksClient;
  const issuer = getSupabaseIssuer();
  if (!issuer) return null;
  const { createRemoteJWKSet } = await loadJose();
  jwksClient = createRemoteJWKSet(new URL(`${issuer}/jwks`));
  return jwksClient;
};

const verifySupabaseJwt = async (token) => {
  const { jwtVerify } = await loadJose();
  const issuer = getSupabaseIssuer();
  const jwks = await getJwks();
  if (!issuer || !jwks) {
    throw new Error("supabase_not_configured");
  }

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: "authenticated",
  });

  return payload;
};

const checkAppKey = (req, res) => {
  const requireKeyRaw = String(process.env.APP_REQUIRE_KEY ?? "1");
  const keyRequired = !(requireKeyRaw === "0" || requireKeyRaw.toLowerCase() === "false");
  if (!keyRequired) return true;

  const expected = (process.env.APP_SHARED_SECRET || "").trim();
  if (!expected) {
    res.status(500).json({ error: "Server missing APP_SHARED_SECRET" });
    return false;
  }

  const provided = (req.get("x-app-key") || "").trim();
  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
};

const requireAuthFlexible = async (req, res, next) => {
  const authHeader = req.get("authorization") || req.get("Authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;

  if (token) {
    try {
      const claims = await verifySupabaseJwt(token);
      req.user = claims;
      return next();
    } catch (_err) {
      // Fall through to app key check
    }
  }

  if (checkAppKey(req, res)) {
    return next();
  }
};

const requireAuth = async (req, res, next) => {
  const authHeader = req.get("authorization") || req.get("Authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const claims = await verifySupabaseJwt(token);
    req.user = claims;
    return next();
  } catch (err) {
    const code = err?.code || err?.message;
    console.warn("Auth failed", code || err);
    return res.status(401).json({ error: "Unauthorized" });
  }
};

module.exports = { requireAuthFlexible, requireAuth, verifySupabaseJwt };
