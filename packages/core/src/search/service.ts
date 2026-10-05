import type { Db } from '../db/client.ts';

export type SearchLang = 'fi' | 'sv' | 'en' | 'simple';
export type Visibility = 'public' | 'internal' | 'private';

export interface SearchDocument {
  contentType: string;
  refId: string;
  moduleId: string;
  title: string;
  body?: string | null;
  urlPath?: string | null;
  lang?: SearchLang;
  visibility?: Visibility;
  readPermission: string;
  meta?: Record<string, unknown>;
}

export interface SearchHit {
  contentType: string;
  refId: string;
  moduleId: string;
  title: string;
  urlPath: string | null;
  snippet: string | null;
  rank: number;
  meta: Record<string, unknown>;
}

export interface SearchQuery {
  q: string;
  types?: string[];
  limit?: number;
  offset?: number;
}

/** Upserts a document into the global search index. Call inside the module's write transaction. */
export async function indexDocument(db: Db, doc: SearchDocument): Promise<void> {
  await db`
    insert into core.search_index (content_type, ref_id, module_id, title, body, url_path, lang, visibility, read_permission, meta)
    values (${doc.contentType}, ${doc.refId}, ${doc.moduleId}, ${doc.title}, ${doc.body ?? null}, ${doc.urlPath ?? null},
            ${doc.lang ?? 'fi'}, ${doc.visibility ?? 'internal'}, ${doc.readPermission}, ${db.json((doc.meta ?? {}) as never)})
    on conflict (content_type, ref_id) do update set
      module_id = excluded.module_id, title = excluded.title, body = excluded.body, url_path = excluded.url_path,
      lang = excluded.lang, visibility = excluded.visibility, read_permission = excluded.read_permission,
      meta = excluded.meta, updated_at = now()`;
}

export async function removeDocument(db: Db, contentType: string, refId: string): Promise<void> {
  await db`delete from core.search_index where content_type = ${contentType} and ref_id = ${refId}`;
}

/**
 * Full-text search using PostgreSQL's finnish/swedish dictionaries (inflected
 * forms match: "vero" finds "verotuksen", "veroja") plus trigram fallback for
 * names and partial words. Supports web-search syntax: "exact phrase", OR, -not.
 * Runs as the calling actor, so RLS limits results to readable content types.
 */
export async function searchText(db: Db, query: SearchQuery): Promise<SearchHit[]> {
  const q = query.q.trim();
  if (!q) return [];
  const limit = Math.min(query.limit ?? 20, 100);
  const offset = query.offset ?? 0;
  const types = query.types?.length ? query.types : null;
  return db<SearchHit[]>`
    with q as (
      select websearch_to_tsquery('finnish', ${q}) as fi,
             websearch_to_tsquery('swedish', ${q}) as sv,
             websearch_to_tsquery('simple', ${q}) as si
    )
    select s.content_type, s.ref_id, s.module_id, s.title, s.url_path, s.meta,
      ts_headline(case s.lang when 'sv' then 'swedish'::regconfig else 'finnish'::regconfig end,
        coalesce(s.body, s.title),
        case s.lang when 'sv' then q.sv else q.fi end,
        'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=25, MinWords=8') as snippet,
      greatest(ts_rank(s.tsv, q.fi), ts_rank(s.tsv, q.sv), ts_rank(s.tsv, q.si),
               similarity(s.title, ${q}) * 0.5)::float8 as rank
    from core.search_index s, q
    where (s.tsv @@ q.fi or s.tsv @@ q.sv or s.tsv @@ q.si or s.title % ${q} or s.title ilike ${'%' + q + '%'})
      ${types ? db`and s.content_type = any(${types})` : db``}
    order by rank desc, s.title
    limit ${limit} offset ${offset}`;
}

/** Semantic search over stored embeddings for the active embedding model. */
export async function searchSemantic(
  db: Db,
  input: { vector: number[]; model: string; types?: string[]; limit?: number },
): Promise<SearchHit[]> {
  const limit = Math.min(input.limit ?? 20, 100);
  const vec = `[${input.vector.join(',')}]`;
  const types = input.types?.length ? input.types : null;
  return db<SearchHit[]>`
    select s.content_type, s.ref_id, s.module_id, s.title, s.url_path, s.meta,
      left(s.body, 240) as snippet,
      (1 - min(e.embedding <=> ${vec}::vector))::float8 as rank
    from core.embeddings e
    join core.search_index s on s.content_type = e.content_type and s.ref_id = e.ref_id
    where e.model = ${input.model} and e.dims = ${input.vector.length}
      ${types ? db`and s.content_type = any(${types})` : db``}
    group by s.content_type, s.ref_id, s.module_id, s.title, s.url_path, s.meta, s.body
    order by rank desc
    limit ${limit}`;
}

export async function storeEmbedding(
  db: Db,
  input: {
    contentType: string;
    refId: string;
    chunk?: number;
    model: string;
    vector: number[];
    contentHash: string;
  },
): Promise<void> {
  const vec = `[${input.vector.join(',')}]`;
  await db`
    insert into core.embeddings (content_type, ref_id, chunk, model, dims, embedding, content_hash)
    values (${input.contentType}, ${input.refId}, ${input.chunk ?? 0}, ${input.model}, ${input.vector.length},
            ${vec}::vector, ${input.contentHash})
    on conflict (content_type, ref_id, chunk, model) do update set
      embedding = excluded.embedding, dims = excluded.dims, content_hash = excluded.content_hash, created_at = now()`;
}

/** Content types registered by modules (label + permission), used by the global search UI. */
export class SearchTypeRegistry {
  private types = new Map<
    string,
    { type: string; label: string; moduleId: string; readPermission: string }
  >();

  register(t: { type: string; label: string; moduleId: string; readPermission: string }): void {
    this.types.set(t.type, t);
  }

  list() {
    return [...this.types.values()];
  }
}
