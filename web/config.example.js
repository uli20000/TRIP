// Copy to config.js. The publishable key is safe for browser use; keep Notion secrets in Supabase only.
window.ICELAND_APP_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT_REF.supabase.co',
  supabasePublishableKey: 'sb_publishable_REPLACE_ME',
  syncFunctionUrl: 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/notion-sync'
};
