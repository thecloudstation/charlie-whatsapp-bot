#!/usr/bin/env node

import process from "node:process";
import express from "express";
import { config } from "./config.js";
import { createWebhookRouter } from "./webhook.js";

async function main() {
  console.log("Starting Charlie WhatsApp Bot...");

  const app = express();
  app.use(express.json());
  app.use("/", createWebhookRouter(config));

  const server = app.listen(config.webhookPort, () => {
    console.log(`Webhook server listening on port ${config.webhookPort}`);
    console.log(`Evolution API: ${config.evolutionApiUrl}`);
    console.log(`Instance: ${config.evolutionInstance}`);
    console.log(`Charlie API: ${config.charlieApiUrl}`);
    console.log(`Project ID: ${config.charlieProjectId}`);
  });

  // Graceful shutdown
  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("Shutting down...");
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
