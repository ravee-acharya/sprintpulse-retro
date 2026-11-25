/**
 * Trusted request context. The project always comes from Forge's invocation context
 * (the jira:projectPage the user is on), never from the client payload, so a user can
 * only ever read or write retros of the project page they are viewing.
 */
import { randomUUID } from 'node:crypto';
import { AppError } from './errors';

export interface ReqContext {
  accountId: string;
  projectId: string;
  projectKey: string;
}

interface ForgeCtx {
  accountId?: string;
  extension?: { project?: { id?: string | number; key?: string } };
}

export function reqContext(context: unknown): ReqContext {
  const ctx = (context ?? {}) as ForgeCtx;
  const accountId = ctx.accountId;
  const project = ctx.extension?.project;
  if (!accountId) throw new AppError('FORBIDDEN', 'You must be logged in.');
  if (!project?.id || !project.key) throw new AppError('BAD_REQUEST', 'SprintPulse Retro must be opened from a Jira project.');
  return { accountId, projectId: String(project.id), projectKey: project.key };
}

/** URL/key-safe short id. */
export function newId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 20);
}
