import { z } from 'zod';
import { transaction, makeId, audit } from '../database.mjs';
import { HttpError, parse } from '../validation.mjs';
import { publicHttpsUrl } from './safe-fetch.mjs';
import { publicLink } from './parse.mjs';
import { INTELLIGENCE_LIMITS } from './catalog.mjs';

const fields = {
  prompt: z.string().trim().min(5).max(3000),
  intent: z.string().trim().min(1).max(300),
  institution: z.string().trim().min(1).max(180),
  locale: z.string().trim().min(1).max(180),
  language: z.string().trim().min(1).max(80),
  targetUrl: z.string().trim().min(1).max(2048),
  active: z.boolean(),
};
const promptSchema = z.object({ ...fields, active: fields.active.default(true) }).strict();
const promptPatch = z
  .object(fields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one prompt setting.');
const observationSchema = z
  .object({
    promptId: z.string().min(1).max(200),
    provider: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(120),
    checkedAt: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value).toISOString()),
    answerExcerpt: z.string().trim().min(1).max(6000),
    mentioned: z.boolean(),
    cited: z.boolean(),
    citationUrls: z.array(z.string().trim().min(1).max(2048)).max(30),
    evidenceUrl: z.string().trim().max(2048).default(''),
    notes: z.string().trim().max(3000).default(''),
  })
  .strict();

