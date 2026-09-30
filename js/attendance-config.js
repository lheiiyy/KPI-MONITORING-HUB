// Public, non-secret deployment settings for the Attendance module. The Apps Script web-app URL is not a
// credential (every call still needs a per-user token issued by an administrator), but NEVER put a token,
// key or password in this file. Leave apiUrl empty until the backend is deployed: the page then says it is
// not configured instead of pretending to work. See docs/ATTENDANCE_MODULE.md.
window.ATTENDANCE_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbzBKWSpKRmVvVhh8xwiH6HlvFLyj5qc0mPsZALAlNA2MqqJn_tToEC8PCyI9mbi1DhO/exec'
};
