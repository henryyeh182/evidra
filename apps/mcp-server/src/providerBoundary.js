// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

const PROVIDER_TOKEN_KEYS = new Set([
  "providertoken",
  "accesstoken",
  "refreshtoken",
  "oauthaccesstoken",
  "oauthrefreshtoken",
  "clientsecret",
  "apikey",
  "token",
  "secret",
  "authorization"
]);

function normalizedKey(key) {
  return String(key).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/** Return the JSON path of a provider credential, without reading its value. */
export function findProviderTokenField(value, path = []) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findProviderTokenField(value[index], [...path, index]);
      if (found) return found;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (PROVIDER_TOKEN_KEYS.has(normalizedKey(key))) return [...path, key];
    const found = findProviderTokenField(child, [...path, key]);
    if (found) return found;
  }
  return null;
}