function publicPrompt(row) {
  return {
    id: row.id,
    prompt: row.prompt,
    intent: row.intent,
    institution: row.institution,
    locale: row.locale,
    language: row.language,
    targetUrl: row.target_url,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function publicObservation(row) {
  return {
    id: row.id,
    promptId: row.prompt_id,
    provider: row.provider,
    model: row.model,
    checkedAt: row.checked_at,
    answerExcerpt: row.answer_excerpt,
    mentioned: Number(row.mentioned) === 1,
    cited: Number(row.cited) === 1,
    citationUrls: JSON.parse(row.citation_urls),
    evidenceUrl: row.evidence_url,
    notes: row.notes,
    recordedBy: row.recorded_name || 'Former team member',
    createdAt: row.created_at,
    promptSnapshot: JSON.parse(row.prompt_snapshot),
  };
}

function referenceUrl(value) {
  const valid = publicLink(value, value);
  if (!valid)
    throw new HttpError(
      422,
      'Use a public HTTP(S) URL for evidence and citations.',
      'invalid_evidence_url',
    );
  return valid;
}

export function createAnswerService({ db, now }) {
  const stamp = () => now().toISOString();
  async function get(id, lock = false) {
    const row = await db
      .prepare(`SELECT * FROM intelligence_answer_prompts WHERE id = ?${lock ? db.lockSuffix : ''}`)
      .get(id);
    if (!row)
      throw new HttpError(
        404,
        'This answer-test prompt could not be found.',
        'answer_prompt_not_found',
      );
    return row;
  }
  async function prompts() {
    return (
      await db
        .prepare('SELECT * FROM intelligence_answer_prompts ORDER BY updated_at DESC, id DESC')
        .all()
    ).map(publicPrompt);
  }
  async function observations() {
    return (
      await db
        .prepare(
          `SELECT o.*, u.name AS recorded_name FROM intelligence_answer_observations o
      LEFT JOIN users u ON u.id = o.recorded_by ORDER BY o.checked_at DESC, o.id DESC LIMIT 200`,
        )
        .all()
    ).map(publicObservation);
  }
  async function create(input, actor) {
    const url = publicHttpsUrl(input.targetUrl).href;
    return transaction(db, async () => {
      if (db.kind === 'postgres')
        await db
          .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
          .get(`smis:${db.schema}:answer-prompts`);
      const count = await db
        .prepare('SELECT count(*) AS count FROM intelligence_answer_prompts')
        .get();
      if (Number(count.count) >= INTELLIGENCE_LIMITS.maxPrompts)
        throw new HttpError(
          409,
          `This workspace supports up to ${INTELLIGENCE_LIMITS.maxPrompts} answer-test prompts. Remove unused prompts first.`,
          'answer_prompt_limit',
        );
      const id = makeId('answer_prompt');
      const timestamp = stamp();
      await db
        .prepare(
          `INSERT INTO intelligence_answer_prompts
        (id, prompt, intent, institution, locale, language, target_url, active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.prompt,
          input.intent,
          input.institution,
          input.locale,
          input.language,
          url,
          input.active ? 1 : 0,
          actor.id,
          timestamp,
          timestamp,
        );
      await audit(
        db,
        actor,
        'Answer-test prompt created',
        id,
        'Saved a reproducible prompt with language, location and target site. No AI service was called.',
        timestamp,
      );
      return publicPrompt(await get(id));
    });
  }
  async function update(id, input, actor) {
    return transaction(db, async () => {
      const row = await get(id, true);
      const current = publicPrompt(row);
      const value = {
        ...current,
        ...input,
        targetUrl:
          input.targetUrl === undefined ? current.targetUrl : publicHttpsUrl(input.targetUrl).href,
      };
      await db
        .prepare(
          `UPDATE intelligence_answer_prompts SET prompt = ?, intent = ?, institution = ?, locale = ?, language = ?,
        target_url = ?, active = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          value.prompt,
          value.intent,
          value.institution,
          value.locale,
          value.language,
          value.targetUrl,
          value.active ? 1 : 0,
          stamp(),
          id,
        );
      await audit(
        db,
        actor,
        'Answer-test prompt updated',
        id,
        'Earlier observations retain the exact prompt and context used at their recording time.',
        stamp(),
      );
      return publicPrompt(await get(id));
    });
  }
  async function record(input, actor) {
    const checkedAt = new Date(input.checkedAt).getTime();
    if (checkedAt > now().getTime() + 5 * 60000 || checkedAt < Date.UTC(2000, 0, 1))
      throw new HttpError(
        422,
        'Use the actual observation date and time, not a future date.',
        'invalid_observation_time',
      );
    const citationUrls = [...new Set(input.citationUrls.map(referenceUrl))];
    const evidenceUrl = input.evidenceUrl ? referenceUrl(input.evidenceUrl) : '';
    return transaction(db, async () => {
      const prompt = publicPrompt(await get(input.promptId, true));
      const normalizeHost = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      const cited = citationUrls.some(
        (url) => normalizeHost(url) === normalizeHost(prompt.targetUrl),
      );
      if (input.cited !== cited)
        throw new HttpError(
          422,
          cited
            ? 'A citation points to the target website. Mark this observation as cited.'
            : 'To mark the school as cited, include a citation URL on its target website. Other sources can still be recorded.',
          'citation_evidence_mismatch',
        );
      const id = makeId('answer_observation');
      const timestamp = stamp();
      await db
        .prepare(
          `INSERT INTO intelligence_answer_observations
        (id, prompt_id, provider, model, checked_at, answer_excerpt, mentioned, cited, citation_urls,
         evidence_url, notes, prompt_snapshot, recorded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.promptId,
          input.provider,
          input.model,
          input.checkedAt,
          input.answerExcerpt,
          input.mentioned ? 1 : 0,
          cited ? 1 : 0,
          JSON.stringify(citationUrls),
          evidenceUrl,
          input.notes,
          JSON.stringify(prompt),
          actor.id,
          timestamp,
        );
      await audit(
        db,
        actor,
        'Answer observation recorded',
        id,
        `${input.provider} / ${input.model}: manually recorded for ${prompt.language}, ${prompt.locale}. This is an observation, not a search ranking.`,
        timestamp,
      );
      return publicObservation(
        await db
          .prepare(
            `SELECT o.*, u.name AS recorded_name FROM intelligence_answer_observations o
        LEFT JOIN users u ON u.id = o.recorded_by WHERE o.id = ?`,
          )
          .get(id),
      );
    });
  }
  async function remove(kind, id, actor) {
    const table =
      kind === 'prompt' ? 'intelligence_answer_prompts' : 'intelligence_answer_observations';
    return transaction(db, async () => {
      const result = await db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      if (result.changes !== 1)
        throw new HttpError(
          404,
          'This answer-test record could not be found.',
          'answer_record_not_found',
        );
      await audit(
        db,
        actor,
        `Answer ${kind} removed`,
        id,
        kind === 'prompt'
          ? 'The prompt and its observations were removed.'
          : 'The recorded observation was removed.',
        stamp(),
      );
    });
  }
  return { prompts, observations, create, update, record, remove };
}

export function registerAnswerRoutes(app, { requireAuth, requireManager }, service) {
  app.get('/api/intelligence/answer-prompts', requireAuth, async (_request, response) =>
    response.json({ prompts: await service.prompts() }),
  );
  app.post('/api/intelligence/answer-prompts', requireAuth, async (request, response) =>
    response
      .status(201)
      .json({ prompt: await service.create(parse(promptSchema, request.body), request.auth.user) }),
  );
  app.patch('/api/intelligence/answer-prompts/:id', requireAuth, async (request, response) =>
    response.json({
      prompt: await service.update(
        request.params.id,
        parse(promptPatch, request.body),
        request.auth.user,
      ),
    }),
  );
  app.delete(
    '/api/intelligence/answer-prompts/:id',
    requireAuth,
    requireManager,
    async (request, response) => {
      await service.remove('prompt', request.params.id, request.auth.user);
      response.json({ removed: true });
    },
  );
  app.get('/api/intelligence/answer-observations', requireAuth, async (_request, response) =>
    response.json({ observations: await service.observations() }),
  );
  app.post('/api/intelligence/answer-observations', requireAuth, async (request, response) =>
    response.status(201).json({
      observation: await service.record(parse(observationSchema, request.body), request.auth.user),
    }),
  );
  app.delete(
    '/api/intelligence/answer-observations/:id',
    requireAuth,
    requireManager,
    async (request, response) => {
      await service.remove('observation', request.params.id, request.auth.user);
      response.json({ removed: true });
    },
  );
}
