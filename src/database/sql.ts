import { Pool, type PoolClient, type PoolConfig } from "pg";
import { asDatabaseError } from "./postgresErrors.js";

export interface SqlQueryResult<
  Row extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface SqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface SqlTransactionClient extends SqlExecutor {
  release(): void;
}

export interface SqlPool extends SqlExecutor {
  connect(): Promise<SqlTransactionClient>;
}

/** Thin node-postgres wrapper keeping repositories easy to contract-test. */
export class NodePostgresPool implements SqlPool {
  readonly #pool: Pool;

  public constructor(config: PoolConfig | Pool) {
    this.#pool = config instanceof Pool ? config : new Pool(config);
  }

  public async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    // Translated here rather than in each repository's catch: a row-level
    // security rejection is not specific to any one statement, and the
    // repositories only match the constraint codes they own, so it fell
    // through all of them as a bare 500.
    try {
      const result = await this.#pool.query<Row>(text, [...values]);
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? result.rows.length,
      };
    } catch (error) {
      throw asDatabaseError(error);
    }
  }

  public async connect(): Promise<SqlTransactionClient> {
    return new NodePostgresClient(await this.#pool.connect());
  }

  public async end(): Promise<void> {
    await this.#pool.end();
  }
}

class NodePostgresClient implements SqlTransactionClient {
  readonly #client: PoolClient;

  public constructor(client: PoolClient) {
    this.#client = client;
  }

  public async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    try {
      const result = await this.#client.query<Row>(text, [...values]);
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? result.rows.length,
      };
    } catch (error) {
      throw asDatabaseError(error);
    }
  }

  public release(): void {
    this.#client.release();
  }
}
