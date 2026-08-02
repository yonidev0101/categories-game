// ─── Core types ───────────────────────────────────────────────────────────────

export type CodenamesPhase = "lobby" | "generating" | "in_progress" | "game_over";
export type CodenamesTeam  = "red" | "blue";
export type CodenamesRole  = "spymaster" | "operative";
export type CardColor      = "red" | "blue" | "neutral" | "assassin";
export type TurnPhase      = "giving_clue" | "guessing";

// ─── Clue & Turn ──────────────────────────────────────────────────────────────

export interface CodenamesClue {
  word:   string;
  number: number;
}

export interface CodenamesTurn {
  team:             CodenamesTeam;
  phase:            TurnPhase;
  clue:             CodenamesClue | null;
  guessesRemaining: number;
  turnEndsAt:       string | null; // ISO timestamp — set when timer is enabled
}

// ─── Card views ───────────────────────────────────────────────────────────────

/** Full card stored on the server */
export interface CodenamesCard {
  id:         number;
  word:       string;
  color:      CardColor;
  revealed:   boolean;
  revealedBy?: CodenamesTeam;
}

/**
 * Personalised card sent to clients.
 * `color` is present for:
 *  - Spymasters (all unrevealed cards)
 *  - Everyone (revealed cards)
 */
export interface CodenamesCardView {
  id:          number;
  word:        string;
  revealed:    boolean;
  revealedBy?: CodenamesTeam;
  color?:      CardColor;
}

// ─── Players & settings ───────────────────────────────────────────────────────

export interface CodenamesPlayer {
  id:       string;
  nickname: string;
  team:     CodenamesTeam | null;
  role:     CodenamesRole | null;
  isOnline: boolean;
}

export interface CodenamesSettings {
  timerEnabled: boolean;
  timerSeconds: number; // 30 | 60 | 90 | 120 | 180
}

// ─── History ──────────────────────────────────────────────────────────────────

export interface CodenamesClueHistoryEntry {
  team:          CodenamesTeam;
  clueWord:      string;
  clueNumber:    number;
  cardsRevealed: number; // how many of their own cards were revealed this turn
}

// ─── Main snapshot ────────────────────────────────────────────────────────────

/** Personalised snapshot sent to each connected client */
export interface CodenamesSnapshot {
  code:          string;
  phase:         CodenamesPhase;
  players:       CodenamesPlayer[];
  cards:         CodenamesCardView[];
  currentTurn:   CodenamesTurn | null;
  winner:        CodenamesTeam | null;
  winReason:     "all_found" | "assassin" | null;
  redCardsLeft:  number;
  blueCardsLeft: number;
  firstTeam:     CodenamesTeam | null;
  clueHistory:   CodenamesClueHistoryEntry[];
  settings:      CodenamesSettings;
  hostPlayerId:  string;
  myPlayerId:    string | null;
}

// ─── REST response types ──────────────────────────────────────────────────────

export interface CreateCodenamesRoomResponse {
  room:         CodenamesSnapshot;
  playerId:     string;
  sessionToken: string;
}

export interface JoinCodenamesRoomResponse {
  room:         CodenamesSnapshot;
  playerId:     string;
  sessionToken: string;
}
