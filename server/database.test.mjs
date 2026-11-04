import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, transaction, postgresSql } from './database.mjs';

test('PostgreSQL placeholders leave literals, quoted identifiers and comments intact', () => {
  const query = `SELECT ?, '?', 'It''s ? here', "a?b", $$?$$, $body$?$body$ -- ?\n /* ? */ WHERE id = ?`;
  assert.equal(
    postgresSql(query),
    `SELECT $1, '?', 'It''s ? here', "a?b", $$?$$, $body$?$body$ -- ?\n /* ? */ WHERE id = $2`,
  );
});

test('independent async transactions never join one another or inherit a rollback', async (t) => {
  const db = await openDatabase(':memory:');
  t.after(() => db.close());
  let releaseFirst;
  let firstStarted;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const started = new Promise((resolve) => {
    firstStarted = resolve;
  });
  const first = transaction(db, async () => {
    await db
      .prepare('INSERT INTO workspace_metadata(key, value) VALUES (?, ?)')
      .run('first', 'uncommitted');
    firstStarted();
    await gate;
    throw new Error('Rollback first transaction');
  });
  await started;
  assert.equal(
    db.inTransaction(),
    false,
    'transaction context must not leak to a concurrent request',
  );
  const second = transaction(db, async () => {
    await db
      .prepare('INSERT INTO workspace_metadata(key, value) VALUES (?, ?)')
      .run('second', 'committed');
  });
  const read = db.prepare('SELECT * FROM workspace_metadata ORDER BY key').all();
  releaseFirst();
  const result = await Promise.allSettled([first, second]);
  assert.equal(result[0].status, 'rejected');
  assert.equal(result[1].status, 'fulfilled');
  assert.deepEqual(
    (await read).map((row) => ({ ...row })),
    [{ key: 'second', value: 'committed' }],
  );
});

test('nested savepoints can roll back a child operation while the outer transaction commits', async (t) => {
  const db = await openDatabase(':memory:');
  t.after(() => db.close());
  await transaction(db, async () => {
    await db
      .prepare('INSERT INTO workspace_metadata(key, value) VALUES (?, ?)')
      .run('outer', 'keep');
    await assert.rejects(
      transaction(db, async () => {
        await db
          .prepare('INSERT INTO workspace_metadata(key, value) VALUES (?, ?)')
          .run('inner', 'remove');
        throw new Error('Reject child');
      }),
      /Reject child/,
    );
    assert.ok(await db.prepare('SELECT * FROM workspace_metadata WHERE key = ?').get('outer'));
  });
  assert.equal(
    await db.prepare('SELECT * FROM workspace_metadata WHERE key = ?').get('inner'),
    undefined,
  );
  assert.equal(
    (await db.prepare('SELECT * FROM workspace_metadata WHERE key = ?').get('outer')).value,
    'keep',
  );
});
