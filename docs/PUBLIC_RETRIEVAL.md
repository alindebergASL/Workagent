# Public URL reading

`fetch_public_url` is a general-alpha/continuity decision with one field, `url`.
It performs a real, unauthenticated public HTTPS GET and returns bounded text to
the existing observation journal. The next agent selection can answer with source
links or publish an ordinary editable draft. The capability does not discover
URLs through a search engine, authenticate to accounts, render JavaScript, fetch
PDFs/images, or confer permissions. No model call is needed to test the reader.

## Scope and safety

- Ordinary human turns without an explicit saved-work target only. Existing exact
  target and responsibility dependency scopes are not broadened. Background
  responsibility retrieval needs a separately designed authority scope.
- HTTPS, standard port 443, no URL credentials. Reject non-public, loopback,
  private, link-local, reserved, multicast and known IPv6 transition addresses.
  Every redirect is validated, including DNS answers. A mixed public/private
  answer set fails closed.
- Connect directly to the selected checked numeric sockaddr, then verify TLS
  against the original hostname. There is no second DNS resolution between
  validation and connection. No HTTPS proxy, authentication, cookie jar, browser
  state, environment credentials or custom trust-store environment is inherited.
- Three redirects, five-second socket operations, one fifteen-second subprocess
  deadline covering DNS/TLS/headers/body/extraction. At most 262144 response-body
  bytes are retained for decoding and 20000 extracted text characters returned.
  HTTP parser header limits are also finite (stdlib line/count bounds).
- Request identity encoding; reject compressed responses rather than risk an
  unbounded decompression. Accept HTML/XHTML, plain text and JSON; supported
  character sets are UTF-8/ASCII/Latin-1/Windows-1252. Strip script/style/template/
  noscript content. This is basic text extraction, not a browser or readability
  engine. Only the first safe DNS address is attempted, not a fallback fleet.
- Keep requested/final URL, fetch-attempt timestamp, redirects, HTTP status,
  title/content type, extracted text hash, truncation, errors and explicit
  `untrusted_external_content` provenance. No raw error response bodies or
  network exception strings are exposed. `fetched_at` is the read attempt's
  start time, including failed attempts, not a page publication timestamp.
- Prompt policy requires source links and honest coverage/error caveats. Page
  text remains evidence, never system instructions, human intent or authority.
  Citation quality is model-dependent; no citation/entailment verifier is claimed.

## Integration

Apply `036_public_retrieval.sql` with the existing migration mechanism. It checks
exact selected-operation bindings, bounded source-result shape and text hash;
SQL does not independently attest to network truth. The pinned transport supplies
that observation. Existing grant checks, cancellation, membership rechecks and
retained stage deduplication remain in force. A crash **after retention** reuses
that observation without another GET; a crash **before retention** may repeat a
read-only GET. There is no exactly-once network-read claim or cross-turn cache.

The capability changes the consumer, policy, schema and catalog hashes. Existing
installed exact grants are not changed or activated here. Integration must refresh
compatible authority through the existing mechanism without increasing allowance.
No web files or `products.py` changes are required. The existing generic step UI
can display its operation name; a human-friendly label is optional web-owner work.

## Validation

Synthetic socket/HTTP tests cover rebinding-safe numeric connection, certificate
verification configuration, address/URL/redirect rejection, bounds, chunked and
incomplete responses, no inherited credentials/proxies, and process deadlines.
Disposable restricted-PostgreSQL tests cover read→grounded reply, read→saved draft,
retained restart dedupe, error readback, SQL tampering, step limit, cancellation,
revocation, membership and explicit-target/responsibility scope refusal. All
provider decisions are synthetic; these tests spend nothing and do not establish
live-model answer quality. See `backend/tests/test_public_retrieval*.py`.
