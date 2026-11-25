/**
 * Optional Confluence export. Uses the v1 content API, which works with the classic
 * `write:confluence-content` scope. Any failure that indicates Confluence isn't on the
 * site (or the user lacks access) surfaces as CONFLUENCE_UNAVAILABLE so the UI can hide
 * the option and fall back to Markdown/CSV.
 */
import api, { route, type Route } from '@forge/api';
import { AppError } from '../lib/errors';

export interface ConfluenceSpace {
  key: string;
  name: string;
}

async function confluence<T>(path: Route, init?: { method?: string; body?: unknown }): Promise<T> {
  let res;
  try {
    res = await api.asUser().requestConfluence(path, {
      method: init?.method ?? 'GET',
      headers: { Accept: 'application/json', ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (e) {
    console.warn('[sprintpulse] confluence request failed', e);
    throw new AppError('CONFLUENCE_UNAVAILABLE', 'Confluence is not available on this site.');
  }
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    if (res.status === 404 || res.status === 401) throw new AppError('CONFLUENCE_UNAVAILABLE', 'Confluence is not available on this site.');
    if (res.status === 403) throw new AppError('FORBIDDEN', data.message ?? 'You do not have permission in that Confluence space.');
    throw new AppError('JIRA_ERROR', data.message ?? `Confluence responded ${res.status}`);
  }
  return data as T;
}

export async function listSpaces(query: string): Promise<ConfluenceSpace[]> {
  const data = await confluence<{ results: Array<{ key: string; name: string }> }>(
    route`/wiki/rest/api/space?type=global&status=current&limit=100`,
  );
  const q = query.trim().toLowerCase();
  return data.results
    .map((s) => ({ key: s.key, name: s.name }))
    .filter((s) => !q || s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q))
    .slice(0, 25);
}

export async function publishPage(input: { spaceKey: string; title: string; storageXhtml: string; parentId?: string | null }): Promise<{ id: string; url: string }> {
  const body: Record<string, unknown> = {
    type: 'page',
    title: input.title,
    space: { key: input.spaceKey },
    body: { storage: { value: input.storageXhtml, representation: 'storage' } },
  };
  if (input.parentId) body.ancestors = [{ id: input.parentId }];
  const page = await confluence<{ id: string; _links: { base?: string; webui?: string } }>(route`/wiki/rest/api/content`, { method: 'POST', body });
  return { id: page.id, url: `${page._links.base ?? ''}${page._links.webui ?? ''}` };
}
