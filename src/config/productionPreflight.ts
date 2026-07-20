import { loadProductionEnvironment } from "./environment.js";

try {
  const config = loadProductionEnvironment(process.env);
  console.log(JSON.stringify({
    status: "ok",
    environment: config.environment,
    host: config.host,
    port: config.port,
    publicAppUrl: config.publicAppUrl,
    databaseHost: new URL(config.databaseUrl).hostname,
    databasePoolMax: config.databasePoolMax,
    visitorSessionTtlSeconds: config.visitorSessionTtlSeconds,
    supabaseUrl: config.supabaseUrl,
    supabaseJwtIssuer: config.supabaseJwtIssuer,
    supabaseJwtAudience: config.supabaseJwtAudience,
    supabaseJwksUrl: config.supabaseJwksUrl,
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown preflight error.";
  console.error(`Production preflight failed: ${message}`);
  process.exitCode = 1;
}
