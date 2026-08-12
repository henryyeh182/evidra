// Copyright (c) 2026 Henry Yeh. All rights reserved.

import { createConfiguredServer } from "./http.js";

const port = Number(process.env.PORT || 8787);
const host = process.env.MCP_HOST || "0.0.0.0";
const server = createConfiguredServer(process.env);
server.listen(port, host, () => {
  console.log(`pacevera remote MCP listening on ${host}:${port}`);
});
