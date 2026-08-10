// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { CONNECTOR_PROVIDERS } from "./models.js";

/**
 * Boundary for a connector that runs in the user-controlled private engine.
 * Implementations may read an export, a local gateway, or a provider API; the
 * hosted MCP never receives an implementation or its credentials.
 */
export class LocalConnectorAdapter {
  constructor({ provider }) {
    if (!CONNECTOR_PROVIDERS.includes(provider)) {
      throw new Error(`Unsupported local connector provider: ${provider}`);
    }
    this.provider = provider;
  }

  async pullNormalizedEvents(_options = {}) {
    throw new Error(`${this.provider} local connector must implement pullNormalizedEvents().`);
  }
}

/**
 * Deterministic fixture path used by the MVP and connector contract tests.
 * Events are already normalized, so no provider token or network is involved.
 */
export class FixtureConnectorAdapter extends LocalConnectorAdapter {
  constructor({ provider = "manual", events = [] } = {}) {
    super({ provider });
    this.events = structuredClone(events);
  }

  async pullNormalizedEvents() {
    return structuredClone(this.events);
  }
}
