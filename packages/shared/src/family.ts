// "מי מהמשפחה?" — shared types.
// All game content lives in apps/server/src/games/whoInFamily/content.ts

export type FamilyPhase = "lobby" | "survey" | "question" | "reveal" | "final";

/**
 * "family" needs three or more players. "couple" is a different game for
 * exactly two: rounds A and B collapse with two people (a majority vote where
 * everyone always wins, and a "who wrote it" with one possible answer), so the
 * couple game leans on prediction instead.
 */
export type FamilyMode = "family" | "couple";

/**
 * A = "מי הכי סביר ש..."   B = "מי כתב את זה?"   C = "מה המספר?"
 * D = "מה ענית?" — both answer about themselves, then predict each other
 */
export type FamilyRoundType = "A" | "B" | "C" | "D";

/**
 * C: the subject types a number, then everyone guesses it.
 * D: both answer for themselves, then both predict the other.
 */
export type FamilyRoundStage = "subject_input" | "guessing" | "self_answer" | "predict";

export interface FamilyPlayerInfo {
  id: string;
  nickname: string;
  isHost: boolean;
  isOnline: boolean;
  score: number;
  /** true when two people joined together under one combined name */
  isShared: boolean;
}

// ─── Survey phase ─────────────────────────────────────────────────────────────

export interface FamilySurveyView {
  /** the questions assigned to me (empty for a player who joined mid-game) */
  questions: string[];
  /** my answers, index-aligned with `questions` — sent back on reconnect */
  myAnswers: string[];
  iAmFinished: boolean;
  finishedCount: number;
  totalCount: number;
  /** who is already done — drives the roster at the bottom of the screen */
  finishedIds: string[];
}

// ─── Question phase ───────────────────────────────────────────────────────────

export interface FamilyQuestionView {
  roundNumber: number;
  totalRounds: number;
  type: FamilyRoundType;
  /** the big text on screen; for round C it is hidden from non-subjects during subject_input */
  prompt: string | null;
  stage: FamilyRoundStage | null;

  /** Round B — the anonymous survey answer being guessed */
  answerText: string | null;
  /** Round B — I wrote it, so I watch instead of voting */
  iAmAuthor: boolean;

  /** Round C — whose number everyone is guessing */
  subjectId: string | null;
  subjectNickname: string | null;
  iAmSubject: boolean;

  /** player ids I am allowed to vote for (rounds A and B) */
  votableIds: string[];

  /** Round D — the options both partners choose from */
  choices: string[];
  /** Round D — what I picked for myself, and what I think my partner picked */
  myChoice: number | null;
  myPrediction: number | null;
  /** Round D — my partner's name, shown while predicting */
  partnerNickname: string | null;

  /** my answer so far — restored on reconnect so I never vote twice */
  myVote: string | null;
  myNumber: number | null;

  answeredCount: number;
  expectedCount: number;
  /** who this round is waiting on (excludes the author in B, the subject in C) */
  participantIds: string[];
  /** which of them have already answered */
  answeredIds: string[];
}

// ─── Reveal phase ─────────────────────────────────────────────────────────────

/** Rounds A and B — one row per player who received votes. Ordered lowest → highest. */
export interface FamilyVoteReveal {
  playerId: string;
  nickname: string;
  votes: number;
  voterIds: string[];
  /** round B — this is the player who actually wrote the answer */
  isAuthor: boolean;
}

/** Round C — one row per guesser. Ordered furthest → closest. */
/** Round D — what each partner picked, and what the other predicted. */
export interface FamilyPredictionReveal {
  playerId: string;
  nickname: string;
  /** the option they picked for themselves */
  choice: string;
  /** what their partner thought they would pick */
  predictedByPartner: string | null;
  correct: boolean;
}

export interface FamilyNumberReveal {
  playerId: string;
  nickname: string;
  guess: number;
  distance: number;
  isExact: boolean;
  isClosest: boolean;
}

export interface FamilyPointsAwarded {
  playerId: string;
  nickname: string;
  points: number;
  /** short Hebrew explanation, e.g. "הצבעת עם הרוב" — points must never feel arbitrary */
  reason: string;
}

export interface FamilyRevealView {
  roundNumber: number;
  type: FamilyRoundType;
  prompt: string;

  votes: FamilyVoteReveal[];
  numbers: FamilyNumberReveal[];
  /** round D */
  predictions: FamilyPredictionReveal[];

  /** round B */
  answerText: string | null;
  authorId: string | null;
  authorNickname: string | null;

  /** round C */
  subjectNickname: string | null;
  correctNumber: number | null;

  pointsAwarded: FamilyPointsAwarded[];
  /** one line summing up what just happened, shown once the reveal finishes */
  summary: string;
}

// ─── Final phase ──────────────────────────────────────────────────────────────

export interface FamilyTitle {
  key: string;
  /** Hebrew title, e.g. "כוכב הערב" */
  label: string;
  playerId: string;
  nickname: string;
  /** Hebrew explanation, e.g. "קיבל 12 הצבעות" */
  detail: string;
}

export interface FamilyFinalView {
  /** full scoreboard, highest first */
  standings: FamilyPlayerInfo[];
  titles: FamilyTitle[];
  /** couple game only — how often each predicted the other correctly */
  knowledgePercent: number | null;
}

// ─── Room ─────────────────────────────────────────────────────────────────────

/** Where this game's questions come from. Chosen by the host in the lobby. */
export type FamilyQuestionSource = "file" | "ai";

export interface FamilyNoteStatus {
  playerId: string;
  nickname: string;
  hasWritten: boolean;
}

export interface FamilySetup {
  mode: FamilyMode;
  source: FamilyQuestionSource;
  /** how many rounds this game will run — the host picks it in the lobby */
  roundCount: number;
  /** what I wrote about the family — every player gets their own box */
  myNote: string;
  /** who has already written something, for the lobby roster */
  notes: FamilyNoteStatus[];
  /** true while questions are being generated, right after the host hits start */
  isPreparing: boolean;
  /** set when AI was requested but we fell back to the built-in questions */
  aiFailed: boolean;
  /** false when the server has no OpenAI key — the lobby hides the AI option */
  aiAvailable: boolean;
}

export interface FamilyRoomState {
  id: string;
  code: string;
  phase: FamilyPhase;
  hostPlayerId: string;
  players: FamilyPlayerInfo[];

  roundNumber: number;
  totalRounds: number;

  /** ISO timestamp the current phase ends at; the client counts down from this */
  phaseEndsAt: string | null;

  survey: FamilySurveyView | null;
  question: FamilyQuestionView | null;
  reveal: FamilyRevealView | null;
  final: FamilyFinalView | null;

  setup: FamilySetup;

  config: {
    surveyAnswerMaxChars: number;
    minPlayers: number;
    noteMaxChars: number;
    minRounds: number;
    maxRounds: number;
  };

  createdAt: string;
}

export interface FamilySnapshot {
  room: FamilyRoomState;
  me: { playerId: string | null; nickname: string | null };
}

export interface CreateFamilyRoomResponse {
  room: FamilySnapshot;
  playerId: string;
  sessionToken: string;
}

export interface JoinFamilyRoomResponse {
  room: FamilySnapshot;
  playerId: string;
  sessionToken: string;
}
