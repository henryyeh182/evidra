// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { handleJsonRpcMessage } from "./server.js";

const lines = createInterface({
  input: stdin,
  crlfDelay: Infinity
});

for await (const line of lines) {
  if (!line.trim()) {
    continue;
  }

  const response = await handleJsonRpcMessage(line);
  // Notifications resolve to null: stay silent rather than emitting a frame.
  if (response !== null) {
    stdout.write(`${JSON.stringify(response)}\n`);
  }
}
