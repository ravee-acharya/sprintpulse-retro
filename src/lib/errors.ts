import type { ErrorCode, RpcError } from '../shared/types';
import { RuleError } from '../shared/rules';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function toRpcError(e: unknown): RpcError {
  if (e instanceof AppError || e instanceof RuleError) return { code: e.code, message: e.message };
  console.error('[sprintpulse] unhandled resolver error', e);
  return { code: 'INTERNAL', message: 'Something went wrong. Please try again.' };
}
