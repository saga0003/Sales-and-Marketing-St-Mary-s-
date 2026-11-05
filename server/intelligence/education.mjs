import { z } from 'zod';
import { transaction, makeId, audit } from '../database.mjs';
import { HttpError, parse } from '../validation.mjs';
import {
  referenceLinkSchema,
  references,
  evidenceUrls,
  requireResearcher,
  requireResearchManager,
  requireRevision,
} from './research-common.mjs';

export const EDUCATION_LIMITS = Object.freeze({ exams: 500, pathways: 250 });
export const educationStreams = ['Science', 'Commerce', 'Humanities', 'Vocational', 'Any'];
const stream = z.enum(educationStreams);
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a valid calendar date.');
const milestoneSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    date: calendarDate.optional(),
    notes: z.string().trim().max(2000).default(''),
    referenceUrl: z.string().trim().max(2048).default(''),
  })
  .strict();
const examFields = {
  name: z.string().trim().min(2).max(180),
  category: z.enum(['Entrance', 'Board', 'Counselling', 'Scholarship', 'Recruitment', 'Other']),
  streams: z.array(stream).min(1).max(5),
  description: z.string().trim().min(1).max(6000),
  academicYear: z.string().trim().max(40),
  eligibilityNotes: z.string().trim().max(4000),
  referenceLinks: z.array(referenceLinkSchema).min(1).max(20),
  milestones: z.array(milestoneSchema).max(30),
  watchIds: z.array(z.string().min(1).max(200)).max(12),
  status: z.enum(['draft', 'tracking', 'archived']),
};
export const examSchema = z
  .object({
    ...examFields,
    academicYear: examFields.academicYear.default(''),
    eligibilityNotes: examFields.eligibilityNotes.default(''),
    milestones: examFields.milestones.default([]),
    watchIds: examFields.watchIds.default([]),
    status: examFields.status.default('draft'),
  })
  .strict();
export const examPatchSchema = z
  .object(examFields)
  .partial()
  .extend({
    expectedRevision: z.number().int().min(1),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, 'Provide a change to save.');
const entryRouteSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    method: z.string().trim().min(1).max(2000),
    examIds: z.array(z.string().min(1).max(200)).max(12).default([]),
    requirements: z.string().trim().max(3000).default(''),
    education: z.string().trim().max(3000).default(''),
    outcomes: z.string().trim().max(3000).default(''),
    referenceUrls: z.array(z.string().trim().min(1).max(2048)).max(12).default([]),
  })
  .strict();
const pathwayFields = {
  name: z.string().trim().min(2).max(180),
  stream,
  field: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(6000),
  academicYear: z.string().trim().max(40),
  eligibilityNotes: z.string().trim().max(4000),
  entryRoutes: z.array(entryRouteSchema).max(12),
  referenceLinks: z.array(referenceLinkSchema).max(20),
  status: z.enum(['draft', 'active', 'archived']),
};
export const pathwaySchema = z
  .object({
    ...pathwayFields,
    academicYear: pathwayFields.academicYear.default(''),
    eligibilityNotes: pathwayFields.eligibilityNotes.default(''),
    entryRoutes: pathwayFields.entryRoutes.default([]),
    referenceLinks: pathwayFields.referenceLinks.default([]),
    status: pathwayFields.status.default('draft'),
  })
  .strict();
