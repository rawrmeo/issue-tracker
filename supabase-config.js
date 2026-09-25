/* ============================================================================
 *  Supabase connection settings
 * ----------------------------------------------------------------------------
 *  WHERE TO FIND THESE
 *    Supabase Dashboard -> your project -> Settings (gear) -> API
 *
 *      Project URL       ->  `url` below
 *      publishable key   ->  `anonKey` below
 *      (older projects call this key "anon public" — either works)
 *
 *  STOPPING HERE IS SAFE
 *    A publishable / anon key is DESIGNED to be public and shipped to
 *    browsers. It is not a secret. Your data is protected by the database's
 *    Row Level Security policies in supabase/schema.sql — not by hiding this
 *    key. Never put a "secret" / "service_role" key in this file.
 * ========================================================================= */

window.SUPABASE_CONFIG = {
  url: 'https://rjzssjjlcaxbdwqezdie.supabase.co',

  anonKey: 'sb_publishable_mKO-EhGqe6WP0l9h0-YKJg_hADg1J-c',

  /* Supabase Auth identifies people by email, but this app uses usernames.
     Each username is mapped to  <username>@<emailDomain>  behind the scenes.
     "example.com" is reserved by the internet and can never receive mail,
     which is exactly what we want for throwaway addresses.
     Change it only if you know why you want to. */
  emailDomain: 'example.com',

  /* Push notifications (optional). Paste the PUBLIC half of your VAPID key
     pair here — it is safe to publish. Generate the pair once with:
         npx web-push generate-vapid-keys
     Leave it empty and the Notifications switch in Settings stays off. */
  vapidPublicKey: '',
};
