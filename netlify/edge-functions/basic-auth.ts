import type { Context, Config } from "@netlify/edge-functions";

// Gates every page behind HTTP Basic Auth for the pilot. Credentials come
// from the PILOT_USER / PILOT_PASSWORD environment variables — never hardcode
// them here, since this file is committed to the repo.
export default async (req: Request, context: Context) => {
  const expectedUser = Netlify.env.get("PILOT_USER") ?? "";
  const expectedPass = Netlify.env.get("PILOT_PASSWORD") ?? "";

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = atob(auth.slice("Basic ".length));
    const sep = decoded.indexOf(":");
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    if (expectedUser && expectedPass && user === expectedUser && pass === expectedPass) {
      return context.next();
    }
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="KPI Monitoring Hub — Pilot", charset="UTF-8"',
    },
  });
};

export const config: Config = {
  path: "/*",
};
