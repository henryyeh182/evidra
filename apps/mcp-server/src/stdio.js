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
  stdout.write(`${JSON.stringify(response)}\n`);
}
