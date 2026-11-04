import { z } from 'zod';

const title = z.string().trim().min(1).max(180);
const shortText = z.string().trim().max(180);
export const role = z.enum(['manager', 'contributor']);
const platform = z.enum(['instagram', 'facebook', 'youtube', 'linkedin', 'google_business']);
const dateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const url = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, 'Use a complete http:// or https:// URL without credentials.');
const optionalUrl = z.union([z.literal(''), url]).optional();
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Use a valid calendar date.');

const postFields = {
  title,
  caption: z.string().trim().max(12000),
  platforms: z
    .array(platform)
    .min(1)
    .max(5)
    .refine((values) => new Set(values).size === values.length, 'Choose each platform only once.'),
  format: z.enum(['Post', 'Carousel', 'Reel', 'Video', 'Article']),
  institution: title,
  scheduledAt: dateTime.nullable(),
  language: z.enum(['English', 'Kannada', 'English + Kannada']),
  palette: z.enum(['violet', 'navy', 'sage', 'peach']),
  sourceUrl: optionalUrl,
  mediaUrl: optionalUrl,
};

export const postCreateSchema = z.object(postFields).strict();
export const postPatchSchema = z
  .object(postFields)
  .partial()
  .extend({ revision: z.number().int().positive() })
  .strict();
export const transitionSchema = z
  .object({
    action: z.enum(['submit', 'approve', 'reject', 'request_changes', 'schedule', 'unschedule']),
    revision: z.number().int().positive(),
    feedback: z.string().trim().max(3000).optional(),
    scheduledAt: dateTime.optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(256),
  })
  .strict();

export const userCreateSchema = z
  .object({
    name: title,
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    role,
    password: z.string().min(12, 'Use at least 12 characters.').max(256),
  })
  .strict();

export const resourceSchemas = {
  competitors: z
    .object({
      name: title,
      platform: z.enum([...platform.options, 'website']),
      url,
      category: shortText.default('Education'),
      notes: z.string().trim().max(4000).default(''),
      monitoringStatus: z.enum(['manual', 'paused']).default('manual'),
    })
    .strict(),
  sources: z
    .object({
      name: title,
      url,
      category: title,
      status: z.enum(['manual', 'paused']).default('manual'),
    })
    .strict(),
  tasks: z
    .object({
      title,
      owner: title,
      dueDate: calendarDate,
      status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
      priority: z.enum(['high', 'medium', 'low']).default('medium'),
    })
    .strict(),
  documents: z
    .object({ title, category: title, content: z.string().max(100000).default('') })
    .strict(),
};

// Defaults are useful on creation, but a partial update must never overwrite an
// omitted field with its creation default (Zod 4 applies nested defaults).
export const resourcePatchSchemas = Object.fromEntries(
  Object.entries(resourceSchemas).map(([key, schema]) => [
    key,
    z
      .object(
        Object.fromEntries(
          Object.entries(schema.shape).map(([field, validator]) => [
            field,
            (validator instanceof z.ZodDefault ? validator.removeDefault() : validator).optional(),
          ]),
        ),
      )
      .strict(),
  ]),
);

export const opportunityCreateSchema = z
  .object({
    title,
    summary: z.string().trim().min(1).max(6000),
    source: title,
    sourceUrl: url,
    category: z.enum([
      'Exam update',
      'Board update',
      'Medical seats',
      'Competitor',
      'Content idea',
    ]),
    publishedAt: dateTime.optional(),
    audience: z.string().trim().min(1).max(300),
    contentAngle: z.string().trim().min(1).max(2000),
    priority: z.enum(['high', 'medium', 'low']),
    sourceKind: z.enum(['official', 'competitor']),
  })
  .strict();

export const opportunityPatchSchema = z
  .object({
    status: z.enum(['new', 'saved', 'dismissed']).optional(),
    verified: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide a status or a verification decision.');

export const opportunityDraftSchema = z
  .object({
    institution: title.optional(),
    platforms: postFields.platforms.optional(),
    format: postFields.format.optional(),
    language: postFields.language.optional(),
  })
  .strict();

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.length ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(422, `${field}${issue.message}`, 'validation_error');
  }
  return result.data;
}
