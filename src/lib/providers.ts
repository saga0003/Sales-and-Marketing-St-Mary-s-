import type { Platform, ProviderId } from './types';
export const providerNames: Record<ProviderId, string> = {
  google: 'Google Analytics 4',
  search_console: 'Google Search Console',
  youtube: 'YouTube',
  google_business: 'Google Business Profile',
  google_ads: 'Google Ads',
  instagram: 'Instagram',
  facebook: 'Facebook Pages',
  linkedin: 'LinkedIn Pages',
  linkedin_member: 'LinkedIn profile',
  meta_ads: 'Meta Ads',
};
export const providerPlatform = (id: ProviderId): Platform | undefined =>
  id === 'linkedin_member'
    ? 'linkedin'
    : ['instagram', 'facebook', 'youtube', 'linkedin', 'google_business'].includes(id)
      ? (id as Platform)
      : undefined;
export const credentialGroup = (id: ProviderId) =>
  ['instagram', 'facebook', 'meta_ads'].includes(id)
    ? 'meta'
    : id.startsWith('linkedin')
      ? 'linkedin'
      : 'google';
export const canReport = (capabilities: string[]) =>
  capabilities.some(
    (value) =>
      value.includes('analytics') ||
      value.includes('report') ||
      value.includes('insights') ||
      value === 'search:read',
  );
export const canPublish = (capabilities: string[]) =>
  capabilities.some((value) => value.startsWith('publish:'));
