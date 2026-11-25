import type { JiraUser } from '@shared/types';

export const MOCK_PROJECT = { id: '10001', key: 'DEMO', name: 'Demo Project' };

export const MOCK_USERS: JiraUser[] = [
  { accountId: 'mock-facilitator', displayName: 'Priya Sharma', avatarUrl: null },
  { accountId: 'mock-alex', displayName: 'Alex Chen', avatarUrl: null },
  { accountId: 'mock-sam', displayName: 'Sam Okafor', avatarUrl: null },
  { accountId: 'mock-maria', displayName: 'Maria Garcia', avatarUrl: null },
  { accountId: 'mock-jordan', displayName: 'Jordan Lee', avatarUrl: null },
  { accountId: 'mock-taylor', displayName: 'Taylor Brooks', avatarUrl: null },
];

const SESSION_KEY = 'sprintpulse-mock-user';

/**
 * Current mock identity: `?user=<accountId suffix>` wins (handy for side-by-side tabs),
 * then this tab's session choice, then the facilitator.
 */
export function currentMockUser(): JiraUser {
  const param = new URLSearchParams(window.location.search).get('user');
  const pick = (id: string | null) => MOCK_USERS.find((u) => u.accountId === id || u.accountId === `mock-${id}`);
  return pick(param) ?? pick(sessionStorage.getItem(SESSION_KEY)) ?? MOCK_USERS[0]!;
}

export function setMockUser(accountId: string): void {
  sessionStorage.setItem(SESSION_KEY, accountId);
  const url = new URL(window.location.href);
  url.searchParams.delete('user');
  window.location.replace(url.toString());
}
