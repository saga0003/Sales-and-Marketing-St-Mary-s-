import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { notificationsForAudit } from './notifications.mjs';
const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));
// SQL values always remain parameters. This translator only adapts the portable
// placeholders used by this application's fixed SQL, while ignoring quoted text.
export function postgresSql(source) {
  let result = '';
  let index = 0;
  let quote = null;
  let dollarQuote = null;
  let lineComment = false;
  let blockComment = false;
  for (let position = 0; position < source.length; position += 1) {
    const char = source[position];
    const next = source[position + 1];
    if (lineComment) {
      result += char;
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      result += char;
      if (char === '*' && next === '/') {
        result += next;
        position += 1;
        blockComment = false;
      }
      continue;
    }
    if (dollarQuote) {
      if (source.startsWith(dollarQuote, position)) {
        result += dollarQuote;
        position += dollarQuote.length - 1;
        dollarQuote = null;
      } else result += char;
      continue;
    }
    if (quote) {
      result += char;
      if (char === quote) {
        if (next === quote) {
          result += next;
          position += 1;
        } else quote = null;
      }
      continue;
    }
    if (char === '-' && next === '-') lineComment = true;
    else if (char === '/' && next === '*') blockComment = true;
    else if (char === "'" || char === '"') quote = char;
    else if (char === '$') {
      const match = source.slice(position).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
      if (match) {
        dollarQuote = match[0];
        result += dollarQuote;
        position += dollarQuote.length - 1;
        continue;
      }
    } else if (char === '?') {
      result += `$${++index}`;
      continue;
    }
    result += char;
  }
  return result;
}
function postgresDdl(source) {
  return source
    .replace(/\s+COLLATE\s+NOCASE/gi, '')
    .replace(/\bINTEGER\b/gi, 'BIGINT')
    .replace(/CHECK\s*\(json_valid\((\w+)\)\)/gi, 'CHECK (($1)::jsonb IS NOT NULL)');
}
export async function openDatabase(filename, options = {}) {
  const context = new AsyncLocalStorage();
  const databaseUrl = options.databaseUrl;
  const isPostgres = Boolean(databaseUrl);
  let driver;
  let tail = Promise.resolve();
  const serial = async (fn) => {
    const before = tail;
    let release;
    tail = new Promise((resolveNext) => {
      release = resolveNext;
    });
    await before;
    try {
      return await fn();
    } finally {
      release();
    }
  };
  const schema = options.schema ?? 'smis_marketing';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema) || ['public', 'auth', 'storage'].includes(schema))
    throw new Error('DATABASE_SCHEMA must name an isolated application schema.');
  if (isPostgres) {
    const { Pool } = await import('pg');
    let connectionString = databaseUrl;
    let ssl = options.ssl;
    if (options.sslCa) {
      // pg's connection-string SSL settings take precedence over its ssl object.
      // Use the explicitly trusted CA without weakening certificate/hostname checks.
      const parsed = new URL(databaseUrl);
      for (const name of [...parsed.searchParams.keys()]) {
        if (
          [
            'ssl',
            'sslmode',
            'sslcert',
            'sslkey',
            'sslrootcert',
            'sslpassword',
            'uselibpqcompat',
          ].includes(name.toLowerCase())
        ) {
          parsed.searchParams.delete(name);
        }
      }
      connectionString = parsed.toString();
      ssl = { ca: String(options.sslCa).replaceAll('\\n', '\n'), rejectUnauthorized: true };
    }
    driver = new Pool({
      connectionString,
      max: options.poolSize ?? 3,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 15000,
      ...(ssl ? { ssl } : {}),
    });
    driver.on('error', (error) => options.onError?.(error));
  } else {
    const location = filename === ':memory:' ? filename : resolve(filename);
    if (location !== ':memory:') mkdirSync(dirname(location), { recursive: true, mode: 0o700 });
    driver = new DatabaseSync(location);
    driver.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    driver.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  }
  const db = {
    kind: isPostgres ? 'postgres' : 'sqlite',
    schema: isPostgres ? schema : null,
    persistent: isPostgres || filename !== ':memory:',
    lockSuffix: isPostgres ? ' FOR UPDATE' : '',
    inTransaction: () => Boolean(context.getStore()),
    async execute(sql, values = [], kind = 'all') {
      if (isPostgres) {
        if (!context.getStore()) return db.transaction(() => db.execute(sql, values, kind));
        const client = context.getStore().client;
        const result = await client.query(postgresSql(sql), values);
        if (kind === 'run') return { changes: result.rowCount ?? 0 };
        return kind === 'get' ? result.rows[0] : result.rows;
      }
      const run = () => driver.prepare(sql)[kind](...values);
      return context.getStore() ? run() : serial(run);
    },
    prepare(sql) {
      return {
        get: (...values) => db.execute(sql, values, 'get'),
        all: (...values) => db.execute(sql, values, 'all'),
        run: (...values) => db.execute(sql, values, 'run'),
      };
    },
    async exec(sql) {
      if (isPostgres) {
        if (!context.getStore()) return db.transaction(() => db.exec(sql));
        const client = context.getStore().client;
        await client.query(postgresDdl(sql));
      } else if (context.getStore()) driver.exec(sql);
      else await serial(() => driver.exec(sql));
    },
    async transaction(fn) {
      const parent = context.getStore();
      if (parent) {
        const savepoint = `nested_${randomUUID().replaceAll('-', '')}`;
        await db.exec(`SAVEPOINT ${savepoint}`);
        try {
          const result = await fn();
          await db.exec(`RELEASE SAVEPOINT ${savepoint}`);
          return result;
        } catch (error) {
          await db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await db.exec(`RELEASE SAVEPOINT ${savepoint}`);
          throw error;
        }
      }
      if (isPostgres) {
        const client = await driver.connect();
        try {
          await client.query(
            `BEGIN; SET LOCAL search_path TO ${schema}, pg_catalog; SET LOCAL statement_timeout = '15s'`,
          );
          const result = await context.run({ client }, fn);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
      return serial(async () => {
        driver.exec('BEGIN IMMEDIATE');
        try {
          const result = await context.run({ sqlite: true }, fn);
          driver.exec('COMMIT');
          return result;
        } catch (error) {
          driver.exec('ROLLBACK');
          throw error;
        }
      });
    },
    async close() {
      if (isPostgres) await driver.end();
      else await serial(() => driver.close());
    },
  };
  try {
    const shouldMigrate = options.migrate !== false;
    if (shouldMigrate) {
      if (isPostgres) {
        const existing = await driver.query('SELECT oid FROM pg_namespace WHERE nspname = $1', [
          schema,
        ]);
        if (!existing.rowCount) await driver.query(`CREATE SCHEMA ${schema}`);
      }
      await db.transaction(async () => {
        // The lock is transaction-scoped, and therefore released on errors too.
        if (isPostgres)
          await db
            .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
            .get(`smis:${schema}:migrations`);
        await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
        );`);
        const files = readdirSync(migrationsDirectory)
          .filter((name) => /^\d+_.+\.sql$/.test(name))
          .sort();
        for (const name of files) {
          const version = Number(name.split('_')[0]);
          if (
            await db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version)
          )
            continue;
          await db.exec(readFileSync(join(migrationsDirectory, name), 'utf8'));
          await db
            .prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
            .run(version, name, new Date().toISOString());
        }
      });
    } else {
      const latest = readdirSync(migrationsDirectory)
        .filter((name) => /^\d+_.+\.sql$/.test(name))
        .sort()
        .at(-1);
      const version = Number(latest?.split('_')[0]);
      if (
        !(await db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version))
      )
        throw new Error(
          'Database migration required. Apply migrations before deploying this release.',
        );
    }
  } catch (error) {
    await db.close();
    throw error;
  }
  return db;
}
export async function transaction(db, fn) {
  return db.transaction(fn);
}
export const makeId = (prefix) => `${prefix}_${randomUUID()}`;
export function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: Number(row.active) === 1,
    setupPending: Number(row.setup_pending) === 1,
    initials: row.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join('')
      .toUpperCase(),
  };
}
export function toPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    caption: row.caption,
    platforms: JSON.parse(row.platforms),
    format: row.format,
    institution: row.institution,
    status: row.status,
    scheduledAt: row.scheduled_at,
    language: row.language,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision),
    approvedRevision: row.approved_revision === null ? null : Number(row.approved_revision),
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    feedback: row.feedback,
    sourceUrl: row.source_url,
    mediaUrl: row.media_url,
    assetId: row.asset_id ?? null,
    assetIds: JSON.parse(row.asset_ids ?? '[]').length
      ? JSON.parse(row.asset_ids)
      : row.asset_id
        ? [row.asset_id]
        : [],
    publicationOptions: JSON.parse(row.publication_options ?? '{}'),
    destinationIds: JSON.parse(row.destination_ids ?? '[]'),
    palette: row.palette,
    sample: Number(row.sample) === 1,
  };
}
const postSelection =
  'SELECT posts.*, users.name AS owner_name FROM posts JOIN users ON users.id = posts.owner_id';
export async function getPost(db, id, { lock = false } = {}) {
  const suffix = lock && db.kind === 'postgres' ? ' FOR UPDATE OF posts' : '';
  return toPost(await db.prepare(`${postSelection} WHERE posts.id = ?${suffix}`).get(id));
}
export async function listPosts(db) {
  return (
    await db.prepare(`${postSelection} ORDER BY posts.updated_at DESC, posts.id ASC`).all()
  ).map(toPost);
}
export async function insertPost(db, post) {
  await db
    .prepare(
      `INSERT INTO posts (
    id, title, caption, platforms, format, institution, status, scheduled_at, language,
    owner_id, created_at, updated_at, revision, approved_revision, approved_by, approved_at,
    feedback, source_url, media_url, palette, sample, asset_id, destination_ids, asset_ids, publication_options
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      post.id,
      post.title,
      post.caption,
      JSON.stringify(post.platforms),
      post.format,
      post.institution,
      post.status,
      post.scheduledAt ?? null,
      post.language,
      post.ownerId,
      post.createdAt,
      post.updatedAt,
      post.revision,
      post.approvedRevision ?? null,
      post.approvedBy ?? null,
      post.approvedAt ?? null,
      post.feedback ?? '',
      post.sourceUrl ?? '',
      post.mediaUrl ?? '',
      post.palette,
      Number(Boolean(post.sample)),
      post.assetId ?? null,
      JSON.stringify(post.destinationIds ?? []),
      JSON.stringify(post.assetIds ?? (post.assetId ? [post.assetId] : [])),
      JSON.stringify(post.publicationOptions ?? {}),
    );
}
export async function writePostRevision(db, post, actorId, timestamp) {
  await db
    .prepare(
      'INSERT INTO post_revisions(post_id, revision, snapshot, changed_by, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(post.id, post.revision, JSON.stringify(post), actorId, timestamp);
}
export async function audit(db, actor, action, entityId, detail, timestamp) {
  const id = makeId('audit');
  await db
    .prepare(
      'INSERT INTO audit_log(id, actor_id, actor, action, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, actor?.id ?? null, actor?.name ?? 'System', action, entityId, detail, timestamp);
  await notificationsForAudit(db, { id, actor, action, entityId, detail, timestamp });
}
export function toOpportunity(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    source: row.source,
    sourceUrl: row.source_url,
    category: row.category,
    publishedAt: row.published_at,
    verified: Number(row.verified) === 1,
    status: row.status,
    priority: row.priority,
    audience: row.audience,
    contentAngle: row.content_angle,
    sourceKind: row.source_kind,
  };
}
export const resourceDefinitions = {
  competitors: {
    prefix: 'competitor',
    columns: {
      name: 'name',
      platform: 'platform',
      url: 'url',
      category: 'category',
      notes: 'notes',
      monitoringStatus: 'monitoring_status',
    },
    convert: (row) => ({
      id: row.id,
      name: row.name,
      platform: row.platform,
      url: row.url,
      category: row.category,
      notes: row.notes,
      monitoringStatus: row.monitoring_status,
      lastCheckedAt: row.last_checked_at,
      sample: Number(row.sample) === 1,
    }),
  },
  sources: {
    prefix: 'source',
    columns: { name: 'name', url: 'url', category: 'category', status: 'status' },
    convert: (row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      category: row.category,
      status: row.status,
      lastCheckedAt: row.last_checked_at,
    }),
  },
  tasks: {
    prefix: 'task',
    columns: {
      title: 'title',
      owner: 'owner',
      dueDate: 'due_date',
      status: 'status',
      priority: 'priority',
    },
    convert: (row) => ({
      id: row.id,
      title: row.title,
      owner: row.owner,
      dueDate: row.due_date,
      status: row.status,
      priority: row.priority,
    }),
  },
  documents: {
    prefix: 'document',
    columns: { title: 'title', category: 'category', content: 'content' },
    convert: (row) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      content: row.content,
      updatedAt: row.updated_at,
      version: Number(row.version ?? 1),
    }),
  },
};
export async function getResource(db, table, id) {
  const definition = resourceDefinitions[table];
  if (!definition) throw new Error('Unknown resource');
  const suffix = db.inTransaction() ? db.lockSuffix : '';
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?${suffix}`).get(id);
  return row ? definition.convert(row) : null;
}
export async function listResources(db, table) {
  const definition = resourceDefinitions[table];
  if (!definition) throw new Error('Unknown resource');
  return (await db.prepare(`SELECT * FROM ${table} ORDER BY updated_at DESC, id ASC`).all()).map(
    definition.convert,
  );
}
export async function insertResource(db, table, values, timestamp, id) {
  const definition = resourceDefinitions[table];
  if (!definition) throw new Error('Unknown resource');
  const fields = Object.keys(values).filter((key) => Object.hasOwn(definition.columns, key));
  const columns = [
    'id',
    ...fields.map((key) => definition.columns[key]),
    'created_at',
    'updated_at',
  ];
  const params = [
    id ?? makeId(definition.prefix),
    ...fields.map((key) => values[key]),
    timestamp,
    timestamp,
  ];
  await db
    .prepare(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    )
    .run(...params);
  return await getResource(db, table, params[0]);
}
export async function updateResource(db, table, id, values, timestamp) {
  const definition = resourceDefinitions[table];
  if (!definition) throw new Error('Unknown resource');
  const fields = Object.keys(values).filter((key) => Object.hasOwn(definition.columns, key));
  if (fields.length) {
    const assignments = fields.map((key) => `${definition.columns[key]} = ?`);
    await db
      .prepare(`UPDATE ${table} SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...fields.map((key) => values[key]), timestamp, id);
  }
  return await getResource(db, table, id);
}
