/**
 * Thin, typed layer over Forge KVS custom entities with optimistic locking.
 *
 * Every record is stored as `{ ...indexAttributes, version, updatedAt, doc }`:
 *  - index attributes (projectId, retroId, createdAt, ...) are declared in manifest.yml
 *    under app.storage.entities so they can be queried;
 *  - `version` is the optimistic-lock counter. Writes are conditional transactions
 *    (`version == expected`), retried with jittered back-off on conflict;
 *  - `doc` holds the domain object (attribute type `any`).
 *
 * Contention is designed out where possible: cards, groups, ballots and moods are
 * one record each, so concurrent card creation and voting by different users never
 * touch the same key. Only edits to the *same* card or the board record compete.
 */
import kvs, { Filter, FilterConditions, Sort, type AndFilter, type OrFilter } from '@forge/kvs';
import { AppError } from '../lib/errors';

export type IndexValue = string | number;

export interface StoredRecord<T> {
  version: number;
  updatedAt: number;
  doc: T;
  [indexAttr: string]: unknown;
}

export interface EntityDef<T> {
  /** Entity name - must match manifest.yml app.storage.entities[].name */
  name: string;
  key: (doc: T) => string;
  indexAttrs: (doc: T) => Record<string, IndexValue>;
}

export type QueryFilter<T> = AndFilter<StoredRecord<T>> | OrFilter<StoredRecord<T>>;

export interface Versioned {
  version: number;
  updatedAt?: number;
}

const MAX_RETRIES = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => sleep(Math.min(400, 15 * 2 ** attempt) + Math.random() * 25);

function toRecord<T>(def: EntityDef<T>, doc: T, version: number, now: number): StoredRecord<T> {
  return { ...def.indexAttrs(doc), version, updatedAt: now, doc };
}

/** Keep doc.version / doc.updatedAt (when present) in step with the record. */
function stamp<T>(doc: T, version: number, now: number): T {
  if (doc && typeof doc === 'object' && 'version' in (doc as object)) {
    const d = doc as T & Versioned;
    d.version = version;
    if ('updatedAt' in d) d.updatedAt = now;
  }
  return doc;
}

function versionEquals<T>(v: number) {
  return new Filter<StoredRecord<T>>().and('version', FilterConditions.equalTo(v));
}

function versionAbsent<T>() {
  return new Filter<StoredRecord<T>>().and('version', FilterConditions.notExists());
}

export class EntityStore<T> {
  constructor(public readonly def: EntityDef<T>) {}

  private entity() {
    return kvs.entity<StoredRecord<T>>(this.def.name);
  }

  async getRecord(key: string): Promise<StoredRecord<T> | undefined> {
    return this.entity().get(key);
  }

  async get(key: string): Promise<T | undefined> {
    return (await this.getRecord(key))?.doc;
  }

  async require(key: string, what = 'Item'): Promise<T> {
    const doc = await this.get(key);
    if (!doc) throw new AppError('NOT_FOUND', `${what} not found.`);
    return doc;
  }

  /** Create; fails with CONFLICT if the key already exists. */
  async create(doc: T, now = Date.now()): Promise<T> {
    const key = this.def.key(doc);
    stamp(doc, 1, now);
    try {
      await this.entity().set(key, toRecord(this.def, doc, 1, now), { keyPolicy: 'FAIL_IF_EXISTS' });
    } catch (e) {
      if (await this.getRecord(key)) throw new AppError('CONFLICT', 'Item already exists.');
      throw e;
    }
    return doc;
  }

  /**
   * Read-modify-write with optimistic locking. `fn` receives a fresh copy each attempt
   * and may return `null` to abort without writing. Missing records: `fn` gets
   * `undefined` and may return a doc to create it (upsert).
   */
  async mutate(key: string, fn: (current: T | undefined) => T | null, now = Date.now()): Promise<T | null> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const rec = await this.getRecord(key);
      const current = rec ? structuredClone<T>(rec.doc) : undefined;
      const next = fn(current);
      if (next === null) return rec?.doc ?? null;

