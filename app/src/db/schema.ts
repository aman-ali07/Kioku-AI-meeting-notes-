import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdapterAccount } from "next-auth/adapters";

// Postgres has no first-class tsvector type in Drizzle; the generated column
// below is still the source of truth — the GIN index and queries target it.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// ---------------------------------------------------------------------------
// Auth.js (next-auth v4) adapter tables.
// Table + column names match the @auth/drizzle-adapter documented defaults
// exactly, so DrizzleAdapter(db) needs no table-override mapping.
// ---------------------------------------------------------------------------

export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccount["type"]>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refreshToken: text("refreshToken"),
    accessToken: text("accessToken"),
    expiresAt: integer("expiresAt"),
    tokenType: text("tokenType"),
    scope: text("scope"),
    idToken: text("idToken"),
    sessionState: text("sessionState"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (verificationToken) => [
    primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Kioku domain — plan §7 data model, day-1 subset (workspaces + membership).
// meetings/segments/jobs/summaries/share_links/api_keys/usage_meters/
// subscriptions land with the Days 4–6 and 8–13 milestones, forward-only.
// ---------------------------------------------------------------------------

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  // Text (no CHECK constraint) by design: plan vocabulary is product-shaped —
  // widen the TS union here when billing lands; DB constraint when stable.
  billingPlan: text("billing_plan")
    .$type<"free" | "pro" | "team" | "selfhost">()
    .notNull()
    .default("free"),
  // NULL = keep forever (the safe self-host default); a positive integer
  // purges meetings older than that many days. Cloud-free provisioning sets
  // 90 explicitly via DEFAULT_RETENTION_DAYS (see provision.ts).
  retentionDays: integer("retention_days"),
  createdBy: text("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const WORKSPACE_ROLES = ["owner", "member", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (membership) => [
    uniqueIndex("workspace_members_ws_user_uq").on(
      membership.workspaceId,
      membership.userId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Meeting pipeline — plan §7 (Days 4–6). Meetings own an audio key; segments
// stream in from the worker; jobs is the Postgres-only queue.
// ---------------------------------------------------------------------------

export const MEETING_STATUSES = [
  "uploaded",
  "queued",
  "processing",
  "completed",
  "low_confidence",
  "failed",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status")
      .$type<MeetingStatus>()
      .notNull()
      .default("uploaded"),
    source: text("source")
      .$type<"upload" | "recording">()
      .notNull()
      .default("upload"),
    // Storage key in the workspace's audio store (set once the file lands).
    audioKey: text("audio_key"),
    // Filled by the worker's ffprobe step; null while unknown.
    durationMs: integer("duration_ms"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    // English-only v1 (spec §13). Generated so it can never drift from title.
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', "title")`,
    ),
  },
  (m) => [
    index("meetings_ws_created_idx").on(m.workspaceId, m.createdAt),
    index("meetings_search_idx").using("gin", m.searchVector),
    // Partial/substring titles; pg_trgm ships with Postgres (extension enabled
    // by the 0003 custom migration — schema.ts cannot express extensions).
    index("meetings_title_trgm_idx").using("gin", sql`${m.title} gin_trgm_ops`),
  ],
);
export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    // Manual split for now (spec: no diarization on CPU); worker writes 0.
    speakerIdx: integer("speaker_idx").notNull().default(0),
    text: text("text").notNull(),
    // faster-whisper AVG confidence 0..1; UI surfaces the mean as a badge.
    confidence: integer("confidence").notNull().default(0),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', "text")`,
    ),
  },
  (s) => [
    uniqueIndex("transcript_segments_meeting_idx_uq").on(s.meetingId, s.idx),
    index("transcript_segments_search_idx").using("gin", s.searchVector),
  ],
);

export const JOB_KINDS = ["transcribe"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ["queued", "processing", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobPayload = {
  // Minimal on purpose: the worker resolves the meeting row (and its audio
  // key / tenant) from the DB rather than trusting denormalized payload data.
  meetingId: string;
};

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").$type<JobKind>().notNull().default("transcribe"),
    payload: jsonb("payload").$type<JobPayload>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    // Lease-claim marker: watchdog requeues leases older than 15 min.
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (j) => [index("jobs_status_created_idx").on(j.status, j.createdAt)],
);

