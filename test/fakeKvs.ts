/**
 * In-memory stand-in for @forge/kvs custom entities, faithful enough to exercise the
 * optimistic-locking paths: conditional transactions are atomic and re-check conditions
 * at commit time, and every await yields so concurrent callers genuinely interleave.
 */
type Rec = Record<string, unknown>;
type Clause = { property: string; condition: string; values: unknown[] };
type FilterLike = { filters(): Clause[]; operator(): 'and' | 'or' };

const INDEX_PARTITION: Record<string, string> = { 'by-retro': 'retroId', 'by-project': 'projectId' };
const INDEX_RANGE: Record<string, Record<string, string>> = {
  'sp-ballot': { 'by-retro': 'accountId' },
  'sp-mood': { 'by-retro': 'accountId' },
};

const tick = () => new Promise<void>((r) => setImmediate(r));

function matches(rec: Rec | undefined, f: FilterLike | undefined): boolean {
  if (!f) return true;
  const results = f.filters().map((c) => {
    const v = rec?.[c.property];
    switch (c.condition) {
      case 'EQUAL_TO':
        return v === c.values[0];
      case 'NOT_EXISTS':
        return v === undefined;
      case 'EXISTS':
        return v !== undefined;
      case 'CONTAINS':
        return typeof v === 'string' && v.includes(String(c.values[0]));
      default:
        throw new Error(`fake kvs: unsupported condition ${c.condition}`);
    }
  });
  return f.operator() === 'or' ? results.some(Boolean) : results.every(Boolean);
}

export class ConditionFailed extends Error {}
export class IncorrectPropertyType extends Error {
  code = 'INCORRECT_PROPERTY_TYPE';
}

/** entityName -> attribute -> declared type, as in manifest.yml app.storage.entities. */
export type EntitySchema = Record<string, Record<string, 'string' | 'integer' | 'float' | 'boolean' | 'any'>>;

const INT32_MAX = 2 ** 31 - 1;

/** Mirrors Forge KVS's server-side check, which rejects values not matching the declared type. */
function checkTypes(schema: EntitySchema | undefined, entity: string, value: Rec): void {
  const attrs = schema?.[entity];
  if (!attrs) return;
  for (const [name, v] of Object.entries(value)) {
    const type = attrs[name];
    if (!type) throw new IncorrectPropertyType(`Property "${name}" is not declared on entity "${entity}"`);
    const ok =
      type === 'any' ||
      (type === 'string' && typeof v === 'string') ||
      (type === 'boolean' && typeof v === 'boolean') ||
      (type === 'float' && typeof v === 'number' && Number.isFinite(v)) ||
      (type === 'integer' && typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= INT32_MAX);
    if (!ok) throw new IncorrectPropertyType(`Data type for property "${name}" is defined as "${type}" (got ${JSON.stringify(v)})`);
  }
}

export function createFakeKvs(schema?: EntitySchema) {
  const data = new Map<string, Rec>(); // `${entity}|${key}`
  const k = (entity: string, key: string) => `${entity}|${key}`;
  const clone = <T>(v: T): T => structuredClone(v);
  const stats = { transactions: 0, conflicts: 0 };

  function entity(name: string) {
    return {
      async get(key: string) {
        await tick();
        const v = data.get(k(name, key));
        return v ? clone(v) : undefined;
      },
      async set(key: string, value: Rec, opts?: { keyPolicy?: string }) {
        await tick();
        checkTypes(schema, name, value);
        if (opts?.keyPolicy === 'FAIL_IF_EXISTS' && data.has(k(name, key))) throw new ConditionFailed('exists');
        data.set(k(name, key), clone(value));
      },
      async delete(key: string) {
        await tick();
        data.delete(k(name, key));
      },
      query() {
        return {
          index(indexName: string, opts: { partition: unknown[] }) {
            let sort = 'ASC';
            let filter: FilterLike | undefined;
            let limit = 100;
            let cursor = 0;
            const q = {
              sort(s: string) {
                sort = s;
                return q;
              },
              filters(f: FilterLike) {
                filter = f;
                return q;
              },
              limit(n: number) {
                limit = n;
                return q;
              },
              cursor(c: string) {
                cursor = Number(c);
                return q;
              },
              async getMany() {
                await tick();
                const partAttr = INDEX_PARTITION[indexName]!;
                const rangeAttr = INDEX_RANGE[name]?.[indexName] ?? 'createdAt';
                const rows = [...data.entries()]
                  .filter(([id, v]) => id.startsWith(`${name}|`) && v[partAttr] === opts.partition[0] && matches(v, filter))
                  .map(([id, v]) => ({ key: id.slice(name.length + 1), value: clone(v) }))
                  .sort((a, b) => {
                    const x = a.value[rangeAttr] as string | number;
                    const y = b.value[rangeAttr] as string | number;
                    const c = x < y ? -1 : x > y ? 1 : 0;
                    return sort === 'DESC' ? -c : c;
                  });
                const page = rows.slice(cursor, cursor + limit);
                const next = cursor + limit < rows.length ? String(cursor + limit) : undefined;
                return { results: page, ...(next ? { nextCursor: next } : {}) };
              },
              async getOne() {
                return (await q.getMany()).results[0];
              },
            };
            return q;
          },
        };
      },
    };
  }

  function transact() {
    const ops: Array<
      | { kind: 'set'; key: string; value: Rec; entityName: string; conditions?: FilterLike }
      | { kind: 'delete'; key: string; entityName: string; conditions?: FilterLike }
      | { kind: 'check'; key: string; entityName: string; conditions: FilterLike }
    > = [];
    const tx = {
      set(key: string, value: Rec, e: { entityName: string; conditions?: FilterLike }) {
        ops.push({ kind: 'set', key, value: clone(value), entityName: e.entityName, ...(e.conditions ? { conditions: e.conditions } : {}) });
        return tx;
      },
      delete(key: string, e: { entityName: string; conditions?: FilterLike }) {
        ops.push({ kind: 'delete', key, entityName: e.entityName, ...(e.conditions ? { conditions: e.conditions } : {}) });
        return tx;
      },
      check(key: string, e: { entityName: string; conditions: FilterLike }) {
        ops.push({ kind: 'check', key, entityName: e.entityName, conditions: e.conditions });
        return tx;
      },
      async execute() {
        await tick();
        stats.transactions++;
        for (const op of ops) if (op.kind === 'set') checkTypes(schema, op.entityName, op.value);
        // Atomic: validate everything, then apply - no awaits in between.
        for (const op of ops) {
          if (op.conditions && !matches(data.get(k(op.entityName, op.key)), op.conditions)) {
            stats.conflicts++;
            throw new ConditionFailed(`condition failed on ${op.entityName}|${op.key}`);
          }
        }
        for (const op of ops) {
          if (op.kind === 'set') data.set(k(op.entityName, op.key), op.value);
          if (op.kind === 'delete') data.delete(k(op.entityName, op.key));
        }
      },
    };
    return tx;
  }

  return { kvs: { entity, transact }, data, stats };
}
