const crypto = require("crypto");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { uploadBufferToDrive } = require("../google/driveUpload");
const { getSupabaseAdminClient } = require("../supabaseClient");

const parseBool = (val, fallback) => {
  if (typeof val === "undefined" || val === null) return fallback;
  const s = String(val).toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return fallback;
};

const envNumber = (primary, fallbackName, defaultVal) => {
  const raw = typeof process.env[primary] !== "undefined" ? process.env[primary] : process.env[fallbackName];
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : defaultVal;
};

const IMAP_STEP_TIMEOUT_MS = envNumber("EMAIL_IMAP_STEP_TIMEOUT_MS", "IMAP_STEP_TIMEOUT_MS", 10000);
const IMAP_SOCKET_TIMEOUT_MS = envNumber("EMAIL_IMAP_SOCKET_TIMEOUT_MS", "IMAP_SOCKET_TIMEOUT_MS", 300000);
const IMAP_GREETING_TIMEOUT_MS = envNumber("EMAIL_IMAP_GREETING_TIMEOUT_MS", "IMAP_GREETING_TIMEOUT_MS", 60000);
const IMAP_AUTH_TIMEOUT_MS = envNumber("EMAIL_IMAP_AUTH_TIMEOUT_MS", "IMAP_AUTH_TIMEOUT_MS", 120000);
const FETCH_SOURCE_TIMEOUT_MS = envNumber("EMAIL_IMAP_SOURCE_TIMEOUT_MS", "IMAP_SOURCE_TIMEOUT_MS", 120000);
const DEFAULT_UID_SCAN_LIMIT = envNumber("EMAIL_IMAP_UID_SCAN_LIMIT", "IMAP_UID_SCAN_LIMIT", 100);
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const getEnv = () => {
  const host = process.env.EMAIL_IMAP_HOST || process.env.IMAP_HOST || "";
  const port = Number(process.env.EMAIL_IMAP_PORT || process.env.IMAP_PORT || 993);
  const secure = parseBool(process.env.EMAIL_IMAP_SECURE ?? process.env.IMAP_SECURE, true);
  const user = process.env.EMAIL_IMAP_USER || process.env.IMAP_USER || "";
  const pass = process.env.EMAIL_IMAP_PASS || process.env.IMAP_PASS || "";
  const mailbox = process.env.EMAIL_IMAP_MAILBOX || process.env.IMAP_MAILBOX || "INBOX";
  const enabled = (process.env.EMAIL_INGEST_ENABLED || "0").toLowerCase();
  const mode = (process.env.EMAIL_INGEST_MODE || "discover").toLowerCase();
  return { host, port, secure, user, pass, mailbox, enabled, mode };
};

const getMailbox = () => getEnv().mailbox;

const shouldProcess = () => {
  const { enabled, mode } = getEnv();
  const isEnabled = enabled === "1" || enabled === "true";
  return isEnabled && mode === "process";
};

