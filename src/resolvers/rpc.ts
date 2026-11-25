import type Resolver from '@forge/resolver';
import type { RpcResult } from '../shared/types';
import { reqContext, type ReqContext } from '../lib/context';
import { toRpcError } from '../lib/errors';

export type Payload = Record<string, unknown>;
export type Handler<T> = (payload: Payload, ctx: ReqContext) => Promise<T>;

/**
 * Register a resolver that always resolves to an RpcResult envelope, so the UI gets a
 * typed error code instead of an opaque bridge exception.
 */
export function rpc<T>(resolver: Resolver, name: string, handler: Handler<T>): void {
  resolver.define(name, async ({ payload, context }): Promise<RpcResult<T>> => {
    try {
      const ctx = reqContext(context);
      const data = await handler((payload ?? {}) as Payload, ctx);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: toRpcError(e) };
    }
  });
}
