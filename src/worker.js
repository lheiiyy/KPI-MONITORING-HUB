// Gates every page behind HTTP Basic Auth for the pilot, on Cloudflare Workers
// (static assets). Credentials come from the PILOT_USER / PILOT_PASSWORD
// environment variables - never hardcode them here, since this file is
// committed to the repo.
//
// This deployment (wrangler.jsonc "assets" binding) is a Worker, not classic
// Cloudflare Pages, so Pages Functions conventions (functions/_middleware.js)
// do not apply here - this file is the actual auth gate for this deployment.
// The logic itself mirrors netlify/edge-functions/basic-auth.js and
// functions/_middleware.js (kept for Netlify / classic Pages, unused here).
export default {
  async fetch(request, env) {
    const expectedUser = env.PILOT_USER || "";
    const expectedPass = env.PILOT_PASSWORD || "";

    const auth = request.headers.get("authorization");
    if (auth && auth.startsWith("Basic ")) {
      const decoded = atob(auth.slice("Basic ".length));
      const sep = decoded.indexOf(":");
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      if (expectedUser && expectedPass && user === expectedUser && pass === expectedPass) {
        return env.ASSETS.fetch(request);
      }
    }

    return new Response("Authentication required.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="KPI Monitoring Hub - Pilot", charset="UTF-8"',
      },
    });
  },
};
