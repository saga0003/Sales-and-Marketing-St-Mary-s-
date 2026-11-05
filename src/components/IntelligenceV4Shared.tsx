import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './UI';
import type { ReferenceLink, ResearchRequest } from './intelligence-v4-types';

export const intelligenceError = (error: unknown) =>
  error instanceof Error ? error.message : 'This action could not finish. Please try again.';
export const researchStamp = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      }) + ' IST'
    : 'Not recorded';
export const publicHref = (value: string) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};
export const lines = (value: string) => [
  ...new Set(
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  ),
];
export const localInputNow = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function EvidenceLink({ url, children }: { url: string; children?: ReactNode }) {
  const href = publicHref(url);
  return href ? (
    <a className="iv4-source-link" href={href} target="_blank" rel="noopener noreferrer">
      {children || new URL(href).hostname}
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  ) : (
    <span className="muted">Invalid source URL</span>
  );
}
export function References({ links }: { links: ReferenceLink[] }) {
  return (
    <div className="iv4-links">
      {links.map((link, index) => (
        <EvidenceLink key={`${link.url}-${index}`} url={link.url}>
          {link.label}
        </EvidenceLink>
      ))}
    </div>
  );
}
export function ReferenceEditor({
  value,
  onChange,
  required = false,
}: {
  value: ReferenceLink[];
  onChange: (value: ReferenceLink[]) => void;
  required?: boolean;
}) {
  return (
    <fieldset className="iv4-fieldset">
      <legend>Reference sources{required ? ' *' : ''}</legend>
      <p className="iv4-help">
        Use original authority notices or prospectuses. Add the exact page that supports the
        details.
      </p>
      {value.map((link, index) => (
        <div className="iv4-reference-row" key={index}>
          <label className="field">
            <span>Source name</span>
            <input
              required
              maxLength={160}
              value={link.label}
              onChange={(event) =>
                onChange(
                  value.map((item, at) =>
                    at === index ? { ...item, label: event.target.value } : item,
                  ),
                )
              }
              placeholder="Official notice"
            />
          </label>
          <label className="field">
            <span>Source URL</span>
            <input
              required
              type="url"
              maxLength={2048}
              value={link.url}
              onChange={(event) =>
                onChange(
                  value.map((item, at) =>
                    at === index ? { ...item, url: event.target.value } : item,
                  ),
                )
              }
              placeholder="https://…"
            />
          </label>
          <Button
            aria-label={`Remove reference ${index + 1}`}
            disabled={required && value.length === 1}
            onClick={() => onChange(value.filter((_, at) => at !== index))}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        disabled={value.length >= 20}
        onClick={() => onChange([...value, { label: '', url: '' }])}
      >
        <Plus size={15} />
        Add source
      </Button>
    </fieldset>
  );
}
export function chatGptResearchUrl(request: ResearchRequest) {
  const prompt = `Use my connected St Mary's Marketing MCP app. Call get_research_context for request ${request.id}. The public reference is ${request.targetUrl}. Research currently accessible public or authorized sources, compare with prior dated observations, and cite the exact URLs inspected. Distinguish a first baseline from new changes and disclose access restrictions. For a competitor use record_competitor_observation with this requestId; for an exam use record_research_result. Save unverified evidence only. Do not approve or publish content. If the MCP app is not connected, ask me to connect it first.`;
  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}
export function OpenResearchChatGPT({ request }: { request: ResearchRequest }) {
  return (
    <a
      className="button button-secondary button-sm"
      href={chatGptResearchUrl(request)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <ExternalLink size={15} />
      Open research in ChatGPT
    </a>
  );
}
