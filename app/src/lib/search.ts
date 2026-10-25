import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { MeetingStatus } from "@/db/schema";

/**
 * Meeting search — Postgres FTS (`tsvector` GIN) for words and pg_trgm for
 * title substrings. English-only v1 (spec §13). Tenant scoping is a required
 * argument, never derived from the query text.
 */
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 200;
export const SEARCH_RESULT_LIMIT = 20;

/** ts_headline markers — parsed out before rendering; never sent as HTML. */
const HIT_START = "\u27e6";
const HIT_END = "\u27e7";

export type SnippetPart = { text: string; match: boolean };

export type SearchResult = {
  meetingId: string;
  title: string;
  status: MeetingStatus;
  matchedIn: "title" | "transcript";
  /** Present only for transcript matches; the UI deep-links the segment. */
  segmentIdx: number | null;
  startMs: number | null;
  snippet: SnippetPart[] | null;
  score: number;
};

type TitleRow = {
  meetingId: string;
  title: string;
  status: MeetingStatus;
  rank: number;
};

type SegmentRow = {
  meetingId: string;
  title: string;
  status: MeetingStatus;
  segmentIdx: number;
  startMs: number;
  rank: number;
  snippet: string;
};

/** Escape LIKE metacharacters so a search for "100%" is not a wildcard. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Split ts_headline output into safe render parts (no HTML is trusted). */
export function parseSnippet(raw: string | null): SnippetPart[] | null {
  if (!raw) return null;

  const parts: SnippetPart[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(HIT_START, cursor);
    if (start === -1) {
      parts.push({ text: raw.slice(cursor), match: false });
      break;
    }
    if (start > cursor) {
      parts.push({ text: raw.slice(cursor, start), match: false });
    }
    const end = raw.indexOf(HIT_END, start + HIT_START.length);
    if (end === -1) {
      // Unbalanced marker: keep the rest literal rather than dropping text.
      parts.push({ text: raw.slice(start), match: false });
      break;
    }
    parts.push({ text: raw.slice(start + HIT_START.length, end), match: true });
    cursor = end + HIT_END.length;
  }
  return parts;
}

function titleHits(workspaceId: string, query: string, like: string) {
  return db.execute(sql`
    SELECT m.id AS "meetingId",
           m.title AS "title",
           m.status AS "status",
           ts_rank(m.search_vector, websearch_to_tsquery('english', ${query})) AS "rank"
      FROM meetings m
     WHERE m.workspace_id = ${workspaceId}
       AND (
         m.search_vector @@ websearch_to_tsquery('english', ${query})
         OR m.title ILIKE ${like} ESCAPE '\\'
       )
     ORDER BY "rank" DESC, m.created_at DESC
     LIMIT ${SEARCH_RESULT_LIMIT}
  `);
}

function segmentHits(workspaceId: string, query: string) {
  return db.execute(sql`
    SELECT meeting_id AS "meetingId",
           title AS "title",
           status AS "status",
           segment_idx AS "segmentIdx",
           start_ms AS "startMs",
           rank AS "rank",
           snippet AS "snippet"
      FROM (
        SELECT DISTINCT ON (m.id)
               m.id AS meeting_id,
               m.title AS title,
               m.status AS status,
               s.idx AS segment_idx,
               s.start_ms AS start_ms,
               ts_rank(s.search_vector, q.tsq) AS rank,
               ts_headline(
                 'english', s.text, q.tsq,
                 ${`StartSel=${HIT_START}, StopSel=${HIT_END}, MaxWords=24, MinWords=8, MaxFragments=1`}
               ) AS snippet
          FROM transcript_segments s
          JOIN meetings m ON m.id = s.meeting_id
          CROSS JOIN LATERAL (
            SELECT websearch_to_tsquery('english', ${query}) AS tsq
          ) q
         WHERE m.workspace_id = ${workspaceId}
           AND s.search_vector @@ q.tsq
         ORDER BY m.id, rank DESC
      ) best
     ORDER BY "rank" DESC
     LIMIT ${SEARCH_RESULT_LIMIT}
  `);
}

export async function searchMeetings(
  workspaceId: string,
  rawQuery: string,
): Promise<SearchResult[]> {
  const query = rawQuery.trim();
  if (query.length < SEARCH_MIN_CHARS) return [];

  const like = `%${escapeLike(query)}%`;
  // Two independent queries, merged here: the SQL stays readable and each
  // hit type keeps its own ranking semantics.
  const [titleResult, segmentResult] = await Promise.all([
    titleHits(workspaceId, query, like),
    segmentHits(workspaceId, query),
  ]);
  const titles = titleResult as unknown as TitleRow[];
  const segments = segmentResult as unknown as SegmentRow[];

  const merged = new Map<string, SearchResult>();

  for (const row of segments) {
    merged.set(row.meetingId, {
      meetingId: row.meetingId,
      title: row.title,
      status: row.status,
      matchedIn: "transcript",
      segmentIdx: Number(row.segmentIdx),
      startMs: Number(row.startMs),
      snippet: parseSnippet(row.snippet),
      score: Number(row.rank),
    });
  }

  for (const row of titles) {
    const rank = Number(row.rank) + 0.5; // titles are cheap, strong signals
    const existing = merged.get(row.meetingId);
    if (existing) {
      existing.matchedIn = "title";
      existing.score = Math.max(existing.score, rank);
      continue;
    }
    merged.set(row.meetingId, {
      meetingId: row.meetingId,
      title: row.title,
      status: row.status,
      matchedIn: "title",
      segmentIdx: null,
      startMs: null,
      snippet: null,
      score: rank,
    });
  }

  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_RESULT_LIMIT);
}
