/** Browser stand-in for `@forge/resolver` (mock mode only). */
type Fn = (req: { payload: unknown; context: unknown }) => Promise<unknown>;

export default class Resolver {
  readonly handlers = new Map<string, Fn>();
  define(name: string, fn: Fn): this {
    this.handlers.set(name, fn);
    return this;
  }
  getDefinitions() {
    return this.handlers;
  }
}
