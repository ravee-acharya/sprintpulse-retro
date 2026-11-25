/**
 * SprintPulse Retro - domain model shared by the Forge backend and the Custom UI.
 *
 * Everything in this file is plain, JSON-serialisable data with no runtime imports,
 * so it can be imported (type-only) from both `src/` and `static/retro-ui/`.
 */

export type AccountId = string;
export type ISODate = string;
/** Unix epoch milliseconds. */
export type EpochMs = number;

/* ------------------------------------------------------------------ */
/* Templates & columns                                                 */
/* ------------------------------------------------------------------ */

export type ThemeKey = 'aurora' | 'sunset' | 'ocean' | 'forest' | 'sailboat' | 'midnight' | 'paper';

export type ColumnColor = 'green' | 'red' | 'blue' | 'yellow' | 'purple' | 'teal' | 'orange' | 'gray';

export interface RetroColumn {
  id: string;
  title: string;
  /** Short hint shown under the column title ("What slowed us down?"). */
  prompt: string;
  color: ColumnColor;
  emoji: string;
  order: number;
}

export interface RetroTemplate {
  id: string;
  name: string;
  description: string;
  theme: ThemeKey;
  columns: Array<Omit<RetroColumn, 'id' | 'order'>>;
  builtIn: boolean;
  /** Custom templates only. */
  projectId?: string;
  createdBy?: AccountId;
  createdAt?: EpochMs;
}

/* ------------------------------------------------------------------ */
/* Board, settings, facilitation                                       */
/* ------------------------------------------------------------------ */

export type RetroPhase = 'icebreaker' | 'brainstorm' | 'group' | 'vote' | 'actions' | 'closed';

export const PHASE_ORDER: readonly RetroPhase[] = ['icebreaker', 'brainstorm', 'group', 'vote', 'actions', 'closed'];

export type ViewMode = 'board' | 'focus';

export interface RetroSettings {
  /** New cards are anonymous unless the author opts in to show their name. */
  anonymousByDefault: boolean;
  /** Whether authors may flip the anonymity of an individual card. */
  allowAuthorToggleAnonymity: boolean;
  /** Total votes each participant may spend. */
  voteLimit: number;
  /** Max votes one participant may put on a single card/group. */
  maxVotesPerTarget: number;
  /** Hide vote totals from everyone until the facilitator closes voting. */
  hideVotesUntilClosed: boolean;
  /** Default layout; each participant may still switch locally. */
  defaultViewMode: ViewMode;
}

export interface TimerState {
  durationSec: number;
  /** Epoch ms at which the timer reaches zero while running. */
  endsAt: EpochMs | null;
  /** Remaining seconds while paused (null while running). */
  pausedRemainingSec: number | null;
  startedBy: AccountId;
}

export interface MusicState {
  trackId: string | null;
  playing: boolean;
  /** Epoch ms when playback (re)started, so late joiners can seek. */
  startedAt: EpochMs | null;
  volume: number; // 0..1
}

export interface SpotlightState {
  targetType: 'card' | 'group';
  targetId: string;
  setBy: AccountId;
  at: EpochMs;
}

export interface IcebreakerState {
  question: string;
  /** Index into the curated deck, or null for a custom question. */
  deckIndex: number | null;
  customQuestions: string[];
}

export interface FacilitatorState {
  phase: RetroPhase;
  /** Brainstorm cards are masked for non-authors until revealed. */
  revealed: boolean;
  votingClosed: boolean;
  spotlight: SpotlightState | null;
  timer: TimerState | null;
  music: MusicState;
  icebreaker: IcebreakerState | null;
}

export interface SprintRef {
  id: number;
  name: string;
  state: 'active' | 'closed' | 'future';
  boardId: number;
  startDate?: ISODate;
  endDate?: ISODate;
  completeDate?: ISODate;
}

export interface RetroSummary {
  cardCount: number;
  groupCount: number;
  participantCount: number;
  voteCount: number;
  actionCount: number;
  moodAverage: number | null;
  moodCounts: Record<MoodKey, number>;
  /** Normalised topic -> occurrences, from card tags and group titles. */
  topicCounts: Record<string, number>;
  closedAt: EpochMs;
}

export interface RetroBoard {
  id: string;
  projectId: string;
  projectKey: string;
  title: string;
  templateId: string;
  theme: ThemeKey;
  columns: RetroColumn[];
  sprint: SprintRef | null;
  settings: RetroSettings;
  facilitator: FacilitatorState;
  facilitatorIds: AccountId[];
  status: 'active' | 'closed' | 'archived';
  createdAt: EpochMs;
  createdBy: AccountId;
  updatedAt: EpochMs;
  /** Optimistic-lock version of the stored record. */
  version: number;
  /** Filled in when the retro is closed; drives analytics without re-reading every card. */
  summary: RetroSummary | null;
}

/* ------------------------------------------------------------------ */
/* Cards, groups, comments, reactions                                  */
/* ------------------------------------------------------------------ */

export interface CardComment {
  id: string;
  authorId: AccountId;
  text: string; // markdown
  createdAt: EpochMs;
}

