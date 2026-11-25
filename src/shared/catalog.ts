/**
 * Static catalogues shared by backend and UI: built-in templates, icebreaker deck,
 * moods, the bundled reaction-GIF pack and ambient tracks.
 *
 * GIFs and audio are bundled with the Custom UI (no Giphy/Tenor/YouTube egress), which
 * keeps the app eligible for Atlassian's "Runs on Atlassian" badge.
 */
import type { MoodKey, RetroSettings, RetroTemplate } from './types';

export const BUILT_IN_TEMPLATES: RetroTemplate[] = [
  {
    id: 'start-stop-continue',
    name: 'Start, Stop, Continue',
    description: 'The classic: what to begin, what to drop, and what is working.',
    theme: 'aurora',
    builtIn: true,
    columns: [
      { title: 'Start', prompt: 'What should we start doing?', color: 'green', emoji: '🚀' },
      { title: 'Stop', prompt: 'What should we stop doing?', color: 'red', emoji: '🛑' },
      { title: 'Continue', prompt: 'What is working that we should keep?', color: 'blue', emoji: '🔁' },
    ],
  },
  {
    id: 'mad-sad-glad',
    name: 'Mad, Sad, Glad',
    description: 'Surface the emotional side of the sprint.',
    theme: 'sunset',
    builtIn: true,
    columns: [
      { title: 'Mad', prompt: 'What frustrated you?', color: 'red', emoji: '😠' },
      { title: 'Sad', prompt: 'What disappointed you?', color: 'blue', emoji: '😢' },
      { title: 'Glad', prompt: 'What made you happy?', color: 'green', emoji: '😄' },
    ],
  },
  {
    id: '4ls',
    name: '4Ls',
    description: 'Liked, Learned, Lacked, Longed For.',
    theme: 'forest',
    builtIn: true,
    columns: [
      { title: 'Liked', prompt: 'What did you enjoy?', color: 'green', emoji: '💚' },
      { title: 'Learned', prompt: 'What did you learn?', color: 'purple', emoji: '🧠' },
      { title: 'Lacked', prompt: 'What was missing?', color: 'orange', emoji: '🕳️' },
      { title: 'Longed For', prompt: 'What do you wish we had?', color: 'blue', emoji: '🌠' },
    ],
  },
  {
    id: 'sailboat',
    name: 'Sailboat',
    description: 'Wind pushes us, anchors hold us back, rocks are risks, the island is our goal.',
    theme: 'sailboat',
    builtIn: true,
    columns: [
      { title: 'Wind', prompt: 'What pushed us forward?', color: 'teal', emoji: '🌬️' },
      { title: 'Anchor', prompt: 'What held us back?', color: 'gray', emoji: '⚓' },
      { title: 'Rocks', prompt: 'What risks lie ahead?', color: 'red', emoji: '🪨' },
      { title: 'Island', prompt: 'Where are we heading?', color: 'yellow', emoji: '🏝️' },
    ],
  },
  {
    id: 'daki',
    name: 'Drop, Add, Keep, Improve',
    description: 'DAKI - a pragmatic look at practices.',
    theme: 'ocean',
    builtIn: true,
    columns: [
      { title: 'Drop', prompt: 'What should we get rid of?', color: 'red', emoji: '🗑️' },
      { title: 'Add', prompt: 'What should we introduce?', color: 'green', emoji: '➕' },
      { title: 'Keep', prompt: 'What should we keep doing?', color: 'blue', emoji: '📌' },
      { title: 'Improve', prompt: 'What could be better?', color: 'purple', emoji: '📈' },
    ],
  },
];

export const DEFAULT_SETTINGS: RetroSettings = {
  anonymousByDefault: true,
  allowAuthorToggleAnonymity: true,
  voteLimit: 5,
  maxVotesPerTarget: 3,
  hideVotesUntilClosed: true,
  defaultViewMode: 'board',
};

export const ICEBREAKER_DECK: readonly string[] = [
  'If this sprint were a movie, what would its title be?',
  'What is one small win from this sprint nobody noticed?',
  'Describe the sprint using only a weather forecast.',
  'Which emoji best sums up your last two weeks?',
  'What is a tool or shortcut you discovered recently?',
  'If you could automate one task forever, what would it be?',
  'What song should be the team anthem this sprint?',
  'Coffee, tea, or something else - what fuelled this sprint?',
  'What is the best piece of advice you received this month?',
  'If our product were an animal, which would it be and why?',
  'What would you do with an extra hour every day?',
  'Name one thing a teammate did that made your week easier.',
  'What is something you are looking forward to next sprint?',
  'If you could swap roles with anyone on the team for a day, who?',
  'What is your go-to snack while debugging?',
  'Which superpower would help most with our current work?',
  'What was the most surprising bug or finding this sprint?',
  'Rate the sprint from 1 to 10 in pizza slices.',
  'What is a hobby you picked up (or want to)?',
  'Share one word that describes how you feel right now.',
];

export const MOODS: ReadonlyArray<{ key: MoodKey; label: string; emoji: string; score: number }> = [
  { key: 'great', label: 'Great', emoji: '🤩', score: 5 },
  { key: 'good', label: 'Good', emoji: '🙂', score: 4 },
  { key: 'okay', label: 'Okay', emoji: '😐', score: 3 },
  { key: 'meh', label: 'Meh', emoji: '😕', score: 2 },
  { key: 'rough', label: 'Rough', emoji: '😫', score: 1 },
];

export const MOOD_KEYS: readonly MoodKey[] = MOODS.map((m) => m.key);

export function emptyMoodCounts(): Record<MoodKey, number> {
  return { great: 0, good: 0, okay: 0, meh: 0, rough: 0 };
}

/** Bundled reaction GIFs, served from static/retro-ui/public/gifs/<id>.gif. */
export const GIF_PACK: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'applause', label: 'Applause' },
  { id: 'facepalm', label: 'Facepalm' },
  { id: 'mind-blown', label: 'Mind blown' },
  { id: 'party', label: 'Party' },
  { id: 'thumbs-up', label: 'Thumbs up' },
  { id: 'this-is-fine', label: 'Everything is fine' },
  { id: 'rocket', label: 'Ship it' },
  { id: 'thinking', label: 'Thinking' },
  { id: 'high-five', label: 'High five' },
  { id: 'sleepy', label: 'Sleepy' },
  { id: 'coffee', label: 'Need coffee' },
  { id: 'celebrate', label: 'Celebrate' },
];

export const GIF_IDS: ReadonlySet<string> = new Set(GIF_PACK.map((g) => g.id));

/** Ambient tracks bundled at static/retro-ui/public/audio/<id>.mp3 (or synthesised in-browser). */
export const AMBIENT_TRACKS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'lofi-rain', label: 'Lo-fi rain' },
  { id: 'cafe', label: 'Coffee shop' },
  { id: 'ocean', label: 'Ocean waves' },
  { id: 'forest', label: 'Forest morning' },
  { id: 'focus', label: 'Deep focus' },
];

export const TRACK_IDS: ReadonlySet<string> = new Set(AMBIENT_TRACKS.map((t) => t.id));

export const LIMITS = {
  titleMax: 120,
  cardTextMax: 2000,
  commentMax: 2000,
  commentsPerCard: 200,
  reactionEmojiMaxLen: 16,
  distinctReactionsPerCard: 24,
  tagsPerCard: 8,
  tagMax: 32,
  columnsMin: 1,
  columnsMax: 8,
  columnTitleMax: 40,
  customIcebreakers: 50,
  voteLimitMax: 20,
  timerMaxSec: 60 * 60,
  facilitatorsMax: 10,
} as const;
