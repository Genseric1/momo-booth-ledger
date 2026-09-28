/* ═══════════════ DEPLOYMENT CONFIG ═══════════════
   Filled in once by the manager before publishing the site, so that an agent
   never has to paste a project URL or a key into a phone.

   Left empty, the app stays exactly what it is today: a local notebook on the
   device, no account, no server. Fill these in and redeploy, and every device
   picks the booth up on its next load.                                       */

export const CONFIG = {
  /* From the Supabase dashboard: Project settings -> API */
  supabaseUrl: '',
  supabaseKey: '',            // the *anon* key — never the service_role key

  /* The id of the row created in `booths` (see supabase/schema.sql) */
  boothId: '',

  /* true  = the page asks for an account before it opens.
     false = anyone who has the link can use the app on their own device.
     It only takes effect once the three fields above are filled in.          */
  requireAccount: true,
};

export const hasBackend = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseKey && CONFIG.boothId);
export const needsAccount = () => hasBackend() && CONFIG.requireAccount;
