const { createClient } = require("@supabase/supabase-js");

let cachedClient = null;

const getSupabaseAdminClient = () => {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  return cachedClient;
};

module.exports = { getSupabaseAdminClient };
