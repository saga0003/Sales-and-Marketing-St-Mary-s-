import { z } from 'zod';
import { HttpError } from '../validation.mjs';
import { publicLink } from './parse.mjs';

export const referenceLinkSchema = z
  .object({ label: z.string().trim().min(1).max(160), url: z.string().trim().min(1).max(2048) })
  .strict();
export const observedAtSchema = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

export function referenceUrl(value) {
  const url = publicLink(value, value);
  if (!url)
    throw new HttpError(
      422,
      'Use a complete public HTTP(S) evidence URL without credentials.',
      'invalid_evidence_url',
    );
  return url;
}

export function references(values) {
  return values.map((item) => ({ label: item.label, url: referenceUrl(item.url) }));
}

export function evidenceUrls(values) {
  return [...new Set(values.map(referenceUrl))];
}

export function requireResearcher(actor) {
  if (!actor?.id || !['manager', 'contributor'].includes(actor.role))
    throw new HttpError(403, 'An active workspace account is required.', 'forbidden');
}

export function requireResearchManager(actor) {
  requireResearcher(actor);
  if (actor.role !== 'manager')
    throw new HttpError(403, 'A manager must review and confirm this action.', 'forbidden');
}

export function checkObservedAt(value, now) {
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds > now().getTime() + 300000 ||
    milliseconds < Date.parse('2000-01-01T00:00:00Z')
  )
    throw new HttpError(
      422,
      'Enter when the source was actually observed; future observations cannot be saved.',
      'invalid_observation_time',
    );
  return new Date(milliseconds).toISOString();
}

export function requireRevision(row, expectedRevision) {
  if (Number(row.revision) !== expectedRevision)
    throw new HttpError(
      409,
      'Someone updated this record. Reload its latest revision before saving your changes.',
      'revision_conflict',
    );
}
