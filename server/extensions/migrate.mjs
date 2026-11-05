import { readFile } from 'node:fs/promises';
import { transaction } from '../database.mjs';

export const EXTENSION_SCHEMA_VERSION = '2';
const marker = (db) =>
  db
    .prepare(
      "SELECT value FROM workspace_metadata WHERE key = 'provider_extensions_schema_version'",
    )
    .get();

export async function migrateExtensions(db, config) {
  if (config.migrate === false) {
    if ((await marker(db))?.value !== EXTENSION_SCHEMA_VERSION)
      throw new Error(
        'Provider extension database migration required. Apply server/extensions/migration-v2.postgres.sql in the private schema with a migration role before deploying this release.',
      );
    return;
  }
  const before = (await marker(db))?.value;
  if (before === EXTENSION_SCHEMA_VERSION) return;
  if (before && before !== '1')
    throw new Error('The provider extension schema version is not supported by this release.');
  // SQLite cannot remove CHECK/NOT NULL constraints in place. Initialization
  // has not exposed the app to requests yet; rebuild only these two tables in
  // a single transaction while preserving their IDs and dependent references.
  if (before === '1' && db.kind === 'sqlite') await db.exec('PRAGMA foreign_keys = OFF;');
  try {
    await transaction(db, async () => {
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:migrations`);
      const version = (await marker(db))?.value;
      if (version === EXTENSION_SCHEMA_VERSION) return;
      if (!version) {
        await db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
      } else if (version === '1' && db.kind === 'postgres') {
        await db.exec(
          await readFile(new URL('./migration-v2.postgres.sql', import.meta.url), 'utf8'),
        );
      } else if (version === '1') {
        const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
        for (const name of ['service_connections', 'publication_jobs']) {
          const ddl = schema.match(
            new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\);`),
          )?.[0];
          if (!ddl) throw new Error('The extension migration table definition is missing.');
          const columns = (await db.prepare(`PRAGMA table_info(${name})`).all()).map(
            (column) => column.name,
          );
          // Identifiers are from our fixed table schema, never request input.
          if (!columns.every((name) => /^[a-z_]+$/.test(name)))
            throw new Error('Unexpected migration column.');
          await db.exec(ddl.replace(`IF NOT EXISTS ${name}`, `${name}_v2`));
          await db.exec(
            `INSERT INTO ${name}_v2 (${columns.join(',')}) SELECT ${columns.join(',')} FROM ${name}; DROP TABLE ${name}; ALTER TABLE ${name}_v2 RENAME TO ${name};`,
          );
        }
        await db.exec(
          "ALTER TABLE media_assets ADD COLUMN kind TEXT NOT NULL DEFAULT 'image' CHECK(kind IN ('image','video')); ALTER TABLE media_assets ADD COLUMN duration REAL;",
        );
        // Existing tables are retained; this creates the new report table and
        // recreates indexes dropped with the two rebuilt tables.
        await db.exec(schema);
        if ((await db.prepare('PRAGMA foreign_key_check').all()).length)
          throw new Error('The extension migration found invalid foreign-key references.');
      } else throw new Error('Unexpected provider migration state.');
    });
  } finally {
    if (before === '1' && db.kind === 'sqlite') await db.exec('PRAGMA foreign_keys = ON;');
  }
}
