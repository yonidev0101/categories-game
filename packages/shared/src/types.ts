export type RoomPhase =
  | "lobby"
  | "starting"
  | "in_round"
  | "countdown"
  | "validating"
  | "round_results"
  | "game_over";

export type GameMode = "classic" | "advanced";

export interface CategoryDefinition {
  id: string;
  label: string;
  description: string;
}

export interface RoomSettings {
  roundsCount: number;
  countdownSeconds: number;
  roundTimeSeconds: number;
  mode: GameMode;
  categories: CategoryDefinition[];
}

export interface PlayerSummary {
  id: string;
  nickname: string;
  score: number;
  isHost: boolean;
  isReady: boolean;
  isOnline: boolean;
  progressCount: number;
  hasFinishedRound: boolean;
}

export interface PlayerProgress {
  playerId: string;
  filledCount: number;
  totalCount: number;
  hasFinished: boolean;
}

export interface RoomSummary {
  id: string;
  code: string;
  phase: RoomPhase;
  hostPlayerId: string;
  settings: RoomSettings;
  currentRoundNumber: number;
  activeLetter: string | null;
  activeLetters: string[];
  countdownEndsAt: string | null;
  roundEndsAt: string | null;
  players: PlayerSummary[];
  categoryPressure: Record<string, number>;
}

export interface SubmissionPayload {
  roomCode: string;
  roundNumber: number;
  answers: Record<string, string>;
}

export interface ValidatedAnswer {
  categoryId: string;
  answer: string;
  normalizedAnswer: string;
  isRuleValid: boolean;
  isCategoryFit: boolean;
  isValid: boolean;
  isDuplicate: boolean;
  score: number;
  reason: string;
  confidence: number;
}

export interface ScoreBreakdown {
  playerId: string;
  roundNumber: number;
  totalScore: number;
  answers: ValidatedAnswer[];
}

export interface RoundSnapshot {
  roundNumber: number;
  letter: string;
  letters: string[];
  categories: CategoryDefinition[];
  startsAt: string;
  endsAt: string | null;
}

export interface RoomStateSnapshot {
  room: RoomSummary;
  round: RoundSnapshot | null;
  scoreboard: ScoreBreakdown[];
  me: {
    playerId: string | null;
    nickname: string | null;
  };
}

export interface CreateRoomInput {
  nickname: string;
  settings?: Partial<RoomSettings>;
}

export interface UpdateRoomSettingsInput {
  playerId: string;
  settings: Partial<RoomSettings>;
}

export interface JoinRoomInput {
  nickname: string;
}

export interface CreateRoomResponse {
  room: RoomStateSnapshot;
  sessionToken: string;
}

export interface JoinRoomResponse {
  room: RoomStateSnapshot;
  sessionToken: string;
}

export interface ValidationLogEntry {
  roomId: string;
  roundNumber: number;
  playerId: string;
  model: string;
  promptVersion: string;
  rawResponse: unknown;
  finalizedAt: string;
}

export interface AIValidationResult {
  categoryId: string;
  isCategoryFit: boolean;
  confidence: number;
  reason: string;
}

export interface AIValidationBatchResult {
  answers: AIValidationResult[];
}