      const version = (rec?.version ?? 0) + 1;
      stamp(next, version, now);
      const conditions = rec ? versionEquals<T>(rec.version) : versionAbsent<T>();
      try {
        await kvs.transact().set(key, toRecord(this.def, next, version, now), { entityName: this.def.name, conditions }).execute();
        return next;
      } catch (e) {
        if (!(await this.isConflict(key, rec?.version))) throw e;
        await backoff(attempt);
      }
    }
    throw new AppError('CONFLICT', 'Too many simultaneous edits - please retry.');
  }

  /** Like mutate() but the record must exist. */
  async update(key: string, fn: (current: T) => T | null, what = 'Item'): Promise<T> {
    let missing = false;
    const out = await this.mutate(key, (cur) => {
      if (!cur) {
        missing = true;
        return null;
      }
      return fn(cur);
    });
    if (missing || !out) throw new AppError('NOT_FOUND', `${what} not found.`);
    return out;
  }

  async delete(key: string): Promise<void> {
    await this.entity().delete(key);
  }

  /** Reads every page of an index query (bounded by `max`). */
  async queryAll(
    index: string,
    partition: IndexValue[],
    opts: { sort?: 'ASC' | 'DESC'; max?: number; filter?: QueryFilter<T> } = {},
  ): Promise<T[]> {
    const max = opts.max ?? 1000;
    const out: T[] = [];
    let cursor: string | undefined;
    do {
      let q = this.entity()
        .query()
        .index(index, { partition })
        .sort(opts.sort === 'DESC' ? Sort.DESC : Sort.ASC)
        .limit(Math.min(100, max - out.length));
      if (opts.filter) q = q.filters(opts.filter);
      if (cursor) q = q.cursor(cursor);
      const page = await q.getMany();
      for (const r of page.results) out.push(r.value.doc);
      cursor = page.nextCursor;
    } while (cursor && out.length < max);
    return out;
  }

  /** One page, for paginated lists in the UI. */
  async queryPage(
    index: string,
    partition: IndexValue[],
    opts: { sort?: 'ASC' | 'DESC'; limit?: number; cursor?: string; filter?: QueryFilter<T> } = {},
  ): Promise<{ items: T[]; cursor: string | null }> {
    let q = this.entity()
      .query()
      .index(index, { partition })
      .sort(opts.sort === 'DESC' ? Sort.DESC : Sort.ASC)
      .limit(Math.min(100, opts.limit ?? 25));
    if (opts.filter) q = q.filters(opts.filter);
    if (opts.cursor) q = q.cursor(opts.cursor);
    const page = await q.getMany();
    return { items: page.results.map((r) => r.value.doc), cursor: page.nextCursor ?? null };
  }

  /** A failed conditional write is a conflict iff the stored version moved. */
  private async isConflict(key: string, expected: number | undefined): Promise<boolean> {
    const now = await this.getRecord(key);
    return (now?.version ?? undefined) !== expected;
  }
}

/* -------------------- multi-record atomic writes -------------------- */

export interface AtomicPlan {
  sets?: Array<{ store: EntityStore<any>; doc: any }>;
  deletes?: Array<{ store: EntityStore<any>; key: string }>;
}

/**
 * Read several records, build a plan, and commit it as one KVS transaction guarded by
 * each read record's version (or its absence). Retries on conflict.
 */
export async function atomic<R extends unknown[]>(
  reads: { [K in keyof R]: { store: EntityStore<R[K]>; key: string } },
  build: (docs: { [K in keyof R]: R[K] | undefined }) => AtomicPlan | null,
  now = Date.now(),
): Promise<AtomicPlan | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const recs = await Promise.all(reads.map((r) => r.store.getRecord(r.key)));
    const docs = recs.map((rec) => (rec ? structuredClone(rec.doc) : undefined)) as { [K in keyof R]: R[K] | undefined };
    const plan = build(docs);
    if (!plan) return null;

    const versions = new Map<string, number | undefined>();
    reads.forEach((r, i) => versions.set(`${r.store.def.name}|${r.key}`, recs[i]?.version));

    let tx = kvs.transact();
    const touched = new Set<string>();
    for (const { store, doc } of plan.sets ?? []) {
      const key = store.def.key(doc);
      const id = `${store.def.name}|${key}`;
      touched.add(id);
      const prev = versions.has(id) ? versions.get(id) : undefined;
      const version = (prev ?? 0) + 1;
      stamp(doc, version, now);
      tx = tx.set(key, toRecord(store.def, doc, version, now), {
        entityName: store.def.name,
        conditions: prev === undefined ? versionAbsent() : versionEquals(prev),
      });
    }
    for (const { store, key } of plan.deletes ?? []) {
      const id = `${store.def.name}|${key}`;
      touched.add(id);
      const prev = versions.get(id);
      tx = tx.delete(key, { entityName: store.def.name, ...(prev !== undefined ? { conditions: versionEquals(prev) } : {}) });
    }
    // Guard records that were read but not written, so the plan was built on current data.
    reads.forEach((r, i) => {
      const id = `${r.store.def.name}|${r.key}`;
      const v = recs[i]?.version;
      if (!touched.has(id) && v !== undefined) tx = tx.check(r.key, { entityName: r.store.def.name, conditions: versionEquals(v) });
    });

    try {
      await tx.execute();
      return plan;
    } catch (e) {
      const fresh = await Promise.all(reads.map((r) => r.store.getRecord(r.key)));
      const moved = fresh.some((f, i) => f?.version !== recs[i]?.version);
      if (!moved) throw e;
      await backoff(attempt);
    }
  }
  throw new AppError('CONFLICT', 'Too many simultaneous edits - please retry.');
}
