// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|secret|password|evidence|payload|body|arguments|claims|jwt|health|user_?id|sub)$/i;

/** Remove bearer/query secrets from text before an operator logger sees it. */
export function redactText(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/((?:access|refresh)_token|token|secret|password)=([^&\s]+)/gi, `$1=${REDACTED}`);
}

/**
 * Redact health data, credentials, and identity-bearing fields recursively.
 * This is deliberately conservative: callers should log only the returned
 * value, never the original request or error object.
 */
export function redactForLog(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactForLog(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactForLog(childValue, childKey)
    ]));
  }
  return value;
}

/**
 * Safe HTTP request metadata. It intentionally does not inspect body or
 * headers, so an injected logger cannot accidentally receive Evidence/token.
 */
export function requestLogRecord(req, { status, durationMs } = {}) {
  const pathname = new URL(req.url, "http://localhost").pathname;
  return redactForLog({
    method: req.method,
    path: pathname,
    status,
    durationMs,
    contentLength: req.headers["content-length"] || undefined
  });
}
