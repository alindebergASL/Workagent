/**
 * Response headers for every app page. `frame-src 'self'` is what stops an
 * agent-created view (an about:srcdoc frame) from navigating itself to
 * another site: the embedding page's policy governs its frames' navigations.
 * Plain JS so next.config.ts and the browser regressions share these bytes.
 */
export const APP_SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-src 'self'" },
];
