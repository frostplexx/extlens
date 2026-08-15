#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";

/**
 * Client entrypoint. Host URL: --ws flag, else EXTLENS_WS env, else the local
 * default ws://localhost:8081.
 */
function resolveWsUrl(argv: string[]): string {
  const flagIndex = argv.indexOf("--ws");
  if (flagIndex !== -1 && argv[flagIndex + 1]) return argv[flagIndex + 1];
  if (process.env.EXLENS_WS) return process.env.EXLENS_WS;
  return "ws://localhost:8081";
}

render(React.createElement(App, { wsUrl: resolveWsUrl(process.argv.slice(2)) }));
