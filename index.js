// index.js (Supabase-only backend entrypoint)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const router = require('./src/router'); // your Supabase-based routes.js

const app = express();
const PORT = process.env.PORT || 5001;

/* ----------------------------- Middleware -------------------------------- */
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

/* --------------------------- Supabase (server) ---------------------------- */
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* ---------- Optional: one-time admin bootstrap (safe to keep) ------------ */
/**
 * If you set ADMIN_USER_ID=<uuid of a Supabase Auth user>,
 * this will ensure a row exists in admin_users with is_admin=true.
 * It won’t touch Supabase Auth; it only manages your table.
 */
async function ensureAdminFlag() {
  const ADMIN_USER_ID = process.env.ADMIN_USER_ID; // e.g. 9b1deb4d-... from Supabase Auth
  if (!ADMIN_USER_ID) {
    console.log('ADMIN_USER_ID not provided; skipping admin bootstrap.');
    return;
  }

  try {
    const { data, error } = await supabase
      .from('admin_users')
      .upsert({ auth_user_id: ADMIN_USER_ID, is_admin: true }, { onConflict: 'auth_user_id' })
      .select()
      .single();

    if (error) {
      console.error('Failed to upsert admin_users:', error);
    } else {
      console.log('Admin bootstrap ok:', data);
    }
  } catch (e) {
    console.error('Admin bootstrap exception:', e);
  }
}

/* ------------------------------- Routes ---------------------------------- */
app.use('/', router);
app.get('/health', (_req, res) => res.send('OK'));

/* ------------------------------- Start ----------------------------------- */
(async () => {
  await ensureAdminFlag();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
