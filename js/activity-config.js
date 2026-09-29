// Public, non-secret deployment settings. The Apps Script web-app URL is not a
// credential (every call still needs a per-user token issued by an administrator),
// but NEVER put a token, key or password in this file.
// Leave apiUrl empty until the backend is deployed - the page then shows a clear
// "not configured" message instead of failing silently. See docs/ACTIVITY_SETUP.md.
window.ACTIVITY_CONFIG = {
  apiUrl: ''
};
