/**
 * Browser stand-in for `@forge/kvs` (aliased in vite.config.ts; only loaded in mock mode).
 * Custom entities persisted to localStorage, with conditional transactions evaluated
 * atomically - enough to run the real backend's optimistic-locking code unchanged.
 */
type Rec = Record<string, unknown>;
type Clause = { property: string; condition: string; values: unknown[] };

const LS_PREFIX = 'sprintpulse-mock-kvs:';
const lsKey = (entity: string, key: string) => `${LS_PREFIX}${entity}|${key}`;

const INDEX_PARTITION: Record<string, string> = { 'by-retro': 'retroId', 'by-project': 'projectId' };
const INDEX_RANGE: Record<string, Record<string, string>> = {
  'sp-ballot': { 'by-retro': 'accountId' },
  'sp-mood': { 'by-retro': 'accountId' },
};

const latency = () => new Promise<void>((r) => setTimeout(r, 4 + Math.random() * 12));

function read(entity: string, key: string): Rec | undefined {
  const raw = localStorage.getItem(lsKey(entity, key));
  return raw ? (JSON.parse(raw) as Rec) : undefined;
}

function write(entity: string, key: string, value: Rec): void {
  localStorage.setItem(lsKey(entity, key), JSON.stringify(value));
}

/* ------------------------------ filters ----------------------------- */

const clause = (condition: string, ...values: unknown[]) => ({ condition, values });

export const FilterConditions = {
  equalTo: (v: unknown) => clause('EQUAL_TO', v),
  notEqualTo: (v: unknown) => clause('NOT_EQUAL_TO', v),
  exists: () => clause('EXISTS', true),
  notExists: () => clause('NOT_EXISTS', true),
  contains: (v: string) => clause('CONTAINS', v),
  notContains: (v: string) => clause('NOT_CONTAINS', v),
  beginsWith: (v: string) => clause('BEGINS_WITH', v),
  greaterThan: (v: number) => clause('GREATER_THAN', v),
  lessThan: (v: number) => clause('LESS_THAN', v),
};
export const WhereConditions = FilterConditions;

export class Filter {
  protected items: Clause[] = [];
  protected op: 'and' | 'or' = 'and';
  and(property: string, c: { condition: string; values: unknown[] }) {
    this.items.push({ property, ...c });
    this.op = 'and';
    return this;
  }
  or(property: string, c: { condition: string; values: unknown[] }) {
    this.items.push({ property, ...c });
    this.op = 'or';
    return this;
  }
  filters() {
    return this.items;
  }
  operator() {
    return this.op;
  }
}

export enum Sort {
  ASC = 'ASC',
  DESC = 'DESC',
}

function matches(rec: Rec | undefined, f: Filter | undefined): boolean {
  if (!f) return true;
  const res = f.filters().map((c) => {
    const v = rec?.[c.property];
    const x = c.values[0];
    switch (c.condition) {
      case 'EQUAL_TO':
        return v === x;
      case 'NOT_EQUAL_TO':
        return v !== x;
      case 'EXISTS':
        return v !== undefined;
      case 'NOT_EXISTS':
        return v === undefined;
      case 'CONTAINS':
        return typeof v === 'string' && v.includes(String(x));
      case 'NOT_CONTAINS':
        return typeof v === 'string' && !v.includes(String(x));
      case 'BEGINS_WITH':
        return typeof v === 'string' && v.startsWith(String(x));
      case 'GREATER_THAN':
        return (v as number) > (x as number);
      case 'LESS_THAN':
        return (v as number) < (x as number);
      default:
        return false;
    }
  });
  return f.operator() === 'or' ? res.some(Boolean) : res.every(Boolean);
}

export class ConditionalCheckFailed extends Error {
  code = 'CONDITIONAL_CHECK_FAILED';
}

/* ------------------------------ entities ---------------------------- */

function entity(name: string) {
  return {
    async get(key: string) {
      await latency();
      return read(name, key);
    },
    async set(key: string, value: Rec, opts?: { keyPolicy?: string }) {
      await latency();
      if (opts?.keyPolicy === 'FAIL_IF_EXISTS' && read(name, key)) throw new ConditionalCheckFailed('Key exists');
      write(name, key, value);
    },
    async delete(key: string) {
      await latency();
      localStorage.removeItem(lsKey(name, key));
    },
    query() {
      return {
        index(indexName: string, opts: { partition: unknown[] }) {
          let sort = 'ASC';
          let filter: Filter | undefined;
          let limit = 100;
          let cursor = 0;
          const q = {
            sort(s: string) {
              sort = s;
              return q;
            },
            filters(f: Filter) {
              filter = f;
              return q;
            },
            where() {
              return q;
            },
            limit(n: number) {
              limit = n;
              return q;
            },
            cursor(c: string) {
              cursor = Number(c) || 0;
              return q;
            },
            async getMany() {
              await latency();
              const part = INDEX_PARTITION[indexName]!;
              const range = INDEX_RANGE[name]?.[indexName] ?? 'createdAt';
              const prefix = `${LS_PREFIX}${name}|`;
              const rows: Array<{ key: string; value: Rec }> = [];
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i)!;
                if (!k.startsWith(prefix)) continue;
                const v = JSON.parse(localStorage.getItem(k)!) as Rec;
                if (v[part] === opts.partition[0] && matches(v, filter)) rows.push({ key: k.slice(prefix.length), value: v });
              }
              rows.sort((a, b) => {
                const x = a.value[range] as string | number;
                const y = b.value[range] as string | number;
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

type Op = { kind: 'set' | 'delete' | 'check'; key: string; value?: Rec; entityName: string; conditions?: Filter };

function transact() {
  const ops: Op[] = [];
  const tx = {
    set(key: string, value: Rec, e: { entityName: string; conditions?: Filter }) {
      ops.push({ kind: 'set', key, value: structuredClone(value), entityName: e.entityName, conditions: e.conditions });
      return tx;
    },
    delete(key: string, e: { entityName: string; conditions?: Filter }) {
      ops.push({ kind: 'delete', key, entityName: e.entityName, conditions: e.conditions });
      return tx;
    },
    check(key: string, e: { entityName: string; conditions: Filter }) {
      ops.push({ kind: 'check', key, entityName: e.entityName, conditions: e.conditions });
      return tx;
    },
    async execute() {
      await latency();
      // Validate-then-apply with no await in between: atomic within this tab.
      for (const op of ops) {
        if (op.conditions && !matches(read(op.entityName, op.key), op.conditions)) {
          throw new ConditionalCheckFailed(`Condition failed on ${op.entityName}|${op.key}`);
        }
      }
      for (const op of ops) {
        if (op.kind === 'set') write(op.entityName, op.key, op.value!);
        if (op.kind === 'delete') localStorage.removeItem(lsKey(op.entityName, op.key));
      }
    },
  };
  return tx;
}

export function resetMockStorage(): void {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)!;
    if (k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
  }
}

const kvs = { entity, transact };
export { kvs };
export default kvs;
