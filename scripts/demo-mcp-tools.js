import { handleJsonRpcMessage } from "../apps/mcp-server/src/server.js";

const requests = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {}
  },
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "recommend_today_workout",
      arguments: {
        userId: "user_henry_demo",
        date: "2026-07-23",
        includeStravaFixture: true
      }
    }
  }
];

for (const request of requests) {
  const response = await handleJsonRpcMessage(JSON.stringify(request));
  console.log(JSON.stringify(response, null, 2));
}
