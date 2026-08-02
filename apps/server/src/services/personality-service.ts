import { createId, createRoomCode, createSessionToken } from "@categories-game/shared";
import type {
  PersonalityPhase,
  PersonalityQuestion,
  PersonalityGuessRecord,
  PersonalityPlayerInfo,
  PersonalityRoomState,
  PersonalitySnapshot,
  QuestionAnswer,
} from "@categories-game/shared";

const MAX_GUESSES = 3;

interface StoredPersonalityPlayer {
  id: string;
  nickname: string;
  sessionToken: string;
  isHost: boolean;
  isPicker: boolean;
  isOnline: boolean;
  guessesLeft: number;
  isEliminated: boolean;
}

interface StoredPersonalityRoom {
  id: string;
  code: string;
  phase: PersonalityPhase;
  hostPlayerId: string;
  pickerId: string;
  character: string | null;
  characterGender: "male" | "female" | null;
  players: StoredPersonalityPlayer[];
  questions: PersonalityQuestion[];
  guesses: PersonalityGuessRecord[];
  winnerId: string | null;
  winnerNickname: string | null;
  pickerWon: boolean;
  createdAt: string;
}

interface PersonalityEvents {
  /** Called whenever room state changes; caller should emit personalized snapshots. */
  onState?: (roomCode: string) => void;
}

export class PersonalityService {
  private readonly rooms = new Map<string, StoredPersonalityRoom>();

  constructor(private readonly events: PersonalityEvents = {}) {}

  createRoom(nickname: string) {
    const nick = nickname.trim();
    this.validateNickname(nick);

    const player = this.makePlayer(nick, true, true);
    const room: StoredPersonalityRoom = {
      id: createId("proom"),
      code: this.uniqueCode(),
      phase: "lobby",
      hostPlayerId: player.id,
      pickerId: player.id,
      character: null,
      characterGender: null,
      players: [player],
      questions: [],
      guesses: [],
      winnerId: null,
      winnerNickname: null,
      pickerWon: false,
      createdAt: new Date().toISOString(),
    };

    this.rooms.set(room.code, room);
    return { room: this.snap(room, player.id), sessionToken: player.sessionToken, playerId: player.id };
  }

  joinRoom(roomCode: string, nickname: string) {
    const nick = nickname.trim();
    this.validateNickname(nick);

    const room = this.getRoom(roomCode);
    if (room.phase !== "lobby") throw new Error("המשחק כבר התחיל");
    if (room.players.find((p) => p.nickname === nick)) throw new Error("שם השחקן כבר תפוס בחדר");

    const player = this.makePlayer(nick, false, false);
    room.players.push(player);
    this.emit(room.code);
    return { room: this.snap(room, player.id), sessionToken: player.sessionToken, playerId: player.id };
  }

  startRoom(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "lobby") throw new Error("לא ניתן להתחיל משחק בשלב הנוכחי");

