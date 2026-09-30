// Runtime configuration for the scheduling & attendance pages.
//   apiUrl : the Apps Script web-app URL (apps-script/README.md). Leave '' to run in the
//            NOT-CONNECTED mode: pages work in memory only and nothing is saved.
//   token  : must equal the API_TOKEN script property. It ships to every visitor, so it is
//            a pilot-level guard only, not real authentication (see README, "Security").
//   actor  : label written to the audit log; client-supplied, so informational only.
window.ATT_CONFIG = { adapter: 'sheets', apiUrl: '', token: '', actor: '' };
