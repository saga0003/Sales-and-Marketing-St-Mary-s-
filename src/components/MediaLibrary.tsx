import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Check,
  CircleAlert,
  ImagePlus,
  Images,
  LoaderCircle,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import type { MediaAsset } from '../lib/types';
import { Badge, Button, EmptyState, Modal } from './UI';
import '../styles/connections.css';

type MediaCatalog = {
  assets: MediaAsset[];
  storage: { configured: boolean; maxBytes: number; accept: string[] };
};
export const formatFileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function assetImageUrl(asset?: MediaAsset | null): string | null {
  if (!asset) return null;
  if (/^\/api\/media\/[a-zA-Z0-9_-]+\/content$/.test(asset.url)) return asset.url;
  try {
    const url = new URL(asset.url);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export default function MediaLibrary({
  selectedId,
  retainedAssetId,
  onSelect,
  onClose,
}: {
  selectedId?: string | null;
  retainedAssetId?: string | null;
  onSelect?: (asset: MediaAsset) => void;
  onClose: () => void;
}) {
  const { data, request, refresh, toast } = useWorkspace();
  const [catalog, setCatalog] = useState<MediaCatalog | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadName, setUploadName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [showSelected, setShowSelected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const activeUpload = useRef<XMLHttpRequest | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    request<MediaCatalog>('/media', { signal: controller.signal })
      .then(setCatalog)
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : 'Your media library could not load.');
      });
    return () => {
      alive.current = false;
      controller.abort();
      activeUpload.current?.abort();
    };
  }, [request]);

  async function upload(file: File) {
    if (uploading || !catalog?.storage.configured) return;
    setError('');
    if (!catalog.storage.accept.includes(file.type)) {
      setError('Choose a JPEG, PNG or WebP image.');
      return;
    }
    if (!file.size || file.size > catalog.storage.maxBytes) {
      setError(`Choose an image smaller than ${formatFileSize(catalog.storage.maxBytes)}.`);
      return;
    }
    setUploading(true);
    setProgress(0);
    setUploadName(file.name);
    try {
      const asset = await new Promise<MediaAsset>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        activeUpload.current = xhr;
        xhr.open('POST', '/api/media');
        xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
        xhr.setRequestHeader('x-csrf-token', data.csrfToken);
        xhr.timeout = 120000;
        xhr.upload.onprogress = (event) => {
          if (alive.current && event.lengthComputable)
            setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          let result: MediaAsset & { error?: string };
          try {
            result = JSON.parse(xhr.responseText);
          } catch {
            reject(new Error('The upload returned an unreadable response. Please try again.'));
            return;
          }
          if (xhr.status >= 200 && xhr.status < 300) resolve(result);
          else
            reject(
              new Error(result.error || 'Your image could not be uploaded. Please try again.'),
            );
        };
        xhr.onerror = () =>
          reject(new Error('The upload was interrupted. Check your connection and try again.'));
        xhr.ontimeout = () => reject(new Error('The upload took too long. Please try again.'));
        xhr.onabort = () => reject(new Error('Upload cancelled.'));
        xhr.send(file);
      });
      if (!alive.current) return;
      setCatalog((current) =>
        current
          ? {
              ...current,
              assets: [asset, ...current.assets.filter((item) => item.id !== asset.id)],
            }
          : current,
      );
      setShowSelected(asset.id);
      toast('Image uploaded to your media library.');
      await refresh();
    } catch (err) {
      if (alive.current)
        setError(err instanceof Error ? err.message : 'The upload could not be completed.');
    } finally {
      activeUpload.current = null;
      if (alive.current) {
        setUploading(false);
        setUploadName('');
      }
    }
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 1) {
      setError('Upload one image at a time.');
      return;
    }
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }
  const available = (catalog?.assets || []).filter(
    (asset) =>
      data.user.role === 'manager' ||
      asset.ownerId === data.user.id ||
      asset.id === retainedAssetId,
  );
  const filtered = available.filter((asset) =>
    asset.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selected = available.find((asset) => asset.id === (showSelected || selectedId));

  return (
    <Modal
      title="Your media library"
      className="media-library-modal"
      onClose={() => {
        if (!uploading) onClose();
      }}
    >
      <div className="media-library">
        <div className="media-library-heading">
          <p>Upload once. Reuse the right image across your content.</p>
          <Badge>{available.length} images</Badge>
        </div>
        {error && (
          <div className="connection-alert" role="alert">
            <CircleAlert size={18} />
            <p>{error}</p>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss upload message"
              onClick={() => setError('')}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {catalog && !catalog.storage.configured && (
          <div className="modal-note">
            <CircleAlert size={18} />
            <span>
              Shared media storage needs to be configured before new files can be uploaded. Existing
              library items remain available.
            </span>
          </div>
        )}
        <div
          className={`media-upload-area${dragging ? ' media-upload-dragging' : ''}${uploading ? ' media-upload-busy' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!uploading && catalog?.storage.configured) setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={drop}
        >
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            tabIndex={-1}
            className="media-file-input"
            aria-label="Choose image to upload"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
          {uploading ? (
            <div className="media-upload-progress" role="status">
              <LoaderCircle size={24} className="spin" />
              <div>
                <strong>
                  {progress >= 100 ? 'Checking and saving your image…' : `Uploading ${progress}%`}
                </strong>
                <span>{uploadName}</span>
                <progress value={progress} max={100} aria-label="Image upload progress" />
              </div>
              <Button variant="ghost" size="sm" onClick={() => activeUpload.current?.abort()}>
                Cancel upload
              </Button>
            </div>
          ) : (
            <>
              <span className="media-upload-icon">
                <ImagePlus size={24} />
              </span>
              <div>
                <h3>Drop your next creative here</h3>
                <p>
                  JPEG, PNG or WebP · Up to {formatFileSize(catalog?.storage.maxBytes || 3145728)}
                </p>
              </div>
              <Button
                disabled={!catalog?.storage.configured}
                onClick={() => input.current?.click()}
              >
                <Upload size={16} />
                Choose image
              </Button>
            </>
          )}
        </div>
        <p className="media-conversion-note">
          Uploads are prepared as JPEGs for publishing. Transparent areas become white; the preview
          shows the final saved image.
        </p>
        <div className="media-library-toolbar">
          <h3>Saved images</h3>
          <label className="media-search">
            <Search size={16} />
            <input
              type="search"
              aria-label="Search media library"
              placeholder="Find an image…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {!catalog ? (
          <div className="connection-loading" role="status">
            <LoaderCircle size={20} className="spin" />
            Loading your images…
          </div>
        ) : filtered.length ? (
          <div className="media-library-grid">
            {filtered.map((asset) => {
              const url = assetImageUrl(asset);
              const checked = (showSelected || selectedId) === asset.id;
              return (
                <button
                  key={asset.id}
                  type="button"
                  className={`media-asset${checked ? ' media-asset-selected' : ''}`}
                  aria-pressed={checked}
                  aria-label={`Select ${asset.name}, ${asset.width} by ${asset.height} pixels`}
                  disabled={uploading}
                  onClick={() => setShowSelected(asset.id)}
                >
                  <div className="media-asset-image">
                    {url ? <img src={url} loading="lazy" alt={asset.name} /> : <Images size={28} />}
                    {checked && (
                      <span>
                        <Check size={16} />
                      </span>
                    )}
                  </div>
                  <div className="media-asset-description">
                    <strong>{asset.name}</strong>
                    <span>
                      {asset.width} × {asset.height} · {formatFileSize(asset.size)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Images size={29} />}
            title={query ? 'No images match your search' : 'Give your stories a visual'}
            description={
              query
                ? 'Try part of the file name, or clear the search.'
                : 'Upload your school photographs or designed creatives. Your team can choose them here when preparing a draft.'
            }
            action={
              query ? (
                <Button size="sm" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              ) : undefined
            }
          />
        )}
        <div className="media-library-footer">
          <span>
            {selected ? (
              <>
                <CheckCircleSmall />
                {selected.name}
              </>
            ) : onSelect ? (
              'Choose an image to attach to this draft.'
            ) : (
              'These images are available to your team in the post editor.'
            )}
          </span>
          <div>
            <Button disabled={uploading} onClick={onClose}>
              Close
            </Button>
            {onSelect && (
              <Button
                variant="primary"
                disabled={!selected || uploading}
                onClick={() => {
                  if (selected) onSelect(selected);
                }}
              >
                <Check size={16} />
                Use this image
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CheckCircleSmall() {
  return <Check size={15} />;
}