export interface RetroCard {
  id: string;
  retroId: string;
  columnId: string;
  authorId: AccountId;
  anonymous: boolean;
  text: string; // markdown
  /** Id from the curated, bundled reaction-GIF pack (see shared/catalog.ts). */
  gifId: string | null;
  groupId: string | null;
  order: number;
  /** emoji -> accountIds who reacted. */
  reactions: Record<string, AccountId[]>;
  comments: CardComment[];
  tags: string[];
  createdAt: EpochMs;
  updatedAt: EpochMs;
  version: number;
}

export interface CardGroup {
  id: string;
  retroId: string;
  columnId: string;
  title: string;
  order: number;
  createdBy: AccountId;
  createdAt: EpochMs;
  version: number;
}

/**
 * What a given viewer is allowed to see of a card. Produced server-side so that
 * masked text and anonymous authors never leave the backend.
 */
export interface CardView extends Omit<RetroCard, 'authorId' | 'text'> {
  authorId: AccountId | null;
  text: string;
  masked: boolean;
  /** Length of the hidden text, so masked cards render at a plausible size. */
  maskedLength: number;
  isMine: boolean;
}

/* ------------------------------------------------------------------ */
/* Votes & moods                                                       */
/* ------------------------------------------------------------------ */

/** One document per participant per retro - only that participant ever writes it. */
export interface VoteBallot {
  retroId: string;
  accountId: AccountId;
  /** targetId (card or group id) -> votes. */
  votes: Record<string, number>;
  updatedAt: EpochMs;
  version: number;
}

export interface VoteSummary {
  limit: number;
  maxPerTarget: number;
  myVotes: Record<string, number>;
  myRemaining: number;
  /** null while votes are hidden. */
  totals: Record<string, number> | null;
  votersCount: number;
  hidden: boolean;
}

export type MoodKey = 'great' | 'good' | 'okay' | 'meh' | 'rough';

export interface MoodCheckin {
  retroId: string;
  projectId: string;
  accountId: AccountId;
  mood: MoodKey;
  gifId: string | null;
  note: string;
  at: EpochMs;
}

export interface MoodSummary {
  counts: Record<MoodKey, number>;
  average: number | null;
  total: number;
  mine: MoodKey | null;
}

/* ------------------------------------------------------------------ */
/* Action items & Jira                                                 */
/* ------------------------------------------------------------------ */

export interface JiraIssueLink {
  issueId: string;
  issueKey: string;
  url: string;
  issueType: string;
  status: string;
  statusCategory: 'new' | 'indeterminate' | 'done' | 'unknown';
  assigneeAccountId: AccountId | null;
  assigneeName: string | null;
  syncedAt: EpochMs;
}

export interface ActionItem {
  id: string;
  projectId: string;
  retroId: string;
  title: string;
  description: string;
  assigneeAccountId: AccountId | null;
  sourceCardId: string | null;
  dueDate: ISODate | null;
  /** Local status; mirrors Jira's status category once an issue is linked. */
  status: 'open' | 'done';
  jira: JiraIssueLink | null;
  createdBy: AccountId;
  createdAt: EpochMs;
  updatedAt: EpochMs;
  version: number;
}

export interface JiraUser {
  accountId: AccountId;
  displayName: string;
  avatarUrl: string | null;
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl: string | null;
  subtask: boolean;
}

/* ------------------------------------------------------------------ */
/* Snapshots, history, analytics                                       */
/* ------------------------------------------------------------------ */

export interface RetroSnapshot {
  board: RetroBoard;
  cards: CardView[];
  groups: CardGroup[];
  votes: VoteSummary;
  mood: MoodSummary;
  actions: ActionItem[];
  viewer: { accountId: AccountId; isFacilitator: boolean };
  /** Realtime channel + subscribe token for this retro (token null if signing is unavailable). */
  realtime: { channel: string; token: string | null };
  serverTime: EpochMs;
}

export interface RetroListItem {
  id: string;
  title: string;
  status: RetroBoard['status'];
  templateId: string;
  sprintName: string | null;
  phase: RetroPhase;
  createdAt: EpochMs;
  createdBy: AccountId;
  summary: RetroSummary | null;
}

export interface RetroTrendPoint {
  retroId: string;
  title: string;
  sprintName: string | null;
  date: EpochMs;
  moodAverage: number | null;
  moodCounts: Record<MoodKey, number>;
  cardCount: number;
  participantCount: number;
  actionCount: number;
  actionsDone: number;
}

export interface TeamAnalytics {
  projectId: string;
  trend: RetroTrendPoint[];
  actions: { total: number; done: number; open: number; linkedToJira: number; completionRate: number | null };
  topTopics: Array<{ topic: string; count: number; retros: number }>;
  generatedAt: EpochMs;
}

/* ------------------------------------------------------------------ */
/* RPC envelope                                                        */
/* ------------------------------------------------------------------ */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'PHASE'
  | 'VOTE_LIMIT'
  | 'VOTE_TARGET_LIMIT'
  | 'NO_VOTES'
  | 'JIRA_ERROR'
  | 'CONFLUENCE_UNAVAILABLE'
  | 'INTERNAL';

export interface RpcError {
  code: ErrorCode;
  message: string;
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcError };
