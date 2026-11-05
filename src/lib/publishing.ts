import type { Connection, MediaAsset, Post, PublicationOptions } from './types';
import { providerPlatform } from './providers';
export type PublicationIssue = Partial<
  Record<
    'title' | 'caption' | 'assetIds' | 'format' | 'destinationIds' | 'publicationOptions',
    string
  >
>;
const captionLimits: Partial<Record<Connection['provider'], number>> = {
  instagram: 2200,
  facebook: 5000,
  linkedin: 3000,
  linkedin_member: 3000,
  google_business: 1500,
  youtube: 5000,
};
export const captionLimit = (connections: Connection[]) =>
  Math.min(12000, ...connections.map((connection) => captionLimits[connection.provider] || 12000));
export function publicationIssues(
  post: Pick<Post, 'title' | 'caption' | 'format' | 'institution' | 'platforms'> & {
    assetIds?: string[];
    assetId?: string | null;
    destinationIds?: string[];
    publicationOptions?: PublicationOptions;
  },
  connections: Connection[],
  media: MediaAsset[],
): PublicationIssue {
  const issues: PublicationIssue = {};
  const ids = post.assetIds || (post.assetId ? [post.assetId] : []);
  const assets = ids.map((id) => media.find((asset) => asset.id === id));
  const images = assets.filter((asset) => asset?.mimeType === 'image/jpeg');
  const videos = assets.filter((asset) => asset?.mimeType === 'video/mp4');
  if (assets.some((asset) => !asset))
    issues.assetIds =
      'Some saved media is unavailable. Remove it or choose another file from the library.';
  for (const id of post.destinationIds || []) {
    const connection = connections.find((item) => item.id === id);
    const platform = connection && providerPlatform(connection.provider);
    if (
      !connection ||
      connection.status !== 'connected' ||
      !connection.accountId ||
      connection.institution !== post.institution ||
      !platform ||
      !post.platforms.includes(platform)
    ) {
      issues.destinationIds =
        'A destination is unavailable or does not match the chosen school and channels. Remove it and select a connected account.';
      continue;
    }
    if (post.caption.length > captionLimit([connection]))
      issues.caption = `Keep the caption within ${captionLimit([connection]).toLocaleString('en-IN')} characters for ${connection.accountName}.`;
    if (connection.provider === 'instagram') {
      if (!['Post', 'Carousel', 'Reel'].includes(post.format))
        issues.format = 'Instagram supports an image Post, image Carousel, or video Reel here.';
      if (
        (post.format === 'Post' && (images.length !== 1 || ids.length !== 1)) ||
        (post.format === 'Carousel' &&
          (images.length < 2 || images.length > 10 || images.length !== ids.length))
      )
        issues.assetIds =
          post.format === 'Carousel'
            ? 'Choose 2–10 saved images for an Instagram carousel.'
            : 'Choose one saved image for an Instagram Post.';
      if (['Post', 'Carousel'].includes(post.format)) {
        if (
          images.some(
            (asset) =>
              asset!.width < 320 ||
              asset!.width / asset!.height < 0.8 ||
              asset!.width / asset!.height > 1.91,
          )
        )
          issues.assetIds =
            'Instagram images need a width of at least 320 pixels and a ratio between 4:5 and 1.91:1.';
        if (
          post.format === 'Carousel' &&
          images.some(
            (asset) =>
              Math.abs(asset!.width / asset!.height - images[0]!.width / images[0]!.height) > 0.01,
          )
        )
          issues.assetIds =
            'Use the same image aspect ratio throughout this carousel so the saved previews match publication.';
      }
      if (post.format === 'Reel') {
        if (videos.length !== 1 || ids.length !== 1)
          issues.assetIds = 'Choose one saved MP4 video for an Instagram Reel.';
        else if (
          videos[0]!.width < 320 ||
          Math.abs(videos[0]!.width / videos[0]!.height - 9 / 16) > 0.02 ||
          (videos[0]!.duration || 0) < 3 ||
          (videos[0]!.duration || 0) > 600
        )
          issues.assetIds =
            'For this Instagram Reel adapter, use a vertical 9:16 video at least 320 pixels wide, lasting 3–600 seconds.';
      }
    } else if (connection.provider === 'youtube') {
      if (post.format !== 'Video') issues.format = 'Choose Video format for a YouTube destination.';
      if (videos.length !== 1 || ids.length !== 1)
        issues.assetIds = 'Choose one saved MP4 video for YouTube.';
      if (post.title.trim().length > 100 || /[<>]/.test(post.title))
        issues.title = 'YouTube titles must be at most 100 characters and cannot contain < or >.';
      const options = post.publicationOptions;
      if (
        !options?.youtubePrivacy ||
        typeof options.madeForKids !== 'boolean' ||
        typeof options.containsSyntheticMedia !== 'boolean'
      )
        issues.publicationOptions =
          'Choose YouTube visibility, video audience, and the altered/synthetic media setting explicitly before review.';
    } else if (
      ['facebook', 'linkedin', 'linkedin_member', 'google_business'].includes(connection.provider)
    ) {
      if (post.format !== 'Post')
        issues.format =
          'Facebook, LinkedIn, and Google Business publishing currently use Post format: text with an optional image.';
      if (ids.length > 1 || images.length !== ids.length)
        issues.assetIds = 'For these destinations, use a text post or attach one saved image.';
    }
    const capability =
      post.format === 'Carousel'
        ? 'publish:carousel'
        : ['Video', 'Reel'].includes(post.format)
          ? 'publish:video'
          : ids.length
            ? 'publish:image'
            : 'publish:text';
    if (!connection.capabilities.includes(capability))
      issues.destinationIds = `${connection.accountName} does not currently grant ${capability.replace('publish:', '')} publishing access. Check its permissions or choose another destination.`;
  }
  return issues;
}
