import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Check,
  CircleAlert,
  Film,
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
  storage: {
    configured: boolean;
    maxBytes: number;
    accept: string[];
    videoMaxBytes?: number;
    maxVideoBytes?: number;
  };
};
type UploadTicket = {
  uploadId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
};
export const formatFileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
export const isVideoAsset = (asset?: MediaAsset | null) =>
  asset?.kind === 'video' || asset?.mimeType.startsWith('video/');
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
export function MediaThumbnail({
  asset,
  controls = false,
  className = '',
}: {
  asset: MediaAsset;
  controls?: boolean;
  className?: string;
}) {
  const url = assetImageUrl(asset);
  if (!url) return <Images size={28} />;
  return isVideoAsset(asset) ? (
    <video
      className={className}
      src={url}
      controls={controls}
      preload="metadata"
      playsInline
      muted={!controls}
      aria-label={asset.name}
    />
  ) : (
    <img className={className} src={url} loading="lazy" alt={asset.name} />
  );
}

export default function MediaLibrary({
  selectedId,
  selectedIds,
  retainedAssetId,
  retainedAssetIds,
  onSelect,
  onSelectMany,
  maxSelect = 10,
  mediaKind = 'all',
  onClose,
}: {
  selectedId?: string | null;
  selectedIds?: string[];
  retainedAssetId?: string | null;
  retainedAssetIds?: string[];
  onSelect?: (asset: MediaAsset) => void;
  onSelectMany?: (assets: MediaAsset[]) => void;
  maxSelect?: number;
  mediaKind?: 'all' | 'image' | 'video';
  onClose: () => void;
}) {
  const { data, request, refresh, toast } = useWorkspace();
  const [catalog, setCatalog] = useState<MediaCatalog | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>(mediaKind);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadName, setUploadName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<string[]>(
    () => selectedIds || (selectedId ? [selectedId] : []),
  );
  const input = useRef<HTMLInputElement>(null);
  const activeUpload = useRef<XMLHttpRequest | null>(null);
  const activeController = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const multiple = Boolean(onSelectMany);
  const choosing = Boolean(onSelect || onSelectMany);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    request<MediaCatalog>('/media', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setCatalog(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'Your media library could not load.');
      });
    return () => {
      alive.current = false;
      controller.abort();
      activeController.current?.abort();
      activeUpload.current?.abort();
    };
  }, [request]);
  function choose(asset: MediaAsset) {
    if (multiple)
      setSelection((current) =>
        current.includes(asset.id)
          ? current.filter((id) => id !== asset.id)
          : current.length < maxSelect
            ? [...current, asset.id]
            : current,
      );
    else setSelection([asset.id]);
  }
  async function sendBytes(
    file: File,
    url: string,
    method: string,
    headers: Record<string, string>,
    local: boolean,
    signal: AbortSignal,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeUpload.current = xhr;
      xhr.open(method, url);
      xhr.withCredentials = local;
      xhr.timeout = 180000;
      for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
      if (local) xhr.setRequestHeader('x-csrf-token', data.csrfToken);
      const abort = () => xhr.abort();
      signal.addEventListener('abort', abort, { once: true });
      const finish = () => {
        signal.removeEventListener('abort', abort);
        activeUpload.current = null;
      };
      xhr.upload.onprogress = (event) => {
        if (alive.current && event.lengthComputable)
          setProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        finish();
        let result: unknown;
        try {
          result = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          result = {};
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(result);
        else
          reject(
            new Error(
              typeof (result as { error?: unknown })?.error === 'string'
                ? (result as { error: string }).error
                : 'Your file could not be uploaded. Please try again.',
            ),
          );
      };
      xhr.onerror = () => {
        finish();
        reject(new Error('The upload was interrupted. Check your connection and try again.'));
      };
      xhr.ontimeout = () => {
        finish();
        reject(new Error('The upload took too long. Try a smaller file or a faster connection.'));
      };
      xhr.onabort = () => {
        finish();
        reject(
          new Error(
            'Upload cancelled. If the file had finished transferring, check the library before uploading it again.',
          ),
        );
      };
      if (signal.aborted) {
        finish();
        reject(new Error('Upload cancelled.'));
        return;
      }
      xhr.send(file);
    });
  }
  async function upload(file: File) {
    if (uploading || !catalog?.storage.configured) return;
    setError('');
    const video = file.type === 'video/mp4';
    const accepted = [...catalog.storage.accept, 'video/mp4'];
    if (!accepted.includes(file.type)) {
      setError('Choose a JPEG, PNG, WebP image or an H.264 MP4 video.');
      return;
    }
    const maximum = video
      ? catalog.storage.videoMaxBytes || catalog.storage.maxVideoBytes || 40 * 1024 * 1024
      : catalog.storage.maxBytes;
    if (!file.size || file.size > maximum) {
      setError(`Choose ${video ? 'a video' : 'an image'} smaller than ${formatFileSize(maximum)}.`);
      return;
    }
    if (mediaKind !== 'all' && (video ? 'video' : 'image') !== mediaKind) {
      setError(
        `Choose ${mediaKind === 'video' ? 'an MP4 video' : 'an image'} for this post format.`,
      );
      return;
    }
    setUploading(true);
    setProgress(0);
    setUploadName(file.name);
    const controller = new AbortController();
    activeController.current = controller;
    try {
      let asset: MediaAsset;
      if (video) {
        const ticket = await request<UploadTicket>('/media/uploads', {
          method: 'POST',
          body: JSON.stringify({ name: file.name, mimeType: 'video/mp4', size: file.size }),
          signal: controller.signal,
        });
        const local = ticket.uploadUrl.startsWith('/api/') && !ticket.uploadUrl.startsWith('//');
        if (!local) {
          const url = new URL(ticket.uploadUrl);
          if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            !url.hostname.endsWith('.supabase.co')
          )
            throw new Error('The server returned an unexpected media upload address.');
        }
        await sendBytes(
          file,
          ticket.uploadUrl,
          ticket.method,
          ticket.headers,
          local,
          controller.signal,
        );
        setProgress(100);
        asset = await request<MediaAsset>(
          `/media/uploads/${encodeURIComponent(ticket.uploadId)}/complete`,
          { method: 'POST', body: '{}', signal: controller.signal },
        );
      } else
        asset = (await sendBytes(
          file,
          '/api/media',
          'POST',
          { 'Content-Type': file.type, 'x-file-name': encodeURIComponent(file.name) },
          true,
          controller.signal,
        )) as MediaAsset;
      if (!alive.current) return;
      setCatalog((current) =>
        current
          ? {
              ...current,
              assets: [asset, ...current.assets.filter((item) => item.id !== asset.id)],
            }
          : current,
      );
      setSelection((current) =>
        multiple
          ? [...current.filter((id) => id !== asset.id), asset.id].slice(0, maxSelect)
          : [asset.id],
      );
      toast(`${video ? 'Video' : 'Image'} uploaded to your media library.`);
      try {
        await refresh();
      } catch {
        toast('Your media was saved. Refresh the workspace to update its preview.', 'info');
      }
    } catch (caught) {
      if (alive.current)
        setError(
          controller.signal.aborted
            ? 'Upload cancelled. Refresh the library before retrying if the transfer had completed.'
            : caught instanceof Error
              ? caught.message
              : 'The upload could not be completed.',
        );
    } finally {
      activeUpload.current = null;
      activeController.current = null;
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
      setError('Upload one file at a time. You can select multiple saved images for a carousel.');
      return;
    }
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }
  const available = (catalog?.assets || []).filter(
    (asset) =>
      data.user.role === 'manager' ||
      asset.ownerId === data.user.id ||
      asset.id === retainedAssetId ||
      retainedAssetIds?.includes(asset.id),
  );
  const filtered = available.filter(
    (asset) =>
      asset.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (mediaKind === 'all' || (isVideoAsset(asset) ? 'video' : 'image') === mediaKind) &&
      (filter === 'all' || (isVideoAsset(asset) ? 'video' : 'image') === filter),
  );
  const selected = selection
    .map((id) => available.find((asset) => asset.id === id))
    .filter(
      (asset): asset is MediaAsset =>
        !!asset && (mediaKind === 'all' || (isVideoAsset(asset) ? 'video' : 'image') === mediaKind),
    );
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
          <p>
            {multiple
              ? `Select up to ${maxSelect} images in display order. You can reorder them in the composer.`
              : 'Upload once. Reuse the right images and videos across your content.'}
          </p>
          <Badge>{available.length} files</Badge>
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
              Shared media storage needs configuration before new uploads. Existing library items
              remain available.
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
            accept={
              mediaKind === 'video'
                ? 'video/mp4'
                : mediaKind === 'image'
                  ? 'image/jpeg,image/png,image/webp'
                  : 'image/jpeg,image/png,image/webp,video/mp4'
            }
            tabIndex={-1}
            className="media-file-input"
            aria-label="Choose media to upload"
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
                  {progress >= 100 ? 'Checking and saving your file…' : `Uploading ${progress}%`}
                </strong>
                <span>{uploadName}</span>
                <progress value={progress} max={100} aria-label="Media upload progress" />
              </div>
              <Button variant="ghost" size="sm" onClick={() => activeController.current?.abort()}>
                Cancel upload
              </Button>
            </div>
          ) : (
            <>
              <span className="media-upload-icon">
                {mediaKind === 'video' ? <Film size={24} /> : <ImagePlus size={24} />}
              </span>
              <div>
                <h3>Drop your next creative here</h3>
                <p>
                  {mediaKind === 'video'
                    ? 'H.264 MP4 · Up to 40 MB and 10 minutes'
                    : mediaKind === 'image'
                      ? `JPEG, PNG or WebP · Up to ${formatFileSize(catalog?.storage.maxBytes || 3145728)}`
                      : 'Images up to 3 MB · MP4 videos up to 40 MB'}
                </p>
              </div>
              <Button
                disabled={!catalog?.storage.configured}
                onClick={() => input.current?.click()}
              >
                <Upload size={16} />
                Choose file
              </Button>
            </>
          )}
        </div>
        <p className="media-conversion-note">
          Images are saved as JPEGs; transparent areas become white. Videos must already use MP4
          with H.264 video and optional AAC audio. Preview the saved media before submitting it for
          review.
        </p>
        <div className="media-library-toolbar">
          <h3>Saved media</h3>
          {mediaKind === 'all' && (
            <select
              aria-label="Filter media by type"
              value={filter}
              onChange={(event) => setFilter(event.target.value as typeof filter)}
            >
              <option value="all">All media</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
            </select>
          )}
          <label className="media-search">
            <Search size={16} />
            <input
              type="search"
              aria-label="Search media library"
              placeholder="Find a file…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        {!catalog ? (
          <div className="connection-loading" role="status">
            <LoaderCircle size={20} className="spin" />
            Loading your media…
          </div>
        ) : filtered.length ? (
          <div className="media-library-grid">
            {filtered.map((asset) => {
              const checked = selection.includes(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  className={`media-asset${checked ? ' media-asset-selected' : ''}`}
                  aria-pressed={checked}
                  aria-label={`${choosing ? 'Select' : 'Preview'} ${asset.name}, ${isVideoAsset(asset) ? 'video' : 'image'}, ${asset.width} by ${asset.height} pixels`}
                  disabled={uploading || (multiple && !checked && selection.length >= maxSelect)}
                  onClick={() => choose(asset)}
                >
                  <div className="media-asset-image">
                    <MediaThumbnail asset={asset} />
                    {isVideoAsset(asset) && (
                      <span className="media-video-tag">
                        <Film size={16} />
                      </span>
                    )}
                    {checked && (
                      <span className="media-selection-badge">
                        {multiple ? selection.indexOf(asset.id) + 1 : <Check size={16} />}
                      </span>
                    )}
                  </div>
                  <div className="media-asset-description">
                    <strong>{asset.name}</strong>
                    <span>
                      {asset.width} × {asset.height} · {formatFileSize(asset.size)}
                      {isVideoAsset(asset) && asset.duration
                        ? ` · ${Math.round(asset.duration)}s`
                        : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Images size={29} />}
            title={query ? 'No media matches your search' : 'Give your stories a visual'}
            description={
              query
                ? 'Try part of the file name or a different filter.'
                : 'Upload school photographs, designed creatives, or a prepared MP4 video. Select saved files when preparing a draft.'
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
        {!choosing && selected[0] && isVideoAsset(selected[0]) && (
          <div className="media-video-preview">
            <MediaThumbnail asset={selected[0]} controls />
            <p>{selected[0].name}</p>
          </div>
        )}
        <div className="media-library-footer">
          <span>
            {selected.length ? (
              <>
                <Check size={15} />
                {multiple ? `${selected.length} selected in display order` : selected[0].name}
              </>
            ) : choosing ? (
              'Choose saved media to attach to this draft.'
            ) : (
              'Private files are available to your team in the post editor.'
            )}
          </span>
          <div>
            <Button disabled={uploading} onClick={onClose}>
              Close
            </Button>
            {choosing && (
              <Button
                variant="primary"
                disabled={!selected.length || uploading}
                onClick={() => {
                  if (onSelectMany) onSelectMany(selected);
                  else if (selected[0] && onSelect) onSelect(selected[0]);
                }}
              >
                <Check size={16} />
                {multiple ? 'Use selected images' : 'Use this media'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
