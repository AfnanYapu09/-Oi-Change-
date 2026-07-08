/*
 * config.js — cloud configuration.
 *
 * Leave these blank to run fully offline (data stays in localStorage).
 * To sync to the cloud, create a free Supabase project, run the SQL in
 * supabase/schema.sql, then paste your Project URL and the *anon* (publishable)
 * key below. The anon key is safe to expose in a browser app.
 *
 *   window.APP_CONFIG = {
 *     SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
 *     SUPABASE_ANON_KEY: 'eyJhbGciOi...'
 *   };
 *
 * No login is required — this single private journal reads and writes with the
 * anon role (the schema's row-level policies allow it).
 */
window.APP_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: ''
};
