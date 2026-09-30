// Gates every page behind HTTP Basic Auth for the pilot, on Cloudflare Pages.
// Credentials come from the PILOT_USER / PILOT_PASSWORD environment variables -
// never hardcode them here, since this file is committed to the repo.
// Ported from netlify/edge-functions/basic-auth.js (kept in place, unused, in
// case Netlify deploys resume later): same logic, Cloudflare Pages Functions'
// onRequest/context.env/context.next() in place of Netlify's req/context.next().
export async function onRequest(context) {
  const { request, env, next } = context;
  const expectedUser = env.PILOT_USER || "";
  const expectedPass = env.PILOT_PASSWORD || "";

  const auth = request.headers.get("authorization");
  if (auth && auth.startsWith("Basic ")) {
    const decoded = atob(auth.slice("Basic ".length));
    const sep = decoded.indexOf(":");
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    if (expectedUser && expectedPass && user === expectedUser && pass === expectedPass) {
      return next();
    }
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="KPI Monitoring Hub - Pilot", charset="UTF-8"',
    },
  });
}
