import { HttpError } from './validation.mjs';
import { hash } from './extensions/crypto.mjs';

export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 512 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 600;

// Inspect ISO BMFF framing and track declarations before accepting an MP4. This
// is format validation, not a transcoder or a claim of full frame decoding.
export function inspectMp4(bytes, inputName = 'school-video.mp4') {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > MAX_VIDEO_BYTES)
    throw new HttpError(413, 'Choose an MP4 video of at most 40 MiB.', 'video_too_large');
  try {
    let boxCount = 0;
    function boxes(start, end) {
      const found = [];
      for (let offset = start; offset < end;) {
        if (++boxCount > 20000 || offset + 8 > end) throw new Error();
        let size = bytes.readUInt32BE(offset);
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        let header = 8;
        if (size === 1) {
          if (offset + 16 > end) throw new Error();
          size = Number(bytes.readBigUInt64BE(offset + 8));
          header = 16;
        } else if (size === 0) size = end - offset;
        if (!Number.isSafeInteger(size) || size < header || offset + size > end) throw new Error();
        found.push({ type, start: offset, payload: offset + header, end: offset + size, size });
        offset += size;
      }
      return found;
    }
    const children = (box) => boxes(box.payload, box.end);
    const one = (items, type) => {
      const selected = items.filter((box) => box.type === type);
      if (selected.length !== 1) throw new Error();
      return selected[0];
    };
    const top = boxes(0, bytes.length);
    const ftyp = one(top, 'ftyp');
    if (ftyp.size < 16 || !top.some((box) => box.type === 'mdat' && box.size > 8))
      throw new Error();
    const brands = [];
    for (let at = ftyp.payload; at + 4 <= ftyp.end; at += 4)
      brands.push(bytes.toString('ascii', at, at + 4));
    if (
      !brands.some((brand) =>
        ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V '].includes(brand),
      )
    )
      throw new Error();
    const movie = children(one(top, 'moov'));
    const tracks = movie.filter((box) => box.type === 'trak');
    if (!tracks.length || tracks.length > 4) throw new Error();
    const videos = [];
    let audio = 0;
    for (const track of tracks) {
      const media = children(one(children(track), 'mdia'));
      const handler = one(media, 'hdlr');
      if (handler.payload + 12 > handler.end) throw new Error();
      const handlerType = bytes.toString('ascii', handler.payload + 8, handler.payload + 12);
      if (!['vide', 'soun'].includes(handlerType)) throw new Error();
      const time = one(media, 'mdhd');
      const version = bytes[time.payload];
      if (![0, 1].includes(version)) throw new Error();
      const offset = time.payload + (version === 1 ? 20 : 12);
      if (offset + (version === 1 ? 12 : 8) > time.end) throw new Error();
      const scale = bytes.readUInt32BE(offset);
      const ticks =
        version === 1 ? Number(bytes.readBigUInt64BE(offset + 4)) : bytes.readUInt32BE(offset + 4);
      const duration = ticks / scale;
      if (!scale || !Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_SECONDS)
        throw new Error();
      const sampleTable = children(one(children(one(media, 'minf')), 'stbl'));
      const stsd = one(sampleTable, 'stsd');
      if (stsd.payload + 8 > stsd.end || bytes.readUInt32BE(stsd.payload + 4) !== 1)
        throw new Error();
      const descriptions = boxes(stsd.payload + 8, stsd.end);
      if (descriptions.length !== 1) throw new Error();
      const description = descriptions[0];
      if (handlerType === 'vide') {
        if (
          !['avc1', 'avc3'].includes(description.type) ||
          description.start + 86 > description.end
        )
          throw new Error();
        const width = bytes.readUInt16BE(description.start + 32);
        const height = bytes.readUInt16BE(description.start + 34);
        if (width < 32 || height < 32 || width > 4096 || height > 4096) throw new Error();
        const avcConfig = boxes(description.start + 86, description.end).find(
          (box) => box.type === 'avcC',
        );
        if (!avcConfig || avcConfig.end - avcConfig.payload < 7 || bytes[avcConfig.payload] !== 1)
          throw new Error();
        videos.push({ width, height, duration });
      } else {
        if (
          description.type !== 'mp4a' ||
          ++audio > 1 ||
          description.start + 36 > description.end ||
          bytes.readUInt16BE(description.start + 16) !== 0
        )
          throw new Error();
        const esds = boxes(description.start + 36, description.end).find(
          (box) => box.type === 'esds',
        );
        if (!esds) throw new Error();
        function descriptor(at, end) {
          if (at >= end) throw new Error();
          const tag = bytes[at++];
          let size = 0,
            groups = 0,
            part;
          do {
            if (at >= end || ++groups > 4) throw new Error();
            part = bytes[at++];
            size = size * 128 + (part & 0x7f);
          } while (part & 0x80);
          if (at + size > end) throw new Error();
          return { tag, payload: at, end: at + size };
        }
        const es = descriptor(esds.payload + 4, esds.end);
        if (es.tag !== 3 || es.payload + 3 > es.end) throw new Error();
        const flags = bytes[es.payload + 2];
        let cursor = es.payload + 3;
        if (flags & 0x80) cursor += 2;
        if (flags & 0x40) {
          if (cursor >= es.end) throw new Error();
          cursor += 1 + bytes[cursor];
        }
        if (flags & 0x20) cursor += 2;
        const decoder = descriptor(cursor, es.end);
        if (
          decoder.tag !== 4 ||
          decoder.payload + 13 > decoder.end ||
          bytes[decoder.payload] !== 0x40
        )
          throw new Error();
        const specific = descriptor(decoder.payload + 13, decoder.end);
        if (
          specific.tag !== 5 ||
          specific.payload >= specific.end ||
          ![2, 5, 29].includes(bytes[specific.payload] >> 3)
        )
          throw new Error();
      }
    }
    if (videos.length !== 1) throw new Error();
    const video = videos[0];
    const name =
      String(inputName)
        .split(/[\\/]/)
        .at(-1)
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\.[^.]+$/, '')
        .slice(0, 160) || 'school-video';
    return {
      name: `${name}.mp4`,
      kind: 'video',
      mimeType: 'video/mp4',
      size: bytes.length,
      sha256: hash(bytes),
      width: video.width,
      height: video.height,
      duration: Math.round(video.duration * 1000) / 1000,
    };
  } catch {
    throw new HttpError(
      422,
      'Use an MP4 with one H.264 video track, optional AAC audio, at most 4096 px per side and 10 minutes long. Export the video with these settings and try again.',
      'invalid_video',
    );
  }
}

export async function readVideoResponse(response, maximum = MAX_VIDEO_BYTES) {
  if (!response.ok || !response.body)
    throw new HttpError(
      409,
      'The video upload is not available yet. Finish the upload before confirming.',
      'video_unavailable',
    );
  if (Number(response.headers.get('content-length') || 0) > maximum)
    throw new HttpError(413, 'The video exceeds the permitted size.', 'video_too_large');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum)
        throw new HttpError(413, 'The video exceeds the permitted size.', 'video_too_large');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, length);
}
