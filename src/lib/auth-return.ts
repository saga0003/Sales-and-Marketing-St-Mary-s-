// Only this internal route may survive a sign-in. Never accept an arbitrary
// return URL supplied through the browser's address bar.
export function postLoginDestination(hash: string): {
  hash: string;
  view: 'settings' | 'overview';
} {
  const [route, query = ''] = hash.split('?');
  const parameters = new URLSearchParams(query);
  const request = parameters.get('authorize') || '';
  if (
    route === '#settings' &&
    parameters.get('tab') === 'mcp' &&
    /^[A-Za-z0-9_-]{43}$/.test(request)
  ) {
    return { hash: '#settings?tab=mcp&authorize=' + encodeURIComponent(request), view: 'settings' };
  }
  return { hash: '#overview', view: 'overview' };
}
