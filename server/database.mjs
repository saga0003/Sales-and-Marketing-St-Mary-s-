import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));

export function openDatabase(filename) {
  const location = filename === ':memory:' ? filename : resolve(filename);
  if (location !== ':memory:') mkdirSync(dirname(location), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(location);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  );`);

  const files = readdirSync(migrationsDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  for (const name of files) {
    const version = Number(name.split('_')[0]);
    if (db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version))
      continue;
    const sql = readFileSync(join(migrationsDirectory, name), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)').run(
        version,
        name,
        new Date().toISOString(),
      );
    });
  }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const makeId = (prefix) => `${prefix}_${randomUUID()}`;

export function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
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
    revision: row.revision,
    approvedRevision: row.approved_revision,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    feedback: row.feedback,
    sourceUrl: row.source_url,
    mediaUrl: row.media_url,
    palette: row.palette,
    sample: Boolean(row.sample),
  };
}

const postSelection =
  'SELECT posts.*, users.name AS owner_name FROM posts JOIN users ON users.id = posts.owner_id';

export function getPost(db, id) {
  return toPost(db.prepare(`${postSelection} WHERE posts.id = ?`).get(id));
}

export function listPosts(db) {
  return db
    .prepare(`${postSelection} ORDER BY posts.updated_at DESC, posts.id ASC`)
    .all()
    .map(toPost);
}

export function insertPost(db, post) {
  db.prepare(
    `INSERT INTO posts (
    id, title, caption, platforms, format, institution, status, scheduled_at, language,
    owner_id, created_at, updated_at, revision, approved_revision, approved_by, approved_at,
    feedback, source_url, media_url, palette, sample
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
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
  );
}

export function writePostRevision(db, post, actorId, timestamp) {
  db.prepare(
    'INSERT INTO post_revisions(post_id, revision, snapshot, changed_by, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(post.id, post.revision, JSON.stringify(post), actorId, timestamp);
}

export function audit(db, actor, action, entityId, detail, timestamp) {
  db.prepare(
    'INSERT INTO audit_log(id, actor_id, actor, action, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    makeId('audit'),
    actor?.id ?? null,
    actor?.name ?? 'System',
    action,
    entityId,
    detail,
    timestamp,
  );
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
    verified: Boolean(row.verified),
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
      sample: Boolean(row.sample),
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
    }),
  },
};

export function getResource(db, table, id) {
  const definition = resourceDefinitions[table];
  if (!definition) throw new Error('Unknown resource');
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  return row ? definition.convert(row) : null;
}

export function listResources(db, table) {
  const definition = resourceDefinitions[table];
  if (!definition) throw new Error('Unknown resource');
  return db
    .prepare(`SELECT * FROM ${table} ORDER BY updated_at DESC, id ASC`)
    .all()
    .map(definition.convert);
}

export function insertResource(db, table, values, timestamp, id) {
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
  db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...params);
  return getResource(db, table, params[0]);
}

export function updateResource(db, table, id, values, timestamp) {
  const definition = resourceDefinitions[table];
  if (!definition) throw new Error('Unknown resource');
  const fields = Object.keys(values).filter((key) => Object.hasOwn(definition.columns, key));
  if (fields.length) {
    const assignments = fields.map((key) => `${definition.columns[key]} = ?`);
    db.prepare(`UPDATE ${table} SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`).run(
      ...fields.map((key) => values[key]),
      timestamp,
      id,
    );
  }
  return getResource(db, table, id);
}
