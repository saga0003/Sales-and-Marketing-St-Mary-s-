import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HttpError, parse } from './validation.mjs';

const postActions = new Map([
  ['Submitted for review', ['review_requested', 'A post is ready for review']],
  ['Draft approved', ['approved', 'Your post was approved']],
  ['Draft rejected', ['rejected', 'A post was rejected']],
  ['Changes requested', ['changes_requested', 'Changes were requested']],
  ['Draft edited', ['post_updated', 'A post was updated']],
  ['Comment added', ['comment', 'New feedback on a post']],
  ['Added to schedule', ['scheduled', 'A post was scheduled']],
  ['Removed from schedule', ['unscheduled', 'A post was unscheduled']],
  ['Approved publication queued', ['queued', 'An approved post is queued']],
  ['Publication confirmed', ['published', 'A post was published']],
  ['Publication published', ['published', 'A post was published']],
  ['Publication failed', ['publication_failed', 'A publication needs attention']],
  ['Publication needs reconciliation', ['publication_uncertain', 'Check a publication result']],
  ['Publication cancelled', ['publication_cancelled', 'A publication was cancelled']],
  ['Publication retried', ['publication_retry', 'A publication will be retried']],
]);

// Called in the same database transaction as the originating audit record. The
// per-event/per-recipient unique key makes delivery durable and retry-safe.
export async function notificationsForAudit(db, event) {
  const { id, actor, action, entityId, detail, timestamp } = event;
  let recipients = [];
  let entityType;
  let kind;
  let title;
  let label = '';
  if (postActions.has(action)) {
    const post = await db
      .prepare('SELECT id, title, owner_id FROM posts WHERE id = ?')
      .get(entityId);
    if (!post) return;
    entityType = 'post';
    [kind, title] = postActions.get(action);
    label = post.title;
    recipients = await db
      .prepare("SELECT id FROM users WHERE active = 1 AND (role = 'manager' OR id = ?)")
      .all(post.owner_id);
    if (action === 'Comment added') {
      recipients.push(
        ...(await db
          .prepare(
            'SELECT DISTINCT users.id FROM post_comments JOIN users ON users.id = post_comments.author_id WHERE post_comments.post_id = ? AND users.active = 1',
          )
          .all(entityId)),
      );
    }
  } else if (/^Document (added|updated|deleted)$/.test(action)) {
    entityType = 'document';
    kind = 'document_updated';
    title = action;
    label =
      (await db.prepare('SELECT title FROM documents WHERE id = ?').get(entityId))?.title ?? '';
    recipients = await db.prepare('SELECT id FROM users WHERE active = 1').all();
  } else if (/^Task (added|updated|deleted)$/.test(action)) {
    entityType = 'task';
    kind = 'task_updated';
    title = action;
    const task = await db.prepare('SELECT title, owner FROM tasks WHERE id = ?').get(entityId);
    label = task?.title ?? '';
    recipients = await db
      .prepare(
        "SELECT id FROM users WHERE active = 1 AND (role = 'manager' OR id = ? OR name = ? OR email = ?)",
      )
      .all(task?.owner ?? '', task?.owner ?? '', task?.owner ?? '');
  } else if (
    /^(Research brief|Research source changed|Opportunity|New notices|Monitor|SEO audit|Connection needs|Scheduled report import failed)/i.test(
      action,
    )
  ) {
    entityType = /^(Connection|Scheduled report)/.test(action) ? 'connection' : 'intelligence';
    kind = 'workspace_update';
    title = action;
    recipients = await db
      .prepare("SELECT id FROM users WHERE active = 1 AND role = 'manager'")
      .all();
  } else return;
  const message = [label, detail].filter(Boolean).join(' · ').slice(0, 4000);
  for (const userId of new Set(recipients.map((row) => row.id))) {
    if (userId === actor?.id) continue;
    const notificationId = `notification_${createHash('sha256').update(`${id}:${userId}`).digest('hex').slice(0, 32)}`;
    await db
      .prepare(
        `INSERT INTO notifications(id,event_id,user_id,kind,title,message,entity_type,entity_id,actor_name,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id,user_id) DO NOTHING`,
      )
      .run(
        notificationId,
        id,
        userId,
        kind,
        title,
        message,
        entityType,
        entityId,
        actor?.name ?? 'Workspace automation',
        timestamp,
      );
  }
}

export async function notificationInbox(db, userId) {
  const rows = await db
    .prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100',
    )
    .all(userId);
  const preference = await db
    .prepare('SELECT sound, desktop FROM notification_preferences WHERE user_id = ?')
    .get(userId);
  const count = await db
    .prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(userId);
  return {
    notifications: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      message: row.message,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorName: row.actor_name,
      createdAt: row.created_at,
      readAt: row.read_at,
    })),
    unreadCount: Number(count.count),
    preferences: {
      sound: Number(preference?.sound ?? 0) === 1,
      desktop: Number(preference?.desktop ?? 0) === 1,
    },
  };
}

export function registerNotifications(app, { db, now }) {
  app.get('/api/notifications', async (request, response) =>
    response.json(await notificationInbox(db, request.auth.user.id)),
  );
  app.post('/api/notifications/read-all', async (request, response) => {
    parse(z.object({}).strict(), request.body ?? {});
    const stamp = now().toISOString();
    await db
      .prepare(
        'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND created_at <= ?',
      )
      .run(stamp, request.auth.user.id, stamp);
    response.json({ ok: true });
  });
  app.post('/api/notifications/:id/read', async (request, response) => {
    parse(z.object({}).strict(), request.body ?? {});
    const result = await db
      .prepare(
        'UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?',
      )
      .run(now().toISOString(), request.params.id, request.auth.user.id);
    if (!result.changes) throw new HttpError(404, 'This notification was not found.', 'not_found');
    response.json({ ok: true });
  });
  app.patch('/api/notifications/preferences', async (request, response) => {
    const value = parse(
      z
        .object({ sound: z.boolean().optional(), desktop: z.boolean().optional() })
        .strict()
        .refine((v) => Object.keys(v).length > 0, 'Choose a notification preference.'),
      request.body,
    );
    await db.transaction(async () => {
      await db
        .prepare(
          'INSERT INTO notification_preferences(user_id,sound,desktop,updated_at) VALUES(?,0,0,?) ON CONFLICT(user_id) DO NOTHING',
        )
        .run(request.auth.user.id, now().toISOString());
      const fields = Object.keys(value);
      await db
        .prepare(
          `UPDATE notification_preferences SET ${fields.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE user_id = ?`,
        )
        .run(...fields.map((key) => Number(value[key])), now().toISOString(), request.auth.user.id);
    });
    response.json({ preferences: (await notificationInbox(db, request.auth.user.id)).preferences });
  });
}
