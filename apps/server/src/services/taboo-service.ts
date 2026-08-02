import { createId, createRoomCode, createSessionToken } from "@categories-game/shared";
import type {
  TabooPhase,
  TabooHint,
  TabooGuess,
  TabooWordRecord,
  TabooTurn,
  TabooPlayerInfo,
  TabooSettings,
  TabooRoomState,
  TabooSnapshot,
} from "@categories-game/shared";
import { generateTabooWords, type TabooCard } from "./taboo-words.js";

// ─── Stored types ─────────────────────────────────────────────────────────────

interface StoredTabooPlayer {
  id: string;
  nickname: string;
  sessionToken: string;
  isHost: boolean;
  isOnline: boolean;
  score: number;
}

interface StoredTabooRoom {
  id: string;
  code: string;
  phase: TabooPhase;
  hostPlayerId: string;
  settings: TabooSettings;
  players: StoredTabooPlayer[];
  turns: TabooTurn[];
  currentTurn: Omit<TabooTurn, "words"> | null;
  currentWord: string | null;
  forbiddenWords: string[] | null;
  pendingWords: TabooCard[];   // queue for current turn (not sent to client)
  currentWordIndex: number;
  roundNumber: number;
  wordTimeLeft: number | null;
  currentHints: TabooHint[];
  currentGuesses: TabooGuess[];
  explainerOrder: string[];
  currentExplainerIndex: number;
  wordTimer: ReturnType<typeof setInterval> | null;
  createdAt: string;
}

// ─── Events ───────────────────────────────────────────────────────────────────

interface TabooEvents {
  onState?: (roomCode: string) => void;
}

// ─── Hebrew morphological matching ────────────────────────────────────────────

/** Normalize: lowercase, strip nikud, normalize final (sofit) letters */
function normalizeHebrew(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\u05b0-\u05c7]/g, "") // strip nikud diacritics
    .replace(/ך/g, "כ")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ף/g, "פ")
    .replace(/ץ/g, "צ")
    .replace(/\s+/g, " ");
}

/** Strip common Hebrew suffixes to get a rough stem */
function hebrewStem(word: string): string {
  let w = normalizeHebrew(word).replace(/\s/g, "");
  const suffixes = ["יות", "יים", "ות", "ים", "ית", "יה", "תי", "תמ", "תנ", "נו", "כמ", "המ", "הנ", "ה", "ת", "י", "ו"];
  for (const sfx of suffixes) {
    if (w.endsWith(sfx) && w.length - sfx.length >= 2) {
      w = w.slice(0, w.length - sfx.length);
      break;
    }
  }
  return w;
}

/** Strip internal וי that are likely vowels (surrounded by consonants) */
function consonantSkeleton(word: string): string {
  return hebrewStem(word).replace(/(?<=[א-ת])[וי](?=[א-ת])/g, "");
}

/** Are two Hebrew words morphologically related (same root)? */
function morphologicallyRelated(a: string, b: string): boolean {
  const stemA = hebrewStem(a);
  const stemB = hebrewStem(b);

  // Exact stem match
  if (stemA === stemB) return true;

  // Consonant skeleton match — handles vowel alternation (זרימה / זורם → זרמ)
  const skelA = consonantSkeleton(a);
  const skelB = consonantSkeleton(b);
  if (skelA.length >= 2 && skelA === skelB) return true;

  // One stem contains the other — handles compound/prefix variations
  const minLen = 3;
  if (stemA.length >= minLen && stemB.includes(stemA)) return true;
  if (stemB.length >= minLen && stemA.includes(stemB)) return true;

  return false;
}

/** Check if any word in the hint is morphologically related to a forbidden word */
function containsForbidden(hint: string, forbidden: string[]): boolean {
  const hintWords = normalizeHebrew(hint).split(" ").filter(Boolean);
  return forbidden.some((f) =>
    hintWords.some((hw) => morphologicallyRelated(hw, f)),
  );
}

