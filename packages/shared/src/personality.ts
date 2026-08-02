export type PersonalityPhase =
  | "lobby"
  | "character_selection"
  | "questioning"
  | "game_over";

export type QuestionAnswer = "yes" | "no" | "maybe";

export interface PersonalityQuestion {
  id: string;
  askerId: string;
  askerNickname: string;
  question: string;
  answer: QuestionAnswer | null;
  askedAt: string;
  answeredAt: string | null;
}

export interface PersonalityGuessRecord {
  id: string;
  guesserId: string;
  guesserNickname: string;
  guess: string;
  correct: boolean;
  timestamp: string;
}

export interface PersonalityPlayerInfo {
  id: string;
  nickname: string;
  isHost: boolean;
  isPicker: boolean;
  isOnline: boolean;
  guessesLeft: number;
  isEliminated: boolean;
}

export interface PersonalityRoomState {
  id: string;
  code: string;
  phase: PersonalityPhase;
  hostPlayerId: string;
  pickerId: string;
  /** Hidden from guessers during questioning; revealed to all at game_over */
  character: string | null;
  /** Always visible to all players once picker sets it — gives guessers a silhouette hint */
  characterGender: "male" | "female" | null;
  players: PersonalityPlayerInfo[];
  questions: PersonalityQuestion[];
  guesses: PersonalityGuessRecord[];
  winnerId: string | null;
  winnerNickname: string | null;
  pickerWon: boolean;
  createdAt: string;
}

export interface PersonalitySnapshot {
  room: PersonalityRoomState;
  me: {
    playerId: string | null;
    nickname: string | null;
  };
}

export interface CreatePersonalityRoomResponse {
  room: PersonalitySnapshot;
  playerId: string;
  sessionToken: string;
}

export interface JoinPersonalityRoomResponse {
  room: PersonalitySnapshot;
  playerId: string;
  sessionToken: string;
}
