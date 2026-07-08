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
  SUPABASE_URL: 'https://xelgnxuwlifyxeheadg.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhlbGdueHV3bGlmeXhlaGVoYWRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0OTQ3MzUsImV4cCI6MjA5OTA3MDczNX0.bCLgfb-K7CYL78pyO0XbJC3kN7b5HikR1c3pArMEzgs'
};
