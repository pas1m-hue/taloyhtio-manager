import type { SqlPool, SqlTransactionClient } from "./sql.js";

export async function withPostgresTransaction<T>(
  pool: SqlPool,
  work: (client: SqlTransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure; a broken connection will be discarded by
      // the concrete pool implementation after release.
    }
    throw error;
  } finally {
    client.release();
  }
}
