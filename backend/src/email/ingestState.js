// Minimal helpers for persisted ingest state
const TABLE = "email_ingest_state";
const BACKOFF_MINUTES = [5, 15, 30, 60];

const getIngestState = async ({ supabaseAdmin, mailbox }) => {
  if (!supabaseAdmin || !mailbox) return { ok: false, error: "Missing supabase client or mailbox" };
  try {
    const { data, error } = await supabaseAdmin.from(TABLE).select("*").eq("mailbox", mailbox).limit(1);
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true, data: data && data.length ? data[0] : null };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
};

const upsertIngestState = async ({ supabaseAdmin, mailbox, last_uid, next_retry_at, attempts, last_error }) => {
  if (!supabaseAdmin || !mailbox) return { ok: false, error: "Missing supabase client or mailbox" };
  try {
    const payload = {
      mailbox,
      last_uid: typeof last_uid === "number" ? last_uid : last_uid || null,
      next_retry_at: next_retry_at || null,
      attempts: typeof attempts === "number" ? attempts : attempts || 0,
      last_error: last_error || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseAdmin.from(TABLE).upsert(payload, { onConflict: "mailbox" });
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
};

const bumpIngestBackoff = async ({ supabaseAdmin, mailbox, errMessage }) => {
  if (!supabaseAdmin || !mailbox) return { ok: false, error: "Missing supabase client or mailbox" };
  try {
    const current = await getIngestState({ supabaseAdmin, mailbox });
    const attempts = current?.ok && current.data && typeof current.data.attempts === "number" ? current.data.attempts : 0;
    const nextAttempts = attempts + 1;
    const minutes = BACKOFF_MINUTES[Math.min(BACKOFF_MINUTES.length - 1, nextAttempts - 1)];
    const next_retry_at = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    return upsertIngestState({
      supabaseAdmin,
      mailbox,
      last_uid: current?.data?.last_uid || null,
      next_retry_at,
      attempts: nextAttempts,
      last_error: errMessage || null,
    });
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
};

const clearIngestBackoff = async ({ supabaseAdmin, mailbox, last_uid }) => {
  if (!supabaseAdmin || !mailbox) return { ok: false, error: "Missing supabase client or mailbox" };
  try {
    return upsertIngestState({
      supabaseAdmin,
      mailbox,
      last_uid: typeof last_uid === "number" ? last_uid : last_uid || null,
      next_retry_at: null,
      attempts: 0,
      last_error: null,
    });
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
};

module.exports = { getIngestState, upsertIngestState, bumpIngestBackoff, clearIngestBackoff };
