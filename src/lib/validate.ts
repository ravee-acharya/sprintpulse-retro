/** Minimal payload validators - resolvers never trust shapes coming from the client. */
import { AppError } from './errors';

type Payload = Record<string, unknown> | undefined | null;

export function str(p: Payload, key: string, opts: { max?: number; min?: number; optional?: false }): string;
export function str(p: Payload, key: string, opts: { max?: number; min?: number; optional: true }): string | undefined;
export function str(p: Payload, key: string, opts: { max?: number; min?: number; optional?: boolean } = {}): string | undefined {
  const v = p?.[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw new AppError('BAD_REQUEST', `Missing "${key}".`);
  }
  if (typeof v !== 'string') throw new AppError('BAD_REQUEST', `"${key}" must be a string.`);
  const s = v.trim();
  if (opts.min !== undefined && s.length < opts.min) throw new AppError('BAD_REQUEST', `"${key}" is too short.`);
  if (opts.max !== undefined && s.length > opts.max) throw new AppError('BAD_REQUEST', `"${key}" is too long (max ${opts.max}).`);
  return s;
}

export function id(p: Payload, key: string): string {
  const s = str(p, key, { min: 1, max: 64 });
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new AppError('BAD_REQUEST', `"${key}" is not a valid id.`);
  return s;
}

export function optId(p: Payload, key: string): string | null {
  const v = p?.[key];
  if (v === undefined || v === null || v === '') return null;
  return id(p, key);
}

export function int(p: Payload, key: string, opts: { min?: number; max?: number; optional?: boolean; fallback?: number } = {}): number {
  const v = p?.[key];
  if (v === undefined || v === null) {
    if (opts.fallback !== undefined) return opts.fallback;
    throw new AppError('BAD_REQUEST', `Missing "${key}".`);
  }
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new AppError('BAD_REQUEST', `"${key}" must be an integer.`);
  if (opts.min !== undefined && v < opts.min) throw new AppError('BAD_REQUEST', `"${key}" must be >= ${opts.min}.`);
  if (opts.max !== undefined && v > opts.max) throw new AppError('BAD_REQUEST', `"${key}" must be <= ${opts.max}.`);
  return v;
}

export function bool(p: Payload, key: string, fallback?: boolean): boolean {
  const v = p?.[key];
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback;
    throw new AppError('BAD_REQUEST', `Missing "${key}".`);
  }
  if (typeof v !== 'boolean') throw new AppError('BAD_REQUEST', `"${key}" must be a boolean.`);
  return v;
}

export function oneOf<T extends string>(p: Payload, key: string, allowed: readonly T[], fallback?: T): T {
  const v = p?.[key];
  if ((v === undefined || v === null) && fallback !== undefined) return fallback;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new AppError('BAD_REQUEST', `"${key}" must be one of: ${allowed.join(', ')}.`);
  }
  return v as T;
}

export function strArray(p: Payload, key: string, opts: { maxItems: number; maxLen: number }): string[] {
  const v = p?.[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > opts.maxItems) throw new AppError('BAD_REQUEST', `"${key}" must be a list of at most ${opts.maxItems}.`);
  return v.map((x) => {
    if (typeof x !== 'string' || x.length > opts.maxLen) throw new AppError('BAD_REQUEST', `"${key}" has an invalid entry.`);
    return x.trim();
  });
}

export function obj(p: Payload, key: string): Record<string, unknown> {
  const v = p?.[key];
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new AppError('BAD_REQUEST', `"${key}" must be an object.`);
  return v as Record<string, unknown>;
}
