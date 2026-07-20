import { loadProductionEnvironment } from "../../config/environment.js";
import { createProductionRuntime } from "./createProductionRuntime.js";

async function main(): Promise<void> {
  const config = loadProductionEnvironment(process.env);
  const runtime = await createProductionRuntime(config);
  const address = await runtime.server.listen({
    host: config.host,
    port: config.port,
  });
  console.log(`Taloyhtio Manager V2.8a listening at ${address}`);
  console.log(`Public application URL: ${config.publicAppUrl}`);
  console.log(`Authentication issuer: ${config.supabaseJwtIssuer}`);

  let closing = false;
  const close = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`Received ${signal}; closing server.`);
    try {
      await runtime.close();
      process.exitCode = 0;
    } catch {
      console.error("Production runtime shutdown failed.");
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void close("SIGINT"));
  process.once("SIGTERM", () => void close("SIGTERM"));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error.";
  console.error(`Production startup failed: ${message}`);
  process.exitCode = 1;
});
