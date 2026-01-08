const fs = require("fs");
const { google } = require("googleapis");
const { getSupabaseAdminClient } = require("../supabaseClient");

const getStoredToken = async () => {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("google_tokens")
    .select("email, refresh_token")
    .eq("provider", "google_drive")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.refresh_token) {
    throw new Error("google_not_connected");
  }
  return data;
};

const createDriveClient = async () => {
  const refresh = await getStoredToken();
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || "";
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth env vars missing");
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refresh.refresh_token });
  const drive = google.drive({ version: "v3", auth: oauth2Client });
  return { drive, email: refresh.email };
};

const uploadFileToDrive = async ({ filePath, mimeType, name }) => {
  const folderId = process.env.GOOGLE_DRIVE_DOCS_FOLDER_ID;
  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_DOCS_FOLDER_ID missing");
  }

  const { drive } = await createDriveClient();
  const requestBody = {
    name,
    parents: [folderId],
  };
  const media = {
    mimeType,
    body: fs.createReadStream(filePath),
  };

  const res = await drive.files.create({
    requestBody,
    media,
    fields: "id, webViewLink, mimeType, name",
    supportsAllDrives: true,
  });

  return {
    drive_file_id: res.data.id,
    webViewLink: res.data.webViewLink,
    mimeType: res.data.mimeType,
    name: res.data.name,
  };
};

const { Readable } = require("stream");

const uploadBufferToDrive = async ({ buffer, mimeType, name }) => {
  const folderId = process.env.GOOGLE_DRIVE_DOCS_FOLDER_ID;
  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_DOCS_FOLDER_ID missing");
  }

  const { drive } = await createDriveClient();
  const bodyStream = Readable.from(buffer);
  const requestBody = {
    name,
    parents: [folderId],
  };
  const media = {
    mimeType,
    body: bodyStream,
  };

  const res = await drive.files.create({
    requestBody,
    media,
    fields: "id, webViewLink, mimeType, name",
    supportsAllDrives: true,
  });

  return {
    drive_file_id: res.data.id,
    webViewLink: res.data.webViewLink,
    mimeType: res.data.mimeType,
    name: res.data.name,
  };
};

module.exports = { uploadFileToDrive, uploadBufferToDrive };