export const pathwayPatchSchema = z
  .object(pathwayFields)
  .partial()
  .extend({
    expectedRevision: z.number().int().min(1),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, 'Provide a change to save.');
const verificationSchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

// These labels are planning prompts, not claims about current eligibility.
export const CAREER_STARTER_FIELDS = Object.freeze({
  Science: [
    'Medicine and allied health',
    'Engineering and technology',
    'Pure sciences and research',
    'Agriculture and environment',
    'Architecture and planning',
    'Design and creative technology',
  ],
  Commerce: [
    'Accounting and professional qualifications',
    'Finance and investment',
    'Business and management',
    'Economics and research',
    'Law and public policy',
    'Entrepreneurship',
  ],
  Humanities: [
    'Law and public policy',
    'Languages and communication',
    'Psychology and social sciences',
    'Design and media',
    'Education and public service',
  ],
  Vocational: ['Technical trades', 'Hospitality and tourism', 'Creative and service skills'],
  Any: ['Interdisciplinary options', 'Scholarships and alternative entry routes'],
});

const publicExam = (row, watchIds = []) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  streams: JSON.parse(row.streams),
  description: row.description,
  academicYear: row.academic_year,
  eligibilityNotes: row.eligibility_notes,
  referenceLinks: JSON.parse(row.reference_links),
  milestones: JSON.parse(row.milestones),
  watchIds,
  status: row.status,
  revision: Number(row.revision),
  verification: row.verified_at ? 'verified' : 'unverified',
  verifiedAt: row.verified_at,
  verifiedBy: row.verified_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const publicPathway = (row) => ({
  id: row.id,
  name: row.name,
  stream: row.stream,
  field: row.field,
  description: row.description,
  academicYear: row.academic_year,
  eligibilityNotes: row.eligibility_notes,
  entryRoutes: JSON.parse(row.entry_routes),
  referenceLinks: JSON.parse(row.reference_links),
  status: row.status,
  revision: Number(row.revision),
  verification: row.verified_at ? 'verified' : 'unverified',
  verifiedAt: row.verified_at,
  verifiedBy: row.verified_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function invalidatePathwayEvidence(db, examIds, actor, timestamp) {
  if (!examIds.length) return;
  const ids = new Set(examIds);
  const pathways = await db
    .prepare(
      'SELECT id, name, entry_routes FROM intelligence_career_pathways WHERE verified_at IS NOT NULL',
    )
    .all();
  for (const pathway of pathways) {
    if (!JSON.parse(pathway.entry_routes).some((route) => route.examIds.some((id) => ids.has(id))))
      continue;
    await db
      .prepare(
        'UPDATE intelligence_career_pathways SET verified_at = NULL, verified_by = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND verified_at IS NOT NULL',
      )
      .run(timestamp, pathway.id);
    await audit(
      db,
      actor,
      'Career pathway updated',
      pathway.id,
      `${pathway.name}: a linked exam changed. Review its entry routes again before sharing guidance.`,
      timestamp,
    );
  }
}

export async function invalidateExamEvidenceForWatch(db, watchId, timestamp) {
  const exams = await db
    .prepare(
      `SELECT e.id, e.name FROM intelligence_exams e JOIN intelligence_exam_watches w ON w.exam_id = e.id WHERE w.watch_id = ? AND e.verified_at IS NOT NULL`,
    )
    .all(watchId);
  for (const exam of exams) {
    await db
      .prepare(
        'UPDATE intelligence_exams SET verified_at = NULL, verified_by = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND verified_at IS NOT NULL',
      )
      .run(timestamp, exam.id);
    await audit(
      db,
      null,
      'Exam updated',
      exam.id,
      `${exam.name}: a linked official watch detected new or changed notice metadata. Source review is required again.`,
      timestamp,
    );
  }
  await invalidatePathwayEvidence(
    db,
    exams.map((exam) => exam.id),
    null,
    timestamp,
  );
}

export function createEducationService({ db, now }) {
  const stamp = () => now().toISOString();
  async function row(table, id, lock = false) {
    const found = await db
      .prepare(`SELECT * FROM ${table} WHERE id = ?${lock ? db.lockSuffix : ''}`)
      .get(id);
    if (!found)
      throw new HttpError(404, 'This education record was not found.', 'education_not_found');
    return found;
  }
  async function lockCatalog() {
    if (db.kind === 'postgres')
      await db
        .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
        .get(`smis:${db.schema}:education-catalog`);
  }
  async function listExams() {
    const rows = await db
      .prepare('SELECT * FROM intelligence_exams ORDER BY name, academic_year, id')
      .all();
    const links = await db
      .prepare('SELECT exam_id, watch_id FROM intelligence_exam_watches ORDER BY watch_id')
      .all();
    return rows.map((item) =>
      publicExam(
        item,
        links.filter((link) => link.exam_id === item.id).map((link) => link.watch_id),
      ),
    );
  }
  async function getExam(id) {
    return publicExam(
      await row('intelligence_exams', id),
      (
        await db
          .prepare(
            'SELECT watch_id FROM intelligence_exam_watches WHERE exam_id = ? ORDER BY watch_id',
          )
          .all(id)
      ).map((item) => item.watch_id),
    );
  }
  async function normalizedExam(input) {
    const value = {
      ...input,
      streams: [...new Set(input.streams)],
      watchIds: [...new Set(input.watchIds)],
      referenceLinks: references(input.referenceLinks),
      milestones: input.milestones.map((item) => ({
        ...item,
        referenceUrl: item.referenceUrl ? evidenceUrls([item.referenceUrl])[0] : '',
      })),
    };
    for (const id of value.watchIds) {
      if (
        !(await db
          .prepare("SELECT id FROM intelligence_watches WHERE id = ? AND kind = 'source'")
          .get(id))
      )
        throw new HttpError(
          422,
          'Link an existing official-source watch to the exam. Competitor watches cannot establish exam evidence.',
          'invalid_exam_watch',
        );
    }
    return value;
  }
  async function setWatches(id, watchIds) {
    await db.prepare('DELETE FROM intelligence_exam_watches WHERE exam_id = ?').run(id);
    for (const watchId of watchIds)
      await db
        .prepare('INSERT INTO intelligence_exam_watches(exam_id, watch_id) VALUES (?, ?)')
        .run(id, watchId);
  }
  async function createExam(raw, actor) {
    requireResearcher(actor);
    const input = parse(examSchema, raw);
    if (input.status === 'archived') requireResearchManager(actor);
    return transaction(db, async () => {
      await lockCatalog();
      if (
        Number(
          (await db.prepare('SELECT count(*) AS count FROM intelligence_exams').get()).count,
        ) >= EDUCATION_LIMITS.exams
      )
        throw new HttpError(
          409,
          'The exam registry is full. Review existing records before adding more.',
          'exam_limit',
        );
      if (
        await db
          .prepare(
            'SELECT id FROM intelligence_exams WHERE lower(name) = lower(?) AND academic_year = ?',
          )
          .get(input.name, input.academicYear)
      )
        throw new HttpError(
          409,
          'This exam and academic year are already in the registry. Update the existing record.',
          'exam_exists',
        );
      const value = await normalizedExam(input),
        id = makeId('exam'),
        timestamp = stamp();
      await db
        .prepare(
          `INSERT INTO intelligence_exams(id,name,category,streams,description,academic_year,eligibility_notes,reference_links,milestones,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          value.name,
          value.category,
          JSON.stringify(value.streams),
          value.description,
          value.academicYear,
          value.eligibilityNotes,
          JSON.stringify(value.referenceLinks),
          JSON.stringify(value.milestones),
          value.status,
          actor.id,
          timestamp,
          timestamp,
        );
      await setWatches(id, value.watchIds);
      await audit(
        db,
        actor,
        'Exam added',
        id,
        `${value.name}: a source-linked registry record was saved. Eligibility and dates await manager review.`,
        timestamp,
      );
      return getExam(id);
    });
  }
  async function updateExam(id, raw, actor) {
    requireResearcher(actor);
    const input = parse(examPatchSchema, raw);
    if (input.status === 'archived') requireResearchManager(actor);
    return transaction(db, async () => {
      await lockCatalog();
      const current = await row('intelligence_exams', id, true);
      requireRevision(current, input.expectedRevision);
      const before = await getExam(id);
      const value = await normalizedExam(
        parse(examSchema, {
          name: before.name,
          category: before.category,
          streams: before.streams,
          description: before.description,
          academicYear: before.academicYear,
          eligibilityNotes: before.eligibilityNotes,
          referenceLinks: before.referenceLinks,
          milestones: before.milestones,
          watchIds: before.watchIds,
          status: before.status,
          ...Object.fromEntries(
            Object.entries(input).filter(([key]) => key !== 'expectedRevision'),
          ),
        }),
      );
      const duplicate = await db
        .prepare(
          'SELECT id FROM intelligence_exams WHERE lower(name) = lower(?) AND academic_year = ? AND id <> ?',
        )
        .get(value.name, value.academicYear, id);
      if (duplicate)
        throw new HttpError(
          409,
          'Another record already uses this exam name and academic year.',
          'exam_exists',
        );
      await db
        .prepare(
          `UPDATE intelligence_exams SET name=?,category=?,streams=?,description=?,academic_year=?,eligibility_notes=?,reference_links=?,milestones=?,status=?,revision=revision+1,verified_at=NULL,verified_by=NULL,updated_at=? WHERE id=?`,
        )
        .run(
          value.name,
          value.category,
          JSON.stringify(value.streams),
          value.description,
          value.academicYear,
          value.eligibilityNotes,
          JSON.stringify(value.referenceLinks),
          JSON.stringify(value.milestones),
          value.status,
          stamp(),
          id,
        );
      await setWatches(id, value.watchIds);
      await invalidatePathwayEvidence(db, [id], actor, stamp());
      await audit(
        db,
        actor,
        'Exam updated',
        id,
        `${value.name}: revision ${Number(current.revision) + 1} saved. Source verification was cleared for the changed record.`,
        stamp(),
      );
      return getExam(id);
    });
  }
  async function verifyExam(id, raw, actor) {
    requireResearchManager(actor);
    const input = parse(verificationSchema, raw);
    return transaction(db, async () => {
      const current = await row('intelligence_exams', id, true);
      requireRevision(current, input.expectedRevision);
      if (current.status === 'archived')
        throw new HttpError(409, 'Restore an archived exam before reviewing it.', 'archived_exam');
      await db
        .prepare(
          'UPDATE intelligence_exams SET verified_at = ?, verified_by = ?, updated_at = ? WHERE id = ?',
        )
        .run(stamp(), actor.id, stamp(), id);
      await audit(
        db,
        actor,
        'Exam verified',
        id,
        `${current.name}: manager reviewed the cited sources for revision ${current.revision}.`,
        stamp(),
      );
      return getExam(id);
    });
  }
  async function listPathways() {
    return (
      await db
        .prepare('SELECT * FROM intelligence_career_pathways ORDER BY stream, field, name, id')
        .all()
    ).map(publicPathway);
  }
  async function getPathway(id) {
    return publicPathway(await row('intelligence_career_pathways', id));
  }
  async function normalizedPathway(input) {
    const value = {
      ...input,
      referenceLinks: references(input.referenceLinks),
      entryRoutes: input.entryRoutes.map((route) => ({
        ...route,
        examIds: [...new Set(route.examIds)],
        referenceUrls: evidenceUrls(route.referenceUrls),
      })),
    };
    for (const examId of new Set(value.entryRoutes.flatMap((route) => route.examIds)))
      await row('intelligence_exams', examId);
    return value;
  }
  async function createPathway(raw, actor) {
    requireResearcher(actor);
    const input = parse(pathwaySchema, raw);
    if (input.status === 'archived') requireResearchManager(actor);
    return transaction(db, async () => {
      await lockCatalog();
      if (
        Number(
          (await db.prepare('SELECT count(*) AS count FROM intelligence_career_pathways').get())
            .count,
        ) >= EDUCATION_LIMITS.pathways
      )
        throw new HttpError(
          409,
          'The pathway registry is full. Review existing pathways first.',
          'pathway_limit',
        );
      const value = await normalizedPathway(input),
        id = makeId('pathway'),
        timestamp = stamp();
      await db
        .prepare(
          `INSERT INTO intelligence_career_pathways(id,name,stream,field,description,academic_year,eligibility_notes,entry_routes,reference_links,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          value.name,
          value.stream,
          value.field,
          value.description,
          value.academicYear,
          value.eligibilityNotes,
          JSON.stringify(value.entryRoutes),
          JSON.stringify(value.referenceLinks),
          value.status,
          actor.id,
          timestamp,
          timestamp,
        );
      await audit(
        db,
        actor,
        'Career pathway added',
        id,
        `${value.name}: a planning record was saved. Entry rules and outcomes await source review.`,
        timestamp,
      );
      return getPathway(id);
    });
  }
  async function updatePathway(id, raw, actor) {
    requireResearcher(actor);
    const input = parse(pathwayPatchSchema, raw);
    if (input.status === 'archived') requireResearchManager(actor);
    return transaction(db, async () => {
      await lockCatalog();
      const current = await row('intelligence_career_pathways', id, true);
      requireRevision(current, input.expectedRevision);
      const before = publicPathway(current);
      const value = await normalizedPathway(
        parse(pathwaySchema, {
          name: before.name,
          stream: before.stream,
          field: before.field,
          description: before.description,
          academicYear: before.academicYear,
          eligibilityNotes: before.eligibilityNotes,
          entryRoutes: before.entryRoutes,
          referenceLinks: before.referenceLinks,
          status: before.status,
          ...Object.fromEntries(
            Object.entries(input).filter(([key]) => key !== 'expectedRevision'),
          ),
        }),
      );
      await db
        .prepare(
          `UPDATE intelligence_career_pathways SET name=?,stream=?,field=?,description=?,academic_year=?,eligibility_notes=?,entry_routes=?,reference_links=?,status=?,revision=revision+1,verified_at=NULL,verified_by=NULL,updated_at=? WHERE id=?`,
        )
        .run(
          value.name,
          value.stream,
          value.field,
          value.description,
          value.academicYear,
          value.eligibilityNotes,
          JSON.stringify(value.entryRoutes),
          JSON.stringify(value.referenceLinks),
          value.status,
          stamp(),
          id,
        );
      await audit(
        db,
        actor,
        'Career pathway updated',
        id,
        `${value.name}: revision ${Number(current.revision) + 1} saved. Review the changed guidance before sharing it.`,
        stamp(),
      );
      return getPathway(id);
    });
  }
  async function verifyPathway(id, raw, actor) {
    requireResearchManager(actor);
    const input = parse(verificationSchema, raw);
    return transaction(db, async () => {
      await lockCatalog();
      const current = await row('intelligence_career_pathways', id, true);
      requireRevision(current, input.expectedRevision);
      const value = publicPathway(current);
      if (
        value.status === 'archived' ||
        !value.entryRoutes.length ||
        (!value.referenceLinks.length &&
          !value.entryRoutes.some((route) => route.referenceUrls.length))
      )
        throw new HttpError(
          422,
          'Add at least one entry route and a supporting source before verifying an active pathway.',
          'pathway_evidence_required',
        );
      for (const examId of new Set(value.entryRoutes.flatMap((route) => route.examIds))) {
        const exam = await row('intelligence_exams', examId);
        if (!exam.verified_at || exam.status === 'archived')
          throw new HttpError(
            409,
            'Review the linked exam records before verifying this pathway.',
            'exam_review_required',
          );
      }
      await db
        .prepare(
          'UPDATE intelligence_career_pathways SET verified_at=?,verified_by=?,updated_at=? WHERE id=?',
        )
        .run(stamp(), actor.id, stamp(), id);
      await audit(
        db,
        actor,
        'Career pathway verified',
        id,
        `${current.name}: manager reviewed the cited sources and linked exam records for revision ${current.revision}.`,
        stamp(),
      );
      return getPathway(id);
    });
  }
  return {
    listExams,
    getExam,
    createExam,
    updateExam,
    verifyExam,
    listPathways,
    getPathway,
    createPathway,
    updatePathway,
    verifyPathway,
  };
}

export function registerEducationRoutes(app, { requireAuth, requireManager }, service) {
  app.get('/api/intelligence/education', requireAuth, async (_request, response) =>
    response.json({
      exams: await service.listExams(),
      pathways: await service.listPathways(),
      starterFields: CAREER_STARTER_FIELDS,
      streams: educationStreams,
    }),
  );
  app.get('/api/intelligence/exams', requireAuth, async (_request, response) =>
    response.json({ exams: await service.listExams() }),
  );
  app.get('/api/intelligence/exams/:id', requireAuth, async (request, response) =>
    response.json({ exam: await service.getExam(request.params.id) }),
  );
  app.post('/api/intelligence/exams', requireAuth, async (request, response) =>
    response.status(201).json({ exam: await service.createExam(request.body, request.auth.user) }),
  );
  app.patch('/api/intelligence/exams/:id', requireAuth, async (request, response) =>
    response.json({
      exam: await service.updateExam(request.params.id, request.body, request.auth.user),
    }),
  );
  app.post(
    '/api/intelligence/exams/:id/verify',
    requireAuth,
    requireManager,
    async (request, response) =>
      response.json({
        exam: await service.verifyExam(request.params.id, request.body, request.auth.user),
      }),
  );
  app.get('/api/intelligence/pathways', requireAuth, async (_request, response) =>
    response.json({ pathways: await service.listPathways() }),
  );
  app.get('/api/intelligence/pathways/:id', requireAuth, async (request, response) =>
    response.json({ pathway: await service.getPathway(request.params.id) }),
  );
  app.post('/api/intelligence/pathways', requireAuth, async (request, response) =>
    response
      .status(201)
      .json({ pathway: await service.createPathway(request.body, request.auth.user) }),
  );
  app.patch('/api/intelligence/pathways/:id', requireAuth, async (request, response) =>
    response.json({
      pathway: await service.updatePathway(request.params.id, request.body, request.auth.user),
    }),
  );
  app.post(
    '/api/intelligence/pathways/:id/verify',
    requireAuth,
    requireManager,
    async (request, response) =>
      response.json({
        pathway: await service.verifyPathway(request.params.id, request.body, request.auth.user),
      }),
  );
}
