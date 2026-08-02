export type TabooPhase = "lobby" | "playing" | "game_over";

export interface TabooHint {
  id: string;
  text: string;
  isViolation: boolean;
  timestamp: string;
}

export interface TabooGuess {
  id: string;
  guesserId: string;
  guesserNickname: string;
  text: string;
  correct: boolean;
  timestamp: string;
}

export interface TabooWordRecord {
  id: string;
  word: string;
  forbiddenWords: string[];
  hints: TabooHint[];
  guesses: TabooGuess[];
  resolvedBy: string | null;
  resolvedByNickname: string | null;
  skipped: boolean;
  violated: boolean;
  timedOut: boolean;
}

export interface TabooTurn {
  id: string;
  explainerId: string;
  explainerNickname: string;
  roundNumber: number;
  words: TabooWordRecord[];
  points: number;
}

export interface TabooPlayerInfo {
  id: string;
  nickname: string;
  isHost: boolean;
  isOnline: boolean;
  score: number;
}

export interface TabooSettings {
  rounds: number;         // 1–3
  wordsPerTurn: number;   // 3–7
  secondsPerWord: number; // 30 | 60 | 90
}

export interface TabooRoomState {
  id: string;
  code: string;
  phase: TabooPhase;
  hostPlayerId: string;
  settings: TabooSettings;
  players: TabooPlayerInfo[];
  turns: TabooTurn[];
  currentTurn: Omit<TabooTurn, "words"> | null;
  /** Hidden from guessers; only explainer sees their word */
  currentWord: string | null;
  /** Hidden from guessers */
  forbiddenWords: string[] | null;
  currentWordIndex: number;
  roundNumber: number;
  wordTimeLeft: number | null;
  currentHints: TabooHint[];
  currentGuesses: TabooGuess[];
  explainerOrder: string[];
  currentExplainerIndex: number;
  createdAt: string;
}

export interface TabooSnapshot {
  room: TabooRoomState;
  me: { playerId: string | null; nickname: string | null };
}

export interface CreateTabooRoomResponse {
  room: TabooSnapshot;
  playerId: string;
  sessionToken: string;
}

export interface JoinTabooRoomResponse {
  room: TabooSnapshot;
  playerId: string;
  sessionToken: string;
}
