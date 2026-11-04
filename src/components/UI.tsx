import { useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, ComponentType, HTMLAttributes, ReactNode } from 'react';
import { MapPin, Globe, Inbox, X } from 'lucide-react';
import type { Platform, PostStatus } from '../lib/types';

export function Button({
  variant = 'secondary',
  size,
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm';
}) {
  return (
    <button
      type={type}
      className={`button button-${variant} ${size === 'sm' ? 'button-sm' : ''} ${className}`}
      {...props}
    />
  );
}
export function Badge({
  tone = 'gray',
  className = '',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: 'violet' | 'green' | 'amber' | 'red' | 'gray' }) {
  return <span className={`badge badge-${tone} ${className}`} {...props} />;
}
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode | ComponentType<{ size?: number }>;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const Icon = typeof icon === 'function' ? icon : null;
  return (
    <div className="empty-state">
      <div className="empty-icon">
        {Icon ? <Icon size={28} /> : (icon as ReactNode) || <Inbox size={28} />}
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    dialog
      ?.querySelector<HTMLInputElement>(
        'input:not([type="checkbox"]):not([type="radio"]):not([disabled]), textarea:not([disabled])',
      )
      ?.focus();
    const cancel = (event: Event) => {
      event.preventDefault();
      closeRef.current();
    };
    dialog?.addEventListener('cancel', cancel);
    return () => {
      dialog?.removeEventListener('cancel', cancel);
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal-dialog ${className}`}
      onMouseDown={(event) => {
        if (event.target === ref.current) {
          const bounds = ref.current.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export const platformNames: Record<Platform | 'website', string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  google_business: 'Google Business',
  website: 'Website',
};
export function PlatformIcon({
  platform,
  size = 15,
}: {
  platform: Platform | 'website';
  size?: number;
}) {
  const glyph =
    platform === 'instagram' ? (
      <>
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="17.5" cy="6.5" r="1.1" />
      </>
    ) : platform === 'facebook' ? (
      <path d="M14 22v-9h3l.5-4H14V6.5c0-1 .3-1.5 1.8-1.5H18V1.4c-.4-.1-1.7-.2-3.2-.2-3.3 0-5.3 2-5.3 5.5V9H6v4h3.5v9z" />
    ) : platform === 'youtube' ? (
      <>
        <rect x="2" y="5" width="20" height="14" rx="4" />
        <path d="m10 9 6 3-6 3z" fill="white" />
      </>
    ) : platform === 'linkedin' ? (
      <>
        <rect x="3" y="9" width="4" height="12" rx=".5" />
        <circle cx="5" cy="4.5" r="2.2" />
        <path d="M10 9h4v1.7c.7-1.2 1.8-2 3.4-2 3 0 3.6 2 3.6 5V21h-4v-6.5c0-1.6-.3-2.5-1.5-2.5-1.4 0-1.5 1.3-1.5 2.5V21h-4z" />
      </>
    ) : null;
  return (
    <span
      className={`platform-icon platform-${platform}`}
      title={platformNames[platform]}
      aria-label={platformNames[platform]}
    >
      {glyph ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {glyph}
        </svg>
      ) : platform === 'google_business' ? (
        <MapPin size={size} strokeWidth={1.8} />
      ) : (
        <Globe size={size} strokeWidth={1.8} />
      )}
    </span>
  );
}
const statusLabels: Record<PostStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  scheduled: 'Planned',
  published: 'Published',
  rejected: 'Rejected',
};
export function StatusBadge({ status }: { status: PostStatus }) {
  const tones: Record<PostStatus, 'gray' | 'violet' | 'amber' | 'green' | 'red'> = {
    draft: 'gray',
    in_review: 'amber',
    changes_requested: 'amber',
    approved: 'green',
    scheduled: 'violet',
    published: 'green',
    rejected: 'red',
  };
  return (
    <Badge tone={tones[status]}>
      <span className="status-dot" />
      {statusLabels[status]}
    </Badge>
  );
}
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
  return (
    <span title={name} className={`avatar avatar-${size}`}>
      {initials}
    </span>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
