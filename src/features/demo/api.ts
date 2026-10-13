import { API } from '../../shared/api/client';

export async function demoApi<T>(path: string, options?: RequestInit): Promise<T> {
  if ((options?.method ?? 'GET').toUpperCase() !== 'GET') throw new Error('The demo is read only.');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) throw new Error('Invalid demo path.');
  const response = await fetch(`${API}/demo${path}`, {
    method: 'GET', credentials: 'omit', cache: 'no-store', signal: options?.signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(response.status === 404 ? 'The live demo is unavailable.' : 'Could not load the live demo. Please retry.');
  return response.json() as Promise<T>;
}
