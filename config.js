// Iron Vault settings. Both values come from the Supabase dashboard (Project Settings > API).
// The key here is the public one ("anon" / "publishable"): it is meant to be visible in the browser.
// Never put the service_role / secret key in this file.
// While both are empty the site runs on built-in demo data and uploads stay in the visitor's tab.
window.IRONVAULT_CONFIG = {
  supabaseUrl: "https://mbxgnnnvygldgxkzqisb.supabase.co",
  supabaseAnonKey: "sb_publishable_doh7sNeITIt_cRVx_mvaqw_P82gpQ1W",
  maxAgeDays: 30   // lists not refreshed for this many days are hidden
};
