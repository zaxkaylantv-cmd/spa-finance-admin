const { getSupabaseAdminClient } = require("../supabaseClient");
const { getIngestState, bumpIngestBackoff, clearIngestBackoff, upsertIngestState } = require("./ingestState");
const { processMailboxBatch } = require("./processOnce");

const runIngestCycle = async ({ supabaseAdmin, mailbox }) => {
  const supabase = supabaseAdmin || getSupabaseAdminClient();
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const stateRes = await getIngestState({ supabaseAdmin: supabase, mailbox });
  if (!stateRes.ok) return { ok: false, error: stateRes.error || "Failed to read state" };
  const state_before = stateRes.data || { mailbox };
  const now = Date.now();
  if (state_before.next_retry_at && new Date(state_before.next_retry_at).getTime() > now) {
    return { ok: true, status: "backoff", state_before };
  }

  const batch = await processMailboxBatch({
    supabaseAdmin: supabase,
    mailbox,
    scan_limit: 100,
    max_messages: 2,
    max_wall_ms: 300000,
    cursor_uid: state_before.last_uid || null,
  });

  let state_after = state_before;
  const hasTimeout =
    !batch.ok ||
    (Array.isArray(batch.errors) && batch.errors.some((e) => typeof e === "string" && e.toLowerCase().includes("timeout"))) ||
    (batch.failed && batch.failed > 0);

  if (!batch.ok) {
    await bumpIngestBackoff({ supabaseAdmin: supabase, mailbox, errMessage: batch.error || "Batch failed" });
    const updated = await getIngestState({ supabaseAdmin: supabase, mailbox });
    state_after = updated.ok ? updated.data : state_before;
    return { ok: true, status: "backoff", batch, state_before, state_after };
  }

  if (hasTimeout) {
    await bumpIngestBackoff({
      supabaseAdmin: supabase,
      mailbox,
      errMessage: (batch.errors && batch.errors[0]) || "Batch timeout",
    });
    const updated = await getIngestState({ supabaseAdmin: supabase, mailbox });
    state_after = updated.ok ? updated.data : state_before;
    return { ok: true, status: "backoff", batch, state_before, state_after };
  }

  if ((batch.processed || 0) > 0 || (batch.skipped || 0) > 0) {
    await clearIngestBackoff({
      supabaseAdmin: supabase,
      mailbox,
      last_uid: batch.new_last_uid || state_before.last_uid || null,
    });
    const updated = await getIngestState({ supabaseAdmin: supabase, mailbox });
    state_after = updated.ok ? updated.data : state_before;
    return { ok: true, status: "ran", batch, state_before, state_after };
  }

  if (batch.new_last_uid && (!state_before.last_uid || batch.new_last_uid > state_before.last_uid)) {
    await upsertIngestState({
      supabaseAdmin: supabase,
      mailbox,
      last_uid: batch.new_last_uid,
      next_retry_at: state_before.next_retry_at || null,
      attempts: state_before.attempts || 0,
      last_error: state_before.last_error || null,
    });
    const updated = await getIngestState({ supabaseAdmin: supabase, mailbox });
    state_after = updated.ok ? updated.data : state_before;
  }

  return { ok: true, status: "ran", batch, state_before, state_after };
};

module.exports = { runIngestCycle };