/** Check if a guess matches the target word (morphologically) */
function guessMatchesWord(guess: string, target: string): boolean {
  // First try exact normalized match
  if (normalizeHebrew(guess) === normalizeHebrew(target)) return true;
  // Then try morphological match
  return morphologicallyRelated(guess, target);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class TabooService {
  private readonly rooms = new Map<string, StoredTabooRoom>();

  constructor(
    private readonly events: TabooEvents = {},
    private readonly aiApiKey: string = "",
    private readonly aiModel: string = "gpt-4o-mini",
  ) {}

  // ── Room lifecycle ──────────────────────────────────────────────────────────

  createRoom(nickname: string) {
    const nick = nickname.trim();
    this.validateNickname(nick);

    const player = this.makePlayer(nick, true);
    const room: StoredTabooRoom = {
      id: createId("troom"),
      code: this.uniqueCode(),
      phase: "lobby",
      hostPlayerId: player.id,
      settings: { rounds: 2, wordsPerTurn: 5, secondsPerWord: 60 },
      players: [player],
      turns: [],
      currentTurn: null,
      currentWord: null,
      forbiddenWords: null,
      pendingWords: [],
      currentWordIndex: 0,
      roundNumber: 1,
      wordTimeLeft: null,
      currentHints: [],
      currentGuesses: [],
      explainerOrder: [player.id],
      currentExplainerIndex: 0,
      wordTimer: null,
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
    if (room.players.find((p) => p.nickname === nick)) throw new Error("שם השחקן כבר תפוס");

    const player = this.makePlayer(nick, false);
    room.players.push(player);
    room.explainerOrder.push(player.id);
    this.emit(room.code);
    return { room: this.snap(room, player.id), sessionToken: player.sessionToken, playerId: player.id };
  }

  updateSettings(roomCode: string, playerId: string, settings: Partial<{ rounds: number; wordsPerTurn: number; secondsPerWord: number }>) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "lobby") throw new Error("לא ניתן לשנות הגדרות אחרי תחילת המשחק");

    if (settings.rounds !== undefined) {
      room.settings.rounds = Math.min(3, Math.max(1, settings.rounds));
    }
    if (settings.wordsPerTurn !== undefined) {
      room.settings.wordsPerTurn = Math.min(7, Math.max(3, settings.wordsPerTurn));
    }
    if (settings.secondsPerWord !== undefined) {
      const allowed = [30, 60, 90];
      if (allowed.includes(settings.secondsPerWord)) room.settings.secondsPerWord = settings.secondsPerWord;
    }
    this.emit(room.code);
    return this.snap(room, playerId);
  }

  async startGame(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "lobby") throw new Error("המשחק כבר רץ");
    if (room.players.length < 2) throw new Error("דרוש לפחות 2 שחקנים");

    room.phase = "playing";
    room.roundNumber = 1;
    room.currentExplainerIndex = 0;
    this.emit(room.code);

    await this.startTurn(room);
  }

  // ── In-game actions ─────────────────────────────────────────────────────────

  sendHint(roomCode: string, playerId: string, text: string) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "playing") throw new Error("המשחק לא פעיל");

    const currentExplainerId = room.explainerOrder[room.currentExplainerIndex];
    if (playerId !== currentExplainerId) throw new Error("רק המסביר יכול לשלוח רמזים");
    if (!room.currentWord) throw new Error("אין מילה פעילה");

    const t = text.trim();
    if (!t) throw new Error("הכנס רמז");

    const isViolation = containsForbidden(t, room.forbiddenWords ?? []);

    const hint: TabooHint = {
      id: createId("th"),
      text: t,
      isViolation,
      timestamp: new Date().toISOString(),
    };
    room.currentHints.push(hint);
    this.emit(room.code);

    if (isViolation) {
      // Small delay so clients can see the violation before word resolves
      setTimeout(() => {
        this.resolveWord(room, "violated");
      }, 1500);
    }
  }

  makeGuess(roomCode: string, playerId: string, text: string) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "playing") throw new Error("המשחק לא פעיל");

    const currentExplainerId = room.explainerOrder[room.currentExplainerIndex];
    if (playerId === currentExplainerId) throw new Error("המסביר לא יכול לנחש");
    if (!room.currentWord) throw new Error("אין מילה פעילה");

    const t = text.trim();
    if (!t) throw new Error("הכנס ניחוש");

    const player = this.getPlayer(room, playerId);
    const correct = guessMatchesWord(t, room.currentWord);

    const guess: TabooGuess = {
      id: createId("tg"),
      guesserId: playerId,
      guesserNickname: player.nickname,
      text: t,
      correct,
      timestamp: new Date().toISOString(),
    };
    room.currentGuesses.push(guess);
    this.emit(room.code);

    if (correct) {
      // Award points
      player.score += 1;
      const explainer = room.players.find((p) => p.id === currentExplainerId);
      if (explainer) explainer.score += 1;
      if (room.currentTurn) room.currentTurn.points += 1;

      setTimeout(() => {
        this.resolveWord(room, "correct", { resolvedBy: playerId, resolvedByNickname: player.nickname });
      }, 800);
    }
  }

  skipWord(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "playing") throw new Error("המשחק לא פעיל");

    const currentExplainerId = room.explainerOrder[room.currentExplainerIndex];
    if (playerId !== currentExplainerId) throw new Error("רק המסביר יכול לדלג");
    if (!room.currentWord) throw new Error("אין מילה פעילה");

    this.resolveWord(room, "skipped");
  }

  resetRoom(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "game_over") throw new Error("ניתן לאפס רק לאחר סיום המשחק");

    this.clearTimer(room);
    room.phase = "lobby";
    room.turns = [];
    room.currentTurn = null;
    room.currentWord = null;
    room.forbiddenWords = null;
    room.pendingWords = [];
    room.currentWordIndex = 0;
    room.roundNumber = 1;
    room.wordTimeLeft = null;
    room.currentHints = [];
    room.currentGuesses = [];
    room.currentExplainerIndex = 0;
    for (const p of room.players) p.score = 0;

    this.emit(room.code);
    return this.snap(room, playerId);
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  getRoomState(roomCode: string, playerId?: string | null): TabooSnapshot {
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

  // ── Private: turn/word management ──────────────────────────────────────────

  private async startTurn(room: StoredTabooRoom) {
    const explainerId = room.explainerOrder[room.currentExplainerIndex];
    const explainer = room.players.find((p) => p.id === explainerId);
    if (!explainer) return;

    room.currentTurn = {
      id: createId("tt"),
      explainerId,
      explainerNickname: explainer.nickname,
      roundNumber: room.roundNumber,
      points: 0,
    };
    room.currentWord = null;
    room.forbiddenWords = null;
    room.currentWordIndex = 0;
    room.currentHints = [];
    room.currentGuesses = [];
    room.wordTimeLeft = null;

    this.emit(room.code);

    // Generate words for this turn
    try {
      room.pendingWords = await generateTabooWords(room.settings.wordsPerTurn, this.aiApiKey, this.aiModel);
    } catch {
      room.pendingWords = [];
    }

    this.startNextWord(room);
  }

  private startNextWord(room: StoredTabooRoom) {
    this.clearTimer(room);

    const card = room.pendingWords.shift();
    if (!card || room.currentWordIndex >= room.settings.wordsPerTurn) {
      this.endTurn(room);
      return;
    }

    room.currentWord = card.word;
    room.forbiddenWords = card.forbiddenWords;
    room.currentHints = [];
    room.currentGuesses = [];
    room.wordTimeLeft = room.settings.secondsPerWord;

    this.emit(room.code);
    this.startTimer(room);
  }

  private startTimer(room: StoredTabooRoom) {
    this.clearTimer(room);
    room.wordTimer = setInterval(() => {
      if (room.wordTimeLeft === null) return;
      room.wordTimeLeft -= 1;
      this.emit(room.code);

      if (room.wordTimeLeft <= 0) {
        this.resolveWord(room, "timedOut");
      }
    }, 1000);
  }

  private resolveWord(
    room: StoredTabooRoom,
    reason: "correct" | "skipped" | "violated" | "timedOut",
    extra?: { resolvedBy: string; resolvedByNickname: string },
  ) {
    this.clearTimer(room);

    if (!room.currentWord) return;

    const record: TabooWordRecord = {
      id: createId("tw"),
      word: room.currentWord,
      forbiddenWords: room.forbiddenWords ?? [],
      hints: [...room.currentHints],
      guesses: [...room.currentGuesses],
      resolvedBy: extra?.resolvedBy ?? null,
      resolvedByNickname: extra?.resolvedByNickname ?? null,
      skipped: reason === "skipped",
      violated: reason === "violated",
      timedOut: reason === "timedOut",
    };

    // Append to completed turns list
    const turnRecord = room.turns.find((t) => t.id === room.currentTurn?.id);
    if (turnRecord) {
      turnRecord.words.push(record);
      if (room.currentTurn) turnRecord.points = room.currentTurn.points;
    } else if (room.currentTurn) {
      room.turns.push({ ...room.currentTurn, words: [record] });
    }

    room.currentWordIndex += 1;
    room.currentWord = null;
    room.forbiddenWords = null;
    room.currentHints = [];
    room.currentGuesses = [];
    room.wordTimeLeft = null;

    this.emit(room.code);

    // Advance to next word or end turn
    setTimeout(() => {
      if (room.currentWordIndex >= room.settings.wordsPerTurn || room.pendingWords.length === 0) {
        this.endTurn(room);
      } else {
        this.startNextWord(room);
      }
    }, 2000); // show resolution for 2s before next word
  }

  private endTurn(room: StoredTabooRoom) {
    this.clearTimer(room);
    room.currentWord = null;
    room.forbiddenWords = null;
    room.wordTimeLeft = null;
    room.currentTurn = null;

    const totalTurns = room.settings.rounds * room.explainerOrder.length;
    const completedTurns = room.turns.length;

    if (completedTurns >= totalTurns) {
      room.phase = "game_over";
      this.emit(room.code);
      return;
    }

    // Advance to next explainer
    room.currentExplainerIndex = (room.currentExplainerIndex + 1) % room.explainerOrder.length;
    if (room.currentExplainerIndex === 0) {
      room.roundNumber += 1;
    }

    this.emit(room.code);

    setTimeout(() => {
      void this.startTurn(room);
    }, 3000); // 3s between turns
  }

  private clearTimer(room: StoredTabooRoom) {
    if (room.wordTimer !== null) {
      clearInterval(room.wordTimer);
      room.wordTimer = null;
    }
  }

  // ── Private: snapshot ───────────────────────────────────────────────────────

  private snap(room: StoredTabooRoom, playerId: string | null): TabooSnapshot {
    const currentExplainerId = room.explainerOrder[room.currentExplainerIndex] ?? null;
    const isExplainer = playerId !== null && playerId === currentExplainerId;
    const reveal = isExplainer || room.phase === "game_over";

    const state: TabooRoomState = {
      id: room.id,
      code: room.code,
      phase: room.phase,
      hostPlayerId: room.hostPlayerId,
      settings: room.settings,
      players: room.players.map((p): TabooPlayerInfo => ({
        id: p.id,
        nickname: p.nickname,
        isHost: p.isHost,
        isOnline: p.isOnline,
        score: p.score,
      })),
      turns: room.turns,
      currentTurn: room.currentTurn,
      currentWord: reveal ? room.currentWord : null,
      forbiddenWords: reveal ? room.forbiddenWords : null,
      currentWordIndex: room.currentWordIndex,
      roundNumber: room.roundNumber,
      wordTimeLeft: room.wordTimeLeft,
      currentHints: room.currentHints,
      currentGuesses: room.currentGuesses,
      explainerOrder: room.explainerOrder,
      currentExplainerIndex: room.currentExplainerIndex,
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

  // ── Private: helpers ────────────────────────────────────────────────────────

  private getRoom(roomCode: string): StoredTabooRoom {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new Error("החדר לא נמצא");
    return room;
  }

  private getPlayer(room: StoredTabooRoom, playerId: string): StoredTabooPlayer {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new Error("השחקן לא נמצא");
    return player;
  }

  private assertHost(room: StoredTabooRoom, playerId: string) {
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

  private makePlayer(nickname: string, isHost: boolean): StoredTabooPlayer {
    return {
      id: createId("tp"),
      nickname,
      sessionToken: createSessionToken(),
      isHost,
      isOnline: true,
      score: 0,
    };
  }

  private validateNickname(nick: string) {
    if (!nick || nick.length < 2) throw new Error("שם שחקן קצר מדי — לפחות 2 תווים");
    if (nick.length > 20) throw new Error("שם שחקן ארוך מדי — עד 20 תווים");
  }
}
