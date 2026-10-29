import { buildApp } from "./app";
import { loadConfig } from "./config";

const cfg = loadConfig();
const { app } = await buildApp(cfg);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: cfg.PORT, host: cfg.HOST });