const hashBuffer = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const withTimeout = (promise, ms, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label || "Operation"} timed out`);
      err.code = "ETIMEOUT";
      reject(err);
    }, ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });

const processOneInvoiceEmail = async () => {
  const result = { processed: 0, skipped: 0, invoice_ids: [], errors: [] };
  if (!shouldProcess()) {
    result.errors.push("Email ingest not enabled or not in process mode");
    result.not_enabled = true;
    return result;
  }

    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      result.errors.push("Supabase not configured");
      return result;
    }

  const { host, port, secure, user, pass, mailbox } = getEnv();
  const makeClient = () =>
    new ImapFlow({
      host,
      port,
      secure,
      auth: { user, pass },
      logger: false,
      socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
      greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
      authTimeout: IMAP_AUTH_TIMEOUT_MS,
      disableAutoIdle: true,
      keepalive: false,
      tls: { servername: host },
    });

  const tryProcess = async () => {
    const client = makeClient();
    try {
      await withTimeout(client.connect(), IMAP_STEP_TIMEOUT_MS, "IMAP connect");
      await withTimeout(client.mailboxOpen(mailbox, { readOnly: true }), IMAP_STEP_TIMEOUT_MS, "Open mailbox");
      console.log("IMAP connect ok");

      const allUids = await withTimeout(client.search({}), IMAP_STEP_TIMEOUT_MS, "List messages");
      const recentUids = (allUids || []).slice(-50).reverse();
      if (!recentUids || recentUids.length === 0) {
        result.skipped += 1;
        return result;
      }
      let uid = null;
      let rawSource = null;
      let parsed = null;
      for (const candidateUid of recentUids) {
        const envelopeIterator = client.fetch({ uid: candidateUid }, { envelope: true, bodyStructure: true });
        const envelopeFetched = await withTimeout(envelopeIterator.next(), IMAP_STEP_TIMEOUT_MS, "IMAP fetch envelope");
        if (!envelopeFetched || !envelopeFetched.value || !envelopeFetched.value.envelope) continue;
        const msgId = envelopeFetched.value.envelope?.messageId || "";
        const { data: existingMsg, error: existingMsgErr } = await supabase
          .from("processed_emails")
          .select("id")
          .or(`message_id.eq.${msgId || ""},imap_uid.eq.${candidateUid}`)
          .eq("mailbox", mailbox)
          .limit(1);
        if (existingMsgErr) throw existingMsgErr;
        if (existingMsg && existingMsg.length) {
          continue;
        }
        const fetchSourceOnce = async () => {
          const sourceIterator = client.fetch({ uid: candidateUid }, { source: true });
          const timeoutPromise = new Promise((_, reject) => {
            const t = setTimeout(() => {
              const err = new Error("IMAP fetch timed out");
              err.code = "ETIMEOUT";
              clearTimeout(t);
              reject(err);
            }, FETCH_SOURCE_TIMEOUT_MS);
          });
          return Promise.race([sourceIterator.next(), timeoutPromise]);
        };
        let fetchedSource = null;
        let fetchAttempt = 0;
        while (fetchAttempt < 2) {
          try {
            fetchedSource = await fetchSourceOnce();
            break;
          } catch (err) {
            if (err?.code === "ETIMEOUT" && fetchAttempt === 0) {
              try {
                await withTimeout(client.logout(), IMAP_STEP_TIMEOUT_MS, "IMAP logout after timeout");
              } catch (_) {
                /* noop */
              }
              try {
                await withTimeout(client.connect(), IMAP_STEP_TIMEOUT_MS, "IMAP reconnect");
                await withTimeout(client.mailboxOpen(mailbox, { readOnly: true }), IMAP_STEP_TIMEOUT_MS, "Open mailbox");
                console.log("IMAP reconnect ok");
              } catch (reconnectErr) {
                throw reconnectErr;
              }
              fetchAttempt += 1;
              continue;
            }
            throw err;
          }
        }
        if (!fetchedSource || !fetchedSource.value || !fetchedSource.value.source) {
          throw Object.assign(new Error("IMAP fetch failed"), { code: "ETIMEOUT" });
        }
        const parsedCandidate = await simpleParser(fetchedSource.value.source);
        const attachmentsCandidate = (parsedCandidate.attachments || []).filter((att) => {
          const ct = (att.contentType || "").toLowerCase();
          return ct === "application/pdf" || ct.startsWith("image/");
        });
        if (!attachmentsCandidate.length) {
          continue;
        }
        uid = candidateUid;
        rawSource = fetchedSource.value.source;
        parsed = parsedCandidate;
        console.log(`Fetched message ${msgId || "(no-id)"}`);
        break;
      }
      if (!uid || !rawSource || !parsed) {
        result.skipped += 1;
        console.log(`[email][batch] uid=${uid || "n/a"} skip_reason=no_attachments`);
        return result;
      }
      const attachments = (parsed.attachments || []).filter((att) => {
        const ct = (att.contentType || "").toLowerCase();
        return ct === "application/pdf" || ct.startsWith("image/");
      });
      console.log(`Parsed attachments count=${attachments.length}`);

      let attachmentIndex = 0;
      for (const att of attachments) {
        let invoice = null;
        let driveUpload = null;
        let file_hash = null;
        const msgId = parsed.messageId || "";
        try {
          file_hash = hashBuffer(att.content);
          const { data: existingProcessed, error: existingErr } = await supabase
            .from("processed_emails")
            .select("id")
            .eq("mailbox", mailbox)
            .eq("message_id", msgId)
            .eq("attachment_index", attachmentIndex)
            .limit(1);
          if (existingErr) throw existingErr;
          if (existingProcessed && existingProcessed.length) {
            result.skipped += 1;
            attachmentIndex += 1;
            continue;
          }
          const { data: duplicateFiles, error: dupErr } = await supabase
            .from("files")
            .select("id, owner_id, drive_file_id")
            .eq("owner_type", "invoice")
            .eq("file_hash", file_hash)
            .limit(1);
          if (dupErr) throw dupErr;
          if (duplicateFiles && duplicateFiles.length) {
            const existing = duplicateFiles[0];
            const { error: procDupErr } = await supabase.from("processed_emails").insert({
              mailbox,
              imap_uid: uid,
              message_id: msgId,
              attachment_index: attachmentIndex,
              file_hash,
              drive_file_id: existing.drive_file_id || null,
              invoice_id: existing.owner_id || null,
              status: "duplicate",
              error: null,
            });
            if (procDupErr) throw procDupErr;
            result.skipped += 1;
            if (existing.owner_id) {
              result.invoice_ids.push(existing.owner_id);
            }
            attachmentIndex += 1;
            continue;
          }

          console.log(`Uploading to Drive filename=${att.filename || "email-attachment"}`);
          driveUpload = await uploadBufferToDrive({
            buffer: att.content,
            mimeType: att.contentType,
            name: att.filename || "email-attachment",
          });

          const now = new Date().toISOString();
          const { data: invoiceInsert, error: invErr } = await supabase
            .from("invoices")
            .insert({
              doc_type: "invoice",
              source: "Email",
              needs_review: true,
              archived: false,
              file_ref: `gdrive:${driveUpload.drive_file_id}`,
              file_kind: "gdrive",
              notes: `From: ${parsed.from?.text || ""}; Subject: ${parsed.subject || ""}`,
              created_at: now,
              updated_at: now,
            })
            .select("*")
            .single();
          if (invErr) throw invErr;
          invoice = invoiceInsert;
          console.log(`Inserted invoice id=${invoice.id}`);

          const { error: fileErr } = await supabase
            .from("files")
            .upsert(
              {
                owner_type: "invoice",
                owner_id: invoice.id,
                drive_file_id: driveUpload.drive_file_id,
                web_view_link: driveUpload.webViewLink,
                file_ref: `gdrive:${driveUpload.drive_file_id}`,
                file_hash,
                original_filename: att.filename || null,
                mime_type: att.contentType || null,
                created_at: now,
                updated_at: now,
              },
              { onConflict: "owner_type,owner_id" }
            );
          if (fileErr) throw fileErr;
          console.log(`Upserted files owner_id=${invoice.id}`);

          const { error: procErr } = await supabase.from("processed_emails").insert({
            mailbox,
            imap_uid: uid,
            message_id: msgId,
            attachment_index: attachmentIndex,
            file_hash,
            drive_file_id: driveUpload.drive_file_id,
            invoice_id: invoice.id,
            status: "processed",
            error: null,
          });
          if (procErr) throw procErr;
          console.log("Recorded processed_emails");

          result.processed += 1;
          result.invoice_ids.push(invoice.id);
        } catch (err) {
          if (err?.code === "23505") {
            try {
              const { data: dupExisting } = await supabase
                .from("files")
                .select("owner_id, drive_file_id")
                .eq("owner_type", "invoice")
                .eq("file_hash", file_hash)
                .limit(1);
              const existing = dupExisting && dupExisting.length ? dupExisting[0] : null;
              if (existing) {
                result.invoice_ids.push(existing.owner_id);
              } else if (invoice?.id) {
                result.invoice_ids.push(invoice.id);
              }
              await supabase.from("processed_emails").insert({
                mailbox,
                imap_uid: uid,
                message_id: msgId,
                attachment_index: attachmentIndex,
                file_hash,
                drive_file_id: existing?.drive_file_id || driveUpload?.drive_file_id || null,
                invoice_id: existing?.owner_id || invoice?.id || null,
                status: "duplicate",
                error: null,
              });
            } catch (_) {
              /* noop */
            }
            result.skipped += 1;
            attachmentIndex += 1;
            continue;
          }
          console.error("Email attachment processing failed", err);
          result.errors.push(err.message || String(err));
        }
        attachmentIndex += 1;
      }
    } finally {
      try {
        await withTimeout(client.logout(), IMAP_STEP_TIMEOUT_MS, "IMAP logout");
      } catch (_) {
        /* noop */
      }
    }
  };

  try {
    await tryProcess();
  } catch (err) {
    if (err?.code === "ETIMEOUT") {
      return { processed: 0, skipped: 0, invoice_ids: [], errors: ["IMAP timeout"] };
    }
    console.error("Email processing failed", err);
    result.errors.push(err.message || String(err));
  }

  return result;
};

module.exports = { processOneInvoiceEmail, getMailbox };

const buildClient = () => {
  const { host, port, secure, user, pass } = getEnv();
  return new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: false,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
    authTimeout: IMAP_AUTH_TIMEOUT_MS,
    disableAutoIdle: true,
    keepalive: false,
    tls: { servername: host },
  });
};

const fetchSourceWithRetry = async ({ client, uid, mailbox, maxAttempts = 2 }) => {
  const doFetch = async (imapClient) => {
    const sourceIterator = imapClient.fetch({ uid }, { source: true });
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error("IMAP fetch timed out");
        err.code = "ETIMEOUT";
        clearTimeout(timer);
        reject(err);
      }, FETCH_SOURCE_TIMEOUT_MS);
    });
    return Promise.race([sourceIterator.next(), timeoutPromise]).finally(() => clearTimeout(timer));
  };
  try {
    return await doFetch(client);
  } catch (err) {
    if (err?.code !== "ETIMEOUT" || maxAttempts <= 1) throw err;
    try {
      await withTimeout(client.logout(), IMAP_STEP_TIMEOUT_MS, "IMAP logout after timeout");
    } catch (_) {
      /* noop */
    }
    const reconnectClient = buildClient();
    await withTimeout(reconnectClient.connect(), IMAP_STEP_TIMEOUT_MS, "IMAP reconnect");
    await withTimeout(reconnectClient.mailboxOpen(mailbox, { readOnly: true }), IMAP_STEP_TIMEOUT_MS, "Open mailbox");
    try {
      const res = await doFetch(reconnectClient);
      await withTimeout(reconnectClient.logout(), IMAP_STEP_TIMEOUT_MS, "IMAP logout");
      return res;
    } catch (err2) {
      try {
        await withTimeout(reconnectClient.logout(), IMAP_STEP_TIMEOUT_MS, "IMAP logout");
      } catch (_) {
        /* noop */
      }
      throw err2;
    }
  }
};

const processAttachmentsForMessage = async ({ supabase, parsed, mailbox, uid, resultRef }) => {
  const attachments = (parsed.attachments || []).filter((att) => {
    const ct = (att.contentType || "").toLowerCase();
    return ct === "application/pdf" || ct.startsWith("image/");
  });
  if (!attachments.length) {
    resultRef.skipped += 1;
    console.log(`[email][batch] uid=${uid} skip_reason=no_attachments`);
    return;
  }
  let attachmentIndex = 0;
  for (const att of attachments) {
    let invoice = null;
    let driveUpload = null;
    let file_hash = null;
    const msgId = parsed.messageId || "";
    try {
      file_hash = hashBuffer(att.content);
      const { data: existingProcessed, error: existingErr } = await supabase
        .from("processed_emails")
        .select("id")
        .eq("mailbox", mailbox)
        .eq("message_id", msgId)
        .eq("attachment_index", attachmentIndex)
        .limit(1);
      if (existingErr) throw existingErr;
      if (existingProcessed && existingProcessed.length) {
        resultRef.skipped += 1;
        console.log(`[email][batch] uid=${uid} skip_reason=already_processed_attachment`);
        attachmentIndex += 1;
        continue;
      }
      const { data: duplicateFiles, error: dupErr } = await supabase
        .from("files")
        .select("id, owner_id, drive_file_id")
        .eq("owner_type", "invoice")
        .eq("file_hash", file_hash)
        .limit(1);
      if (dupErr) throw dupErr;
      if (duplicateFiles && duplicateFiles.length) {
        const existing = duplicateFiles[0];
        const { error: procDupErr } = await supabase.from("processed_emails").insert({
          mailbox,
          imap_uid: uid,
          message_id: msgId,
          attachment_index: attachmentIndex,
          file_hash,
          drive_file_id: existing.drive_file_id || null,
          invoice_id: existing.owner_id || null,
          status: "duplicate",
          error: null,
        });
        if (procDupErr) throw procDupErr;
        resultRef.skipped += 1;
        console.log(`[email][batch] uid=${uid} skip_reason=duplicate_file_hash`);
        if (existing.owner_id) {
          resultRef.invoice_ids.push(existing.owner_id);
        }
        attachmentIndex += 1;
        continue;
      }

      console.log(`Uploading to Drive filename=${att.filename || "email-attachment"}`);
      driveUpload = await uploadBufferToDrive({
        buffer: att.content,
        mimeType: att.contentType,
        name: att.filename || "email-attachment",
      });

      const now = new Date().toISOString();
      const { data: invoiceInsert, error: invErr } = await supabase
        .from("invoices")
        .insert({
          doc_type: "invoice",
          source: "Email",
          needs_review: true,
          archived: false,
          file_ref: `gdrive:${driveUpload.drive_file_id}`,
          file_kind: "gdrive",
          notes: `From: ${parsed.from?.text || ""}; Subject: ${parsed.subject || ""}`,
          created_at: now,
          updated_at: now,
        })
        .select("*")
        .single();
      if (invErr) throw invErr;
      invoice = invoiceInsert;
      console.log(`Inserted invoice id=${invoice.id}`);

      const { error: fileErr } = await supabase
        .from("files")
        .upsert(
          {
            owner_type: "invoice",
            owner_id: invoice.id,
            drive_file_id: driveUpload.drive_file_id,
            web_view_link: driveUpload.webViewLink,
            file_ref: `gdrive:${driveUpload.drive_file_id}`,
            file_hash,
            original_filename: att.filename || null,
            mime_type: att.contentType || null,
            created_at: now,
            updated_at: now,
          },
          { onConflict: "owner_type,owner_id" }
        );
      if (fileErr) throw fileErr;
      console.log(`Upserted files owner_id=${invoice.id}`);

      const { error: procErr } = await supabase.from("processed_emails").insert({
        mailbox,
        imap_uid: uid,
        message_id: msgId,
        attachment_index: attachmentIndex,
        file_hash,
        drive_file_id: driveUpload.drive_file_id,
        invoice_id: invoice.id,
        status: "processed",
        error: null,
      });
      if (procErr) throw procErr;
      console.log("Recorded processed_emails");

      resultRef.processed += 1;
      resultRef.invoice_ids.push(invoice.id);
    } catch (err) {
      if (err?.code === "23505") {
        try {
          const { data: dupExisting } = await supabase
            .from("files")
            .select("owner_id, drive_file_id")
            .eq("owner_type", "invoice")
            .eq("file_hash", file_hash)
            .limit(1);
          const existing = dupExisting && dupExisting.length ? dupExisting[0] : null;
          if (existing) {
            resultRef.invoice_ids.push(existing.owner_id);
          } else if (invoice?.id) {
            resultRef.invoice_ids.push(invoice.id);
          }
          await supabase.from("processed_emails").insert({
            mailbox,
            imap_uid: uid,
            message_id: parsed.messageId || "",
            attachment_index: attachmentIndex,
            file_hash,
            drive_file_id: existing?.drive_file_id || driveUpload?.drive_file_id || null,
            invoice_id: existing?.owner_id || invoice?.id || null,
            status: "duplicate",
            error: null,
          });
        } catch (_) {
          /* noop */
        }
        resultRef.skipped += 1;
        attachmentIndex += 1;
        continue;
      }
      console.error("Email attachment processing failed", err);
      resultRef.errors.push(err.message || String(err));
    }
    attachmentIndex += 1;
  }
};

const collectAttachmentParts = (node, acc = [], pathPrefix = "") => {
  if (!node) return acc;
  const mime = node.type && node.subtype ? `${node.type}/${node.subtype}` : node.type || "";
  const disposition = node.disposition?.type ? node.disposition.type.toLowerCase() : "";
  const isLeaf = !Array.isArray(node.childNodes) || node.childNodes.length === 0;
  const filename = node.disposition?.params?.filename || node.parameters?.name || node.filename || "";
  const lowerName = filename.toLowerCase();
  const hasPdfExt = lowerName.endsWith(".pdf");
  const hasImageExt = lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || lowerName.endsWith(".png");
  const isAttachmentByMime = mime && (mime === "application/pdf" || mime.startsWith("image/"));
  const isInlineCandidate = disposition === "inline" && (hasPdfExt || hasImageExt);
  const isAttachment = (disposition === "attachment" || isLeaf || isInlineCandidate) && (isAttachmentByMime || hasPdfExt || hasImageExt);
  if (isAttachment && node.partID) {
    acc.push({
      partID: node.partID,
      mime,
      filename,
      size: node.size || null,
    });
  }
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child) => collectAttachmentParts(child, acc, pathPrefix));
  }
  return acc;
};

const choosePreferredPart = (parts) => {
  if (!Array.isArray(parts) || !parts.length) return null;
  const normaliseName = (p) =>
    p.filename ||
    p.name ||
    p.disposition_filename ||
    p.parameters?.name ||
    p.parameters?.filename ||
    "";
  const hasPdfExt = (name) => (name || "").toLowerCase().endsWith(".pdf");
  const hasImageExt = (name) => {
    const lower = (name || "").toLowerCase();
    return lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png");
  };
  const annotate = (p) => {
    const nameGuess = normaliseName(p);
    const mimeLower = (p.mime || "").toLowerCase();
    const pdfMime = mimeLower === "application/pdf";
    const imgMime = mimeLower.startsWith("image/");
    const pdfExt = hasPdfExt(nameGuess);
    const imgExt = hasImageExt(nameGuess);
    return { ...p, nameGuess, pdfMime, imgMime, pdfExt, imgExt };
  };
  const annotated = parts.map(annotate);
  const byPdf = annotated.find((p) => p.pdfMime || p.pdfExt);
  if (byPdf) return { ...byPdf, kind: "pdf", via: byPdf.pdfMime ? "mime" : "filename" };
  const byImage = annotated.find((p) => p.imgMime || p.imgExt);
  if (byImage) return { ...byImage, kind: "image", via: byImage.imgMime ? "mime" : "filename" };
  return null;
};

const collectPartsSummary = (node, acc = [], path = "1") => {
  if (!node) return acc;
  const mime = node.type && node.subtype ? `${node.type}/${node.subtype}` : node.type || undefined;
  const disposition_type = node.disposition?.type || null;
  const filename = node.disposition?.params?.filename || node.parameters?.name || node.filename || "";
  const size = node.size || null;
  const is_leaf = !Array.isArray(node.childNodes) || node.childNodes.length === 0;
  acc.push({ path, mime, disposition_type, filename, size, is_leaf });
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child, idx) => {
      collectPartsSummary(child, acc, `${path}.${idx + 1}`);
    });
  }
  return acc;
};

const downloadPartToBuffer = async ({ client, uid, partID }) => {
  const downloadRes = await client.download(uid, partID, { uid: true, maxBytes: MAX_ATTACHMENT_BYTES });
  const stream = downloadRes.content;
  const chunks = [];
  try {
    const buf = await withTimeout(
      new Promise((resolve, reject) => {
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.once("error", reject);
        stream.once("end", () => resolve(Buffer.concat(chunks)));
      }),
      FETCH_SOURCE_TIMEOUT_MS,
      "IMAP attachment download"
    );
    return buf;
  } catch (err) {
    try {
      stream.destroy();
    } catch (_) {
      /* noop */
    }
    throw err;
  }
};

const processMailboxBatch = async ({
  supabaseAdmin,
  mailbox = null,
  scan_limit = null,
  max_messages = 1,
  max_wall_ms = 300000,
  cursor_uid = null,
}) => {
  const supabase = supabaseAdmin || getSupabaseAdminClient();
  const envMailbox = mailbox || getEnv().mailbox;
  const scanCap = scan_limit || DEFAULT_UID_SCAN_LIMIT;
  if (!supabase) return { ok: false, error: "Supabase not configured", mailbox: envMailbox };
  const start = Date.now();
  const result = {
    ok: true,
    mailbox: envMailbox,
    attempted: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    new_last_uid: null,
    errors: [],
    invoice_ids: [],
  };
  const client = buildClient();
  try {
    await withTimeout(client.connect(), IMAP_STEP_TIMEOUT_MS, "IMAP connect");
    await withTimeout(client.mailboxOpen(envMailbox, { readOnly: true }), IMAP_STEP_TIMEOUT_MS, "Open mailbox");
    const allUids = await withTimeout(client.search({}), IMAP_STEP_TIMEOUT_MS, "List messages");
    const uidsAsc = (allUids || []).slice(-Math.max(scanCap, 0));
    let ordered = [];
    if (cursor_uid !== null && typeof cursor_uid !== "undefined") {
      ordered = uidsAsc.filter((u) => u > cursor_uid).sort((a, b) => b - a).slice(0, scanCap);
    } else {
      ordered = [...uidsAsc].sort((a, b) => b - a);
    }
    for (const uid of ordered) {
      if (Date.now() - start > max_wall_ms) break;
      if (result.attempted >= max_messages) break;
      result.attempted += 1;
      result.new_last_uid = result.new_last_uid ? Math.max(result.new_last_uid, uid) : uid; // tracks highest attempted UID
      try {
        console.log(`[email][batch] uid=${uid} stage=before_envelope`);
        const envelopeFetched = await withTimeout(
          client.fetchOne(uid, { uid: true, envelope: true, bodyStructure: true }),
          IMAP_STEP_TIMEOUT_MS,
          "IMAP fetch envelope"
        );
        console.log(`[email][batch] uid=${uid} stage=after_envelope`);
        if (!envelopeFetched || !envelopeFetched.envelope) {
          result.failed += 1;
          result.errors.push("Missing envelope");
          break;
        }
        const msgId = envelopeFetched.envelope?.messageId || "";
        const { data: existingMsg, error: existingMsgErr } = await supabase
          .from("processed_emails")
          .select("id")
          .or(`message_id.eq.${msgId || ""},imap_uid.eq.${uid}`)
          .eq("mailbox", envMailbox)
          .limit(1);
        if (existingMsgErr) throw existingMsgErr;
        if (existingMsg && existingMsg.length) {
          result.skipped += 1;
          console.log(`[email][batch] uid=${uid} skip_reason=already_processed`);
          continue;
        }
        const parts = collectAttachmentParts(envelopeFetched.bodyStructure, [], "");
        let preferred = choosePreferredPart(parts);
        if (!preferred || !preferred.partID) {
          const summary = collectPartsSummary(envelopeFetched.bodyStructure, [], "1");
          let hasCandidate = false;
          (summary || []).slice(0, 12).forEach((p) => {
            const hasName = Boolean(p.filename);
            const lower = (p.filename || "").toLowerCase();
            const pdfExt = lower.endsWith(".pdf");
            const imgExt = lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png");
            const mimeLower = (p.mime || "").toLowerCase();
            const pdfMime = mimeLower === "application/pdf";
            const imgMime = mimeLower.startsWith("image/");
            if (p.is_leaf && (pdfMime || pdfExt || imgMime || imgExt)) {
              hasCandidate = true;
            }
            console.log(
              `[email][batch] uid=${uid} part=${p.path || "na"} mime=${p.mime || "na"} disp=${
                p.disposition_type || "na"
              } leaf=${p.is_leaf ? "1" : "0"} hasName=${hasName ? "1" : "0"} pdfMime=${pdfMime ? "1" : "0"} pdfExt=${
                pdfExt ? "1" : "0"
              } imgMime=${imgMime ? "1" : "0"} imgExt=${imgExt ? "1" : "0"}`
            );
          });
          if (!hasCandidate) {
            result.skipped += 1;
            const bodyStructure = envelopeFetched.bodyStructure;
            console.log(
              `[email][batch] uid=${uid} bs_present=${!!bodyStructure} bs_keys=${
                bodyStructure ? Object.keys(bodyStructure).length : 0
              } bs_children=${bodyStructure?.childNodes?.length ?? bodyStructure?.children?.length ?? 0}`
            );
            console.log(`[email][batch] uid=${uid} skip_reason=no_pdf_or_image`);
            continue;
          }
          preferred = choosePreferredPart(summary.map((p) => ({ ...p, partID: p.path, mime: p.mime, filename: p.filename })));
          if (!preferred || !preferred.partID) {
            result.skipped += 1;
            const bodyStructure = envelopeFetched.bodyStructure;
            console.log(
              `[email][batch] uid=${uid} bs_present=${!!bodyStructure} bs_keys=${
                bodyStructure ? Object.keys(bodyStructure).length : 0
              } bs_children=${bodyStructure?.childNodes?.length ?? bodyStructure?.children?.length ?? 0}`
            );
            console.log(`[email][batch] uid=${uid} skip_reason=no_pdf_or_image`);
            continue;
          }
        }
        let buffer = null;
        try {
          console.log(`[email][batch] uid=${uid} stage=before_download`);
          buffer = await downloadPartToBuffer({ client, uid, partID: preferred.partID });
          console.log(`[email][batch] uid=${uid} stage=after_download`);
        } catch (err) {
          const isTimeout = err?.code === "ETIMEOUT" || String(err.message || "").toLowerCase().includes("timeout");
          if (isTimeout) {
            console.log(`[email][batch] uid=${uid} stage=timeout_download`);
          }
          result.failed += 1;
          result.errors.push(err.message || "IMAP download failed");
          break;
        }
        const parsedCandidate = {
          messageId: msgId,
          from: {
            text: envelopeFetched.envelope?.from?.map((a) => a.address).filter(Boolean).join(", ") || "",
          },
          subject: envelopeFetched.envelope?.subject || "",
          attachments: [
            {
              content: buffer,
              contentType:
                preferred.kind === "pdf"
                  ? "application/pdf"
                  : (preferred.mime || "").toLowerCase().startsWith("image/")
                  ? preferred.mime
                  : "image/jpeg",
              filename: preferred.filename || null,
              size: preferred.size || buffer.length,
            },
          ],
        };
        console.log(
          `[email][batch] uid=${uid} picked_part=${preferred.partID} kind=${preferred.kind || "unknown"} via=${
            preferred.via || "unknown"
          }`
        );
        await processAttachmentsForMessage({
          supabase,
          parsed: parsedCandidate,
          mailbox: envMailbox,
          uid,
          resultRef: result,
        });
      } catch (err) {
        if (err?.code === "ETIMEOUT") {
          result.failed += 1;
          result.errors.push("IMAP timeout");
          break;
        }
        result.failed += 1;
        result.errors.push(err.message || String(err));
        break;
      }
    }
  } catch (err) {
    if (err?.code === "ETIMEOUT") {
      return { ok: false, error: "IMAP timeout", mailbox: envMailbox };
    }
    return { ok: false, error: err.message || String(err), mailbox: envMailbox };
  } finally {
    try {
      await withTimeout(client.logout(), IMAP_STEP_TIMEOUT_MS, "IMAP logout");
    } catch (_) {
      /* noop */
    }
  }
  return result;
};

module.exports.processMailboxBatch = processMailboxBatch;
