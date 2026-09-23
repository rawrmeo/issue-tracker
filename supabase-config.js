/* ============================================================================
 *  Supabase connection settings
 * ----------------------------------------------------------------------------
 *  WHERE TO FIND THESE
 *    Supabase Dashboard -> your project -> Settings (gear) -> API
 *
 *      Project URL  ->  copy into `url` below
 *      anon public  ->  copy into `anonKey` below
 *
 *  STOPPING HERE IS SAFE
 *    The "anon" key is DESIGNED to be public and shipped to browsers.
 *    It is not a secret. Your data is protected by the database's Row Level
 *    Security policies in supabase/schema.sql — not by hiding this key.
 *    Never put the "service_role" key in this file.
 * ========================================================================= */

window.SUPABASE_CONFIG = {
  // e.g. "https://abcdefghijklmnop.supabase.co"
  url: '',

  // e.g. "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  anonKey: '',

  /* Supabase Auth identifies people by email, but this app uses usernames.
     Each username is mapped to  <username>@<emailDomain>  behind the scenes.
     "example.com" is reserved by the internet and can never receive mail,
     which is exactly what we want for throwaway addresses.
     Change it only if you know why you want to. */
  emailDomain: 'example.com',
};
