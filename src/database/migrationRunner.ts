import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DomainValidationError } from "../domain/types.js";
import type { SqlPool } from "./sql.js";
import { withPostgresTransaction } from "./transaction.js";

const MIGRATION_LOCK_KEY = 7_625_001;
const MIGRATION_FILE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

export interface SqlMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface MigrationRunResult {
  readonly appliedVersions: readonly number[];
  readonly skippedVersions: readonly number[];
}

export async function loadPostgresMigrations(
  directory: string | URL = new URL("./migrations/", import.meta.url),
): Promise<readonly SqlMigration[]> {
  const directoryPath = directory instanceof URL
    ? fileURLToPath(directory)
    : directory;
  const names = (await readdir(directoryPath))
    .filter((name) => MIGRATION_FILE.test(name))
    .sort();
  const migrations = await Promise.all(names.map(async (filename) => {
    const match = MIGRATION_FILE.exec(filename);
    if (match === null) {
      throw migrationConflict(`Invalid migration filename ${filename}.`);
    }
    return {
      version: Number(match[1]),
      name: match[2]!,
      sql: await readFile(path.join(directoryPath, filename), "utf8"),
    } satisfies SqlMigration;
  }));
  validateMigrationSet(migrations);
  return migrations;
}

export async function runPostgresMigrations(
  pool: SqlPool,
  migrations: readonly SqlMigration[],
): Promise<MigrationRunResult> {
  validateMigrationSet(migrations);
  return withPostgresTransaction(pool, async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tm_schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL UNIQUE,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);

    const appliedVersions: number[] = [];
    const skippedVersions: number[] = [];
    for (const migration of migrations) {
      const checksum = migrationChecksum(migration);
      const existing = await client.query<{
        version: number;
        name: string;
        checksum: string;
      }>(
        "SELECT version, name, checksum FROM tm_schema_migrations WHERE version = $1",
        [migration.version],
      );
      const row = existing.rows[0];
      if (row !== undefined) {
        if (row.name !== migration.name || row.checksum.trim() !== checksum) {
          throw migrationConflict(
            `Migration ${migration.version} differs from the already applied migration.`,
          );
        }
        skippedVersions.push(migration.version);
        continue;
      }

      for (const statement of splitPostgresStatements(migration.sql)) {
        await client.query(statement);
      }
      await client.query(
        `INSERT INTO tm_schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.name, checksum],
      );
      appliedVersions.push(migration.version);
    }
    return { appliedVersions, skippedVersions };
  });
}

export function migrationChecksum(migration: SqlMigration): string {
  return createHash("sha256")
    .update(`${migration.version}\n${migration.name}\n${migration.sql}`, "utf8")
    .digest("hex");
}

export function splitPostgresStatements(sql: string): readonly string[] {
  const statements: string[] = [];
  let current = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarTag: string | undefined;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockCommentDepth > 0) {
      current += char;
      if (char === "/" && next === "*") {
        current += next;
        blockCommentDepth += 1;
        index += 1;
      } else if (char === "*" && next === "/") {
        current += next;
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (dollarTag !== undefined) {
      if (sql.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (singleQuoted) {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (char === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (doubleQuoted) {
      current += char;
      if (char === '"' && next === '"') {
        current += next;
        index += 1;
      } else if (char === '"') {
        doubleQuoted = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      current += `${char}${next}`;
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      current += `${char}${next}`;
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (char === "'") {
      current += char;
      singleQuoted = true;
      continue;
    }
    if (char === '"') {
      current += char;
      doubleQuoted = true;
      continue;
    }
    if (char === "$") {
      const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
      if (match !== null) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (char === ";") {
      const statement = current.trim();
      if (statement !== "") statements.push(statement);
      current = "";
      continue;
    }
    current += char;
  }

  if (singleQuoted || doubleQuoted || dollarTag !== undefined ||
      blockCommentDepth > 0) {
    throw migrationConflict("Migration SQL contains an unterminated quoted block.");
  }
  const tail = current.trim();
  if (tail !== "") statements.push(tail);
  return statements;
}

function validateMigrationSet(migrations: readonly SqlMigration[]): void {
  if (migrations.length === 0) {
    throw migrationConflict("At least one database migration is required.");
  }
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (let index = 0; index < ordered.length; index += 1) {
    const migration = ordered[index]!;
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion || migration.name.trim() === "" ||
        migration.sql.trim() === "") {
      throw migrationConflict(
        `Database migrations must be contiguous from version 1; expected ${expectedVersion}.`,
      );
    }
  }
  if (migrations.some((migration, index) => migration !== ordered[index])) {
    throw migrationConflict("Database migrations must be supplied in version order.");
  }
  if (new Set(migrations.map((item) => item.name)).size !== migrations.length) {
    throw migrationConflict("Database migration names must be unique.");
  }
}

function migrationConflict(message: string): DomainValidationError {
  return new DomainValidationError("DATABASE_MIGRATION_CONFLICT", message);
}