    room.phase = "character_selection";
    this.emit(room.code);
    return this.snap(room, playerId);
  }

  setPicker(roomCode: string, hostId: string, pickerId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, hostId);
    if (room.phase !== "lobby") throw new Error("ניתן לשנות מנחה רק בלובי");
    if (!room.players.find((p) => p.id === pickerId)) throw new Error("שחקן לא נמצא");

    for (const p of room.players) p.isPicker = p.id === pickerId;
    room.pickerId = pickerId;
    this.emit(room.code);
    return this.snap(room, hostId);
  }

  setCharacter(roomCode: string, playerId: string, character: string, gender?: "male" | "female") {
    const room = this.getRoom(roomCode);
    if (room.phase !== "character_selection") throw new Error("לא ניתן לבחור דמות עכשיו");
    if (room.pickerId !== playerId) throw new Error("רק המנחה יכול לבחור דמות");

    const char = character.trim();
    if (!char) throw new Error("הכנס שם דמות");

    room.character = char;
    room.characterGender = gender ?? null;
    room.phase = "questioning";
    this.emit(room.code);
    return this.snap(room, playerId);
  }

  askQuestion(roomCode: string, playerId: string, question: string) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "questioning") throw new Error("לא ניתן לשאול שאלה עכשיו");
    if (room.pickerId === playerId) throw new Error("המנחה לא יכול לשאול שאלות");

    const player = this.getPlayer(room, playerId);
    if (player.isEliminated) throw new Error("שחקן שנפסל לא יכול לשאול");

    const q = question.trim();
    if (!q) throw new Error("הכנס שאלה");

    const entry: PersonalityQuestion = {
      id: createId("pq"),
      askerId: playerId,
      askerNickname: player.nickname,
      question: q,
      answer: null,
      askedAt: new Date().toISOString(),
      answeredAt: null,
    };
    room.questions.push(entry);
    this.emit(room.code);
  }

  answerQuestion(roomCode: string, playerId: string, questionId: string, answer: QuestionAnswer) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "questioning") throw new Error("לא ניתן לענות עכשיו");
    if (room.pickerId !== playerId) throw new Error("רק המנחה יכול לענות");

    const q = room.questions.find((item) => item.id === questionId);
    if (!q) throw new Error("שאלה לא נמצאה");
    if (q.answer !== null) throw new Error("השאלה כבר נענתה");

    q.answer = answer;
    q.answeredAt = new Date().toISOString();
    this.emit(room.code);
  }

  makeGuess(roomCode: string, playerId: string, guess: string) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "questioning") throw new Error("לא ניתן לנחש עכשיו");
    if (room.pickerId === playerId) throw new Error("המנחה לא יכול לנחש");

    const player = this.getPlayer(room, playerId);
    if (player.isEliminated) throw new Error("שחקן שנפסל לא יכול לנחש");
    if (player.guessesLeft <= 0) throw new Error("אין ניחושים נותרים");

    const guessText = guess.trim();
    if (!guessText) throw new Error("הכנס ניחוש");

    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const correct = norm(guessText) === norm(room.character ?? "");

    const record: PersonalityGuessRecord = {
      id: createId("pg"),
      guesserId: playerId,
      guesserNickname: player.nickname,
      guess: guessText,
      correct,
      timestamp: new Date().toISOString(),
    };

    room.guesses.push(record);
    player.guessesLeft -= 1;

    if (correct) {
      room.winnerId = playerId;
      room.winnerNickname = player.nickname;
      room.pickerWon = false;
      room.phase = "game_over";
    } else if (player.guessesLeft <= 0) {
      player.isEliminated = true;
      const guessers = room.players.filter((p) => p.id !== room.pickerId);
      if (guessers.length > 0 && guessers.every((p) => p.isEliminated)) {
        room.pickerWon = true;
        const picker = room.players.find((p) => p.id === room.pickerId);
        room.winnerId = room.pickerId;
        room.winnerNickname = picker?.nickname ?? null;
        room.phase = "game_over";
      }
    }

    this.emit(room.code);
  }

  resetRoom(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "game_over") throw new Error("ניתן לאפס רק לאחר סיום המשחק");

    room.phase = "lobby";
    room.character = null;
    room.characterGender = null;
    room.questions = [];
    room.guesses = [];
    room.winnerId = null;
    room.winnerNickname = null;
    room.pickerWon = false;

    for (const p of room.players) {
      p.isPicker = p.id === room.hostPlayerId;
      p.guessesLeft = MAX_GUESSES;
      p.isEliminated = false;
    }
    room.pickerId = room.hostPlayerId;

    this.emit(room.code);
    return this.snap(room, playerId);
  }

  getRoomState(roomCode: string, playerId?: string | null): PersonalitySnapshot {
    const room = this.getRoom(roomCode);
    return this.snap(room, playerId ?? null);
  }

  findPlayerBySession(roomCode: string, sessionToken: string) {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return null;
    return room.players.find((p) => p.sessionToken === sessionToken) ?? null;
  }

  setOnlineStatus(roomCode: string, playerId: string, isOnline: boolean) {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return;
    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      player.isOnline = isOnline;
      this.emit(room.code);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private snap(room: StoredPersonalityRoom, playerId: string | null): PersonalitySnapshot {
    const isPicker = playerId === room.pickerId;
    const reveal = room.phase === "game_over" || isPicker;

    const state: PersonalityRoomState = {
      id: room.id,
      code: room.code,
      phase: room.phase,
      hostPlayerId: room.hostPlayerId,
      pickerId: room.pickerId,
      character: reveal ? room.character : null,
      characterGender: room.characterGender, // always visible — gives guessers a silhouette hint
      players: room.players.map((p): PersonalityPlayerInfo => ({
        id: p.id,
        nickname: p.nickname,
        isHost: p.isHost,
        isPicker: p.isPicker,
        isOnline: p.isOnline,
        guessesLeft: p.guessesLeft,
        isEliminated: p.isEliminated,
      })),
      questions: room.questions,
      guesses: room.guesses,
      winnerId: room.winnerId,
      winnerNickname: room.winnerNickname,
      pickerWon: room.pickerWon,
      createdAt: room.createdAt,
    };

    return {
      room: state,
      me: {
        playerId,
        nickname: playerId ? (room.players.find((p) => p.id === playerId)?.nickname ?? null) : null,
      },
    };
  }

  private getRoom(roomCode: string): StoredPersonalityRoom {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new Error("החדר לא נמצא");
    return room;
  }

  private getPlayer(room: StoredPersonalityRoom, playerId: string): StoredPersonalityPlayer {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new Error("השחקן לא נמצא");
    return player;
  }

  private assertHost(room: StoredPersonalityRoom, playerId: string) {
    if (room.hostPlayerId !== playerId) throw new Error("רק מנהל החדר יכול לבצע פעולה זו");
  }

  private emit(roomCode: string) {
    this.events.onState?.(roomCode);
  }

  private uniqueCode(): string {
    let code = createRoomCode();
    while (this.rooms.has(code)) code = createRoomCode();
    return code;
  }

  private makePlayer(nickname: string, isHost: boolean, isPicker: boolean): StoredPersonalityPlayer {
    return {
      id: createId("pp"),
      nickname,
      sessionToken: createSessionToken(),
      isHost,
      isPicker,
      isOnline: true,
      guessesLeft: MAX_GUESSES,
      isEliminated: false,
    };
  }

  private validateNickname(nick: string) {
    if (!nick || nick.length < 2) throw new Error("שם שחקן קצר מדי — לפחות 2 תווים");
    if (nick.length > 20) throw new Error("שם שחקן ארוך מדי — עד 20 תווים");
  }
}
