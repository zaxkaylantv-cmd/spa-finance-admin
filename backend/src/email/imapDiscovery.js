const { ImapFlow } = require("imapflow");
const { getSupabaseAdminClient } = require("../supabaseClient");

const lastState = {
  enabled: false,
  imap_host: null,
  imap_port: null,
  imap_secure: null,
  mailbox: null,
  unseen_count: 0,
  sample_messages: [],
  last_run_at: null,
  last_error: null,
  processed_count_24h: 0,
};

const isEnabled = () => {
  const flag = (process.env.EMAIL_INGEST_ENABLED || "0").toLowerCase();
  return flag === "1" || flag === "true";
};

const getEnvConfig = () => {
  const host = process.env.EMAIL_IMAP_HOST || "";
  const port = Number(process.env.EMAIL_IMAP_PORT || 993);
  const secure = (process.env.EMAIL_IMAP_SECURE || "true").toLowerCase() !== "false";
  const user = process.env.EMAIL_IMAP_USER || "";
  const pass = process.env.EMAIL_IMAP_PASS || "";
  const mailbox = process.env.EMAIL_IMAP_MAILBOX || "INBOX";
  const pollSeconds = Number(process.env.EMAIL_INGEST_POLL_SECONDS || 120);
  return { host, port, secure, user, pass, mailbox, pollSeconds: Math.max(pollSeconds, 30) };
};

const extractAttachments = (bodyStructure) => {
  const attachments = [];
  const walk = (node) => {
    if (!node) return;
    const mime = node?.type ? (node.subtype ? `${node.type}/${node.subtype}` : node.type) : "";
    const disposition = node.disposition?.type ? node.disposition.type.toLowerCase() : null;
    const isLeaf = !Array.isArray(node.childNodes) || node.childNodes.length === 0;
    const isAttachment =
      disposition === "attachment" ||
      (isLeaf && mime && (mime === "application/pdf" || mime.startsWith("image/")));

    if (isAttachment) {
      attachments.push({
        filename: node.disposition?.params?.filename || node.parameters?.name || node.filename || "",
        mime,
        size: node.size || null,
      });
    }
    if (Array.isArray(node.childNodes)) {
      node.childNodes.forEach(walk);
    }
  };
  walk(bodyStructure);
  return attachments;
};

const collectPartsSummary = (bodyStructure, cap = 40) => {
  const parts = [];
  const walk = (node, path = "") => {
    if (!node || parts.length >= cap) return;
    const mime = node.type && node.subtype ? `${node.type}/${node.subtype}` : node.type || undefined;
    const disposition_type = node.disposition?.type || null;
    const filename = node.disposition?.params?.filename || node.parameters?.name || node.filename || "";
    const size = node.size || null;
    const is_leaf = !Array.isArray(node.childNodes) || node.childNodes.length === 0;
    parts.push({ path, mime, disposition_type, filename, size, is_leaf });
    if (Array.isArray(node.childNodes)) {
      node.childNodes.forEach((child, idx) => {
        if (parts.length < cap) {
          const childPath = path ? `${path}.${idx + 1}` : String(idx + 1);
          walk(child, childPath);
        }
      });
    }
  };
  walk(bodyStructure, "1");
  return parts;
};

const pollMailbox = async () => {
  if (!isEnabled()) {
    lastState.enabled = false;
    return;
  }

  const { host, port, secure, user, pass, mailbox } = getEnvConfig();
  lastState.enabled = true;
  lastState.imap_host = host;
  lastState.imap_port = port;
  lastState.imap_secure = secure;
  lastState.mailbox = mailbox;

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: false,
    socketTimeout: 120000,
    greetingTimeout: 30000,
    authTimeout: 60000,
    disableAutoIdle: true,
    tls: { servername: host },
  });

  try {
    await client.connect();
    await client.mailboxOpen(mailbox, { readOnly: true });

    const unseen = await client.search({ seen: false });
    lastState.unseen_count = Array.isArray(unseen) ? unseen.length : 0;

    const allUids = await client.search({});
    const sampleUids = (allUids || []).slice(-20);
    const sample = [];
    for await (const msg of client.fetch(sampleUids, { envelope: true, bodyStructure: true, source: false })) {
      const parts_summary = collectPartsSummary(msg.bodyStructure, 40);
      sample.push({
        date: msg.envelope?.date || null,
        from: msg.envelope?.from?.map((a) => a.address).join(", ") || null,
        subject: msg.envelope?.subject || null,
        message_id: msg.envelope?.messageId || null,
        attachments: extractAttachments(msg.bodyStructure),
        parts_summary,
      });
    }

    lastState.sample_messages = sample;
    lastState.last_run_at = new Date().toISOString();
    lastState.last_error = null;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const supabase = getSupabaseAdminClient();
    if (supabase) {
      const { data: procData, error: procErr } = await supabase
        .from("processed_emails")
        .select("id", { count: "exact", head: true })
        .eq("mailbox", mailbox)
        .gte("created_at", since);
      if (!procErr && typeof procData?.length === "number") {
        lastState.processed_count_24h = procData.length;
      }
    }
  } catch (err) {
    lastState.last_error = err.message || String(err);
  } finally {
    try {
      await client.logout();
    } catch (_) {
      /* noop */
    }
  }
};

const startEmailDiscoveryPoller = () => {
  const { pollSeconds } = getEnvConfig();
  const run = () => {
    pollMailbox().catch((err) => {
      lastState.last_error = err.message || String(err);
    });
  };
  run();
  setInterval(run, pollSeconds * 1000);
};

const getEmailDiscoveryStatus = () => ({ ...lastState });

module.exports = { startEmailDiscoveryPoller, getEmailDiscoveryStatus };
