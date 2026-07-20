import { PGlite } from "@electric-sql/pglite";
import type {
  SqlPool,
  SqlQueryResult,
  SqlTransactionClient,
} from "./sql.js";

/** Local-development/test PostgreSQL engine. Production uses NodePostgresPool. */
export class PGliteSqlPool implements SqlPool {
  readonly #db: PGlite;

  public constructor() {
    this.#db = new PGlite();
  }

  public async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.#db.query<Row>(text, [...values]);
    return {
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    };
  }

  public async connect(): Promise<SqlTransactionClient> {
    return {
      query: <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => this.query<Row>(text, values),
      release: () => undefined,
    };
  }

  public async close(): Promise<void> {
    await this.#db.close();
  }
}
