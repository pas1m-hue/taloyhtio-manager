export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy":
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; " +
    "form-action 'self'; img-src 'self' data:; connect-src 'self'; " +
    "script-src 'self'; style-src 'self'",
};
