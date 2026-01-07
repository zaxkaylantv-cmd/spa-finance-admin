const { google } = require("googleapis");
const crypto = require("crypto");
const { getSupabaseAdminClient } = require("../supabaseClient");

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

const stateStore = new Map();
const createState = () => {
  const state = crypto.randomBytes(16).toString("hex");
  stateStore.set(state, Date.now());
  return state;
};
const consumeState = (state) => {
  if (!stateStore.has(state)) return false;
  stateStore.delete(state);
  return true;
};

const requiredEnv = () => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || "";
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth env vars missing");
  }
  return { clientId, clientSecret, redirectUri };
};

const createOAuthClient = () => {
  const { clientId, clientSecret, redirectUri } = requiredEnv();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

const generateAuthUrl = () => {
  const oauth2Client = createOAuthClient();
  const state = createState();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
  return { url, state };
};

const exchangeCodeForTokens = async (code) => {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  return {
    tokens,
    email: data?.email || null,
  };
};

const saveRefreshToken = async ({ email, refresh_token }) => {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase not configured");
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("google_tokens")
    .upsert(
      { provider: "google_drive", email, refresh_token, updated_at: now },
      { onConflict: "provider" }
    );
  if (error) throw error;
  return { email, updated_at: now };
};

const getTokenStatus = async () => {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("google_tokens")
    .select("email, updated_at")
    .eq("provider", "google_drive")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { connected: false };
  return { connected: true, email: data.email, connected_at: data.updated_at };
};

module.exports = {
  generateAuthUrl,
  exchangeCodeForTokens,
  saveRefreshToken,
  getTokenStatus,
  consumeState,
};
