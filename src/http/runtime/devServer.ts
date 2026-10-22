import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminBaselineSnapshot } from "../../fixtures/adminBaseline.js";
import { loadPostgresMigrations, runPostgresMigrations } from "../../database/migrationRunner.js";
import { PGliteSqlPool } from "../../database/pgliteSqlPool.js";
import { PostgresCompanyAccessRepository } from "../../database/postgresCompanyAccessRepository.js";
import { PostgresAdminDataRepository } from "../../database/postgresAdminRepository.js";
import { StaticBearerAuthenticationPort } from "./staticBearerAuthentication.js";
import { createApplicationHttpRuntime } from "./createRuntime.js";

const HOST = process.env.TM_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TM_PORT ?? "3000");
const ADMIN_TOKEN = process.env.TM_DEV_ADMIN_TOKEN ?? "local-development-admin-token";
const SUBJECT_ID = "dev-admin";
const COMPANY_ID = adminBaselineSnapshot.companyId;
const STARTED_AT = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();

const pool = new PGliteSqlPool();
await runPostgresMigrations(pool, await loadPostgresMigrations());
const adminData = new PostgresAdminDataRepository(pool);
const access = new PostgresCompanyAccessRepository(pool);

await adminData.initializeAdminData({
  ...adminBaselineSnapshot,
  updatedAt: STARTED_AT,
  updatedBy: SUBJECT_ID,
});
await access.save({
  companyId: COMPANY_ID,
  subjectId: SUBJECT_ID,
  role: "admin",
  active: true,
  grantedAt: STARTED_AT,
  grantedBy: "dev-bootstrap",
});

const authentication = new StaticBearerAuthenticationPort(ADMIN_TOKEN, {
  subjectId: SUBJECT_ID,
  provider: "local-development",
  authenticatedAt: STARTED_AT,
  expiresAt: "2099-12-31T23:59:59.999Z",
});
const publicDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../public",
);
const app = createApplicationHttpRuntime(
  authentication,
  { adminData, access },
  { logger: true, publicDirectory },
);

const address = await app.listen({ host: HOST, port: PORT });
console.log(`Taloyhtio Manager V2.8a local demo: ${address}`);
console.log(`Company: ${COMPANY_ID}`);
console.log(`Local admin token: ${ADMIN_TOKEN}`);

const close = async (): Promise<void> => {
  await app.close();
  await pool.close();
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
