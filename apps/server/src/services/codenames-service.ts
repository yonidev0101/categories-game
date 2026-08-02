import { createId, createRoomCode, createSessionToken } from "@categories-game/shared";
import type {
  CodenamesPhase,
  CodenamesTeam,
  CodenamesRole,
  CardColor,
  TurnPhase,
  CodenamesClue,
  CodenamesTurn,
  CodenamesPlayer,
  CodenamesSettings,
  CodenamesCard,
  CodenamesCardView,
  CodenamesClueHistoryEntry,
  CodenamesSnapshot,
} from "@categories-game/shared";

// ─── Fallback word bank ────────────────────────────────────────────────────────

const FALLBACK_WORDS = [
  "ים", "הר", "ענן", "שמש", "ירח", "נמר", "פרפר", "מטוס", "ספר", "מלך",
  "כסף", "אש", "זמן", "דלת", "חלל", "שוק", "גשר", "ארנב", "עיפרון", "תפוז",
  "צבא", "מסיבה", "רכב", "נהר", "כלב", "חתול", "דגים", "עץ", "אבן", "ספינה",
  "טיל", "מנגינה", "בלון", "מפתח", "שלג", "פרח", "זמר", "שף", "נחש", "כוכב",
  "ריקוד", "כובע", "גשם", "עיר", "לב", "פנס", "סוס", "בנק", "מנורה", "מחשב",
  "קסם", "ענבים", "אוצר", "צמח", "שועל", "דרקון", "מגדל", "מגן", "רוח", "פיל",
  "ציפור", "מדינה", "קרח", "ממלכה", "שמיים", "גבעה", "אדם", "חלום", "ממתק", "גלידה",
  "חידה", "חנות", "נמל", "אריה", "דגל", "מסעדה", "רופא", "גן", "כוס", "מצלמה",
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Internal stored types ────────────────────────────────────────────────────

interface StoredCodenamesPlayer {
  id:           string;
  nickname:     string;
  sessionToken: string;
  isOnline:     boolean;
  team:         CodenamesTeam | null;
  role:         CodenamesRole | null;
}

interface StoredTurn {
  team:                  CodenamesTeam;
  phase:                 TurnPhase;
  clue:                  CodenamesClue | null;
  guessesRemaining:      number;
  turnEndsAt:            string | null;
  cardsRevealedThisTurn: number;
}

interface StoredCodenamesRoom {
  id:           string;
  code:         string;
  hostPlayerId: string;
  phase:        CodenamesPhase;
  players:      StoredCodenamesPlayer[];
  cards:        CodenamesCard[];
  currentTurn:  StoredTurn | null;
  winner:       CodenamesTeam | null;
  winReason:    "all_found" | "assassin" | null;
  firstTeam:    CodenamesTeam | null;
  redTotal:     number;
  blueTotal:    number;
  clueHistory:  CodenamesClueHistoryEntry[];
  settings:     CodenamesSettings;
  turnTimer:    ReturnType<typeof setTimeout> | null;
  createdAt:    string;
}

interface CodenamesEvents {
  onState?: (roomCode: string) => void;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class CodenamesService {
  private readonly rooms = new Map<string, StoredCodenamesRoom>();

  constructor(
    private readonly events: CodenamesEvents = {},
    private readonly aiApiKey: string = "",
    private readonly aiModel: string = "gpt-4o-mini",
  ) {}

  // ── Room lifecycle ───────────────────────────────────────────────────────────

  createRoom(nickname: string) {
    const nick = nickname.trim();
    this.validateNickname(nick);

    const player = this.makePlayer(nick);
    const room: StoredCodenamesRoom = {
      id:           createId("cnroom"),
      code:         this.uniqueCode(),
      hostPlayerId: player.id,
      phase:        "lobby",
      players:      [player],
      cards:        [],
      currentTurn:  null,
      winner:       null,
      winReason:    null,
      firstTeam:    null,
      redTotal:     0,
      blueTotal:    0,
      clueHistory:  [],
      settings:     { timerEnabled: false, timerSeconds: 120 },
      turnTimer:    null,
      createdAt:    new Date().toISOString(),
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

    const player = this.makePlayer(nick);
    room.players.push(player);
    this.emit(room.code);
    return { room: this.snap(room, player.id), sessionToken: player.sessionToken, playerId: player.id };
  }

  // ── Lobby actions ────────────────────────────────────────────────────────────

  selectTeam(roomCode: string, playerId: string, team: CodenamesTeam) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "lobby") throw new Error("לא ניתן לשנות צוות אחרי תחילת המשחק");

    const player = this.getPlayer(room, playerId);
    player.team = team;
    player.role = null; // reset role when changing team
    this.emit(room.code);
  }

  selectRole(roomCode: string, playerId: string, role: CodenamesRole) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "lobby") throw new Error("לא ניתן לשנות תפקיד אחרי תחילת המשחק");

    const player = this.getPlayer(room, playerId);
    if (!player.team) throw new Error("הצטרף לצוות תחילה");

    if (role === "spymaster") {
      const existingSpymaster = room.players.find(
        (p) => p.id !== playerId && p.team === player.team && p.role === "spymaster",
      );
      if (existingSpymaster) throw new Error("יש כבר מרגל ראשי בצוות הזה");
    }

    player.role = role;
    this.emit(room.code);
  }

  async startGame(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "lobby") throw new Error("המשחק כבר רץ");

    const redPlayers  = room.players.filter((p) => p.team === "red");
    const bluePlayers = room.players.filter((p) => p.team === "blue");
    if (redPlayers.length === 0)  throw new Error("הצוות האדום חסר שחקנים");
    if (bluePlayers.length === 0) throw new Error("הצוות הכחול חסר שחקנים");
    if (!redPlayers.find((p) => p.role === "spymaster"))  throw new Error("הצוות האדום חסר מרגל ראשי");
    if (!bluePlayers.find((p) => p.role === "spymaster")) throw new Error("הצוות הכחול חסר מרגל ראשי");

    // Mark players without a role as operatives
    for (const p of room.players) {
      if (p.team && !p.role) p.role = "operative";
    }

    room.phase = "generating";
    this.emit(room.code);

    const words = await this.generateWords();

    // Determine first team (random) — first team gets 9 cards
    const firstTeam: CodenamesTeam  = Math.random() < 0.5 ? "red" : "blue";
    const secondTeam: CodenamesTeam = firstTeam === "red" ? "blue" : "red";

    room.firstTeam = firstTeam;
    room.redTotal  = firstTeam === "red" ? 9 : 8;
    room.blueTotal = firstTeam === "blue" ? 9 : 8;

    // Build shuffled color assignment: 9 first, 8 second, 7 neutral, 1 assassin
    const colorList: CardColor[] = [
      ...Array(9).fill(firstTeam)  as CardColor[],
      ...Array(8).fill(secondTeam) as CardColor[],
      ...Array(7).fill("neutral")  as CardColor[],
      "assassin",
    ];
    const shuffledColors = shuffle(colorList);

    room.cards = words.map((word, idx) => ({
      id:       idx,
      word,
      color:    shuffledColors[idx],
      revealed: false,
    }));

    room.clueHistory = [];
    room.winner      = null;
    room.winReason   = null;

    room.phase       = "in_progress";
    room.currentTurn = {
      team:                  firstTeam,
      phase:                 "giving_clue",
      clue:                  null,
      guessesRemaining:      0,
      turnEndsAt:            null,
      cardsRevealedThisTurn: 0,
    };

    this.emit(room.code);
  }

  // ── In-game actions ──────────────────────────────────────────────────────────

  giveClue(roomCode: string, playerId: string, clueWord: string, clueNumber: number) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "in_progress") throw new Error("המשחק לא פעיל");

    const turn   = this.requireTurn(room);
    if (turn.phase !== "giving_clue") throw new Error("זו לא פאזת הרמז");

    const player = this.getPlayer(room, playerId);
    if (player.team !== turn.team || player.role !== "spymaster") {
      throw new Error("רק המרגל הראשי של הצוות הפעיל יכול לתת רמז");
    }

    const word = clueWord.trim();
    if (!word) throw new Error("הכנס מילה לרמז");
    if (clueNumber < 1 || clueNumber > 9) throw new Error("המספר חייב להיות בין 1 ל-9");

    // Clue word cannot match any unrevealed card on the board
    const conflict = room.cards.find(
      (c) => !c.revealed && c.word.toLowerCase() === word.toLowerCase(),
    );
    if (conflict) throw new Error("מילת הרמז לא יכולה להיות על הלוח");

    turn.clue                  = { word, number: clueNumber };
    turn.phase                 = "guessing";
    turn.guessesRemaining      = clueNumber + 1;
    turn.cardsRevealedThisTurn = 0;

    if (room.settings.timerEnabled) {
      const endsAt   = new Date(Date.now() + room.settings.timerSeconds * 1000);
      turn.turnEndsAt = endsAt.toISOString();

      this.clearTimer(room);
      room.turnTimer = setTimeout(() => {
        if (room.phase === "in_progress" && room.currentTurn?.phase === "guessing") {
          this.advanceTurn(room);
        }
      }, room.settings.timerSeconds * 1000);
    }

    this.emit(room.code);
  }

  guessCard(roomCode: string, playerId: string, cardId: number) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "in_progress") throw new Error("המשחק לא פעיל");

    const turn   = this.requireTurn(room);
    if (turn.phase !== "guessing") throw new Error("זו לא פאזת הניחוש");

    const player = this.getPlayer(room, playerId);
    if (player.team !== turn.team)     throw new Error("לא התורך לנחש");
    if (player.role === "spymaster")   throw new Error("המרגל הראשי לא יכול לנחש");

    const card = room.cards.find((c) => c.id === cardId);
    if (!card)          throw new Error("הקלף לא נמצא");
    if (card.revealed)  throw new Error("הקלף כבר גולה");

    card.revealed   = true;
    card.revealedBy = turn.team;

    // ── Assassin: instant loss ─────────────────────────────────────────────────
    if (card.color === "assassin") {
      this.clearTimer(room);
      room.phase       = "game_over";
      room.winner      = turn.team === "red" ? "blue" : "red";
      room.winReason   = "assassin";
      this.finalizeTurnHistory(room, turn);
      room.currentTurn = null;
      this.emit(room.code);
      return;
    }

    // ── Correct team card ──────────────────────────────────────────────────────
    if (card.color === turn.team) {
      turn.cardsRevealedThisTurn += 1;
      turn.guessesRemaining      -= 1;

      const teamCardsLeft = room.cards.filter((c) => c.color === turn.team && !c.revealed).length;
      if (teamCardsLeft === 0) {
        this.clearTimer(room);
        room.phase       = "game_over";
        room.winner      = turn.team;
        room.winReason   = "all_found";
        this.finalizeTurnHistory(room, turn);
        room.currentTurn = null;
        this.emit(room.code);
        return;
      }

      if (turn.guessesRemaining <= 0) {
        this.advanceTurn(room);
        return;
      }

      this.emit(room.code);
      return;
    }

    // ── Opponent card: reveal (opponent benefits), end turn ────────────────────
    if (card.color !== "neutral") {
      const opponentTeam: CodenamesTeam     = turn.team === "red" ? "blue" : "red";
      const opponentCardsLeft = room.cards.filter((c) => c.color === opponentTeam && !c.revealed).length;

      if (opponentCardsLeft === 0) {
        this.clearTimer(room);
        room.phase       = "game_over";
        room.winner      = opponentTeam;
        room.winReason   = "all_found";
        this.finalizeTurnHistory(room, turn);
        room.currentTurn = null;
        this.emit(room.code);
        return;
      }
    }

    // Neutral or opponent card: end turn
    this.advanceTurn(room);
  }

  endTurn(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "in_progress") throw new Error("המשחק לא פעיל");

    const turn   = this.requireTurn(room);
    if (turn.phase !== "guessing") throw new Error("אפשר לסיים תור רק בפאזת הניחוש");

    const player = this.getPlayer(room, playerId);
    if (player.team !== turn.team)   throw new Error("לא התורך");
    if (player.role === "spymaster") throw new Error("המרגל הראשי לא יכול לסיים תור");

    this.advanceTurn(room);
  }

  updateSettings(roomCode: string, playerId: string, settings: Partial<CodenamesSettings>) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "lobby") throw new Error("לא ניתן לשנות הגדרות אחרי תחילת המשחק");

    if (settings.timerEnabled !== undefined) room.settings.timerEnabled = settings.timerEnabled;
    if (settings.timerSeconds !== undefined) {
      const allowed = [30, 60, 90, 120, 180];
      if (allowed.includes(settings.timerSeconds)) room.settings.timerSeconds = settings.timerSeconds;
    }
    this.emit(room.code);
  }

  resetRoom(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "game_over") throw new Error("ניתן לאפס רק לאחר סיום המשחק");

    this.clearTimer(room);
    room.phase       = "lobby";
    room.cards       = [];
    room.currentTurn = null;
    room.winner      = null;
    room.winReason   = null;
    room.firstTeam   = null;
    room.redTotal    = 0;
    room.blueTotal   = 0;
    room.clueHistory = [];

    for (const p of room.players) {
      p.team = null;
      p.role = null;
    }

    this.emit(room.code);
  }

  // ── Queries ──────────────────────────────────────────────────────────────────

  getRoomState(roomCode: string, playerId?: string | null): CodenamesSnapshot {
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

  // ── Private: turn management ─────────────────────────────────────────────────

  private advanceTurn(room: StoredCodenamesRoom) {
    const turn = room.currentTurn;
    if (turn) this.finalizeTurnHistory(room, turn);

    this.clearTimer(room);

    const nextTeam: CodenamesTeam = room.currentTurn?.team === "red" ? "blue" : "red";
    room.currentTurn = {
      team:                  nextTeam,
      phase:                 "giving_clue",
      clue:                  null,
      guessesRemaining:      0,
      turnEndsAt:            null,
      cardsRevealedThisTurn: 0,
    };

    this.emit(room.code);
  }

  private finalizeTurnHistory(room: StoredCodenamesRoom, turn: StoredTurn) {
    if (turn.clue) {
      room.clueHistory.push({
        team:          turn.team,
        clueWord:      turn.clue.word,
        clueNumber:    turn.clue.number,
        cardsRevealed: turn.cardsRevealedThisTurn,
      });
    }
  }

  private clearTimer(room: StoredCodenamesRoom) {
    if (room.turnTimer !== null) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
  }

  // ── Private: snapshot ────────────────────────────────────────────────────────

  private snap(room: StoredCodenamesRoom, playerId: string | null): CodenamesSnapshot {
    const player        = playerId ? (room.players.find((p) => p.id === playerId) ?? null) : null;
    const isSpymaster   = player?.role === "spymaster";
    const revealAll     = room.phase === "game_over";

    const cards: CodenamesCardView[] = room.cards.map((c) => ({
      id:         c.id,
      word:       c.word,
      revealed:   revealAll ? true : c.revealed,
      revealedBy: c.revealedBy,
      // Spymasters always see colors; everyone sees revealed/game_over colors
      color: (isSpymaster || c.revealed || revealAll) ? c.color : undefined,
    }));

    const currentTurn: CodenamesTurn | null = room.currentTurn
      ? {
          team:             room.currentTurn.team,
          phase:            room.currentTurn.phase,
          clue:             room.currentTurn.clue,
          guessesRemaining: room.currentTurn.guessesRemaining,
          turnEndsAt:       room.currentTurn.turnEndsAt,
        }
      : null;

    return {
      code:         room.code,
      phase:        room.phase,
      players:      room.players.map((p): CodenamesPlayer => ({
        id:       p.id,
        nickname: p.nickname,
        team:     p.team,
        role:     p.role,
        isOnline: p.isOnline,
      })),
      cards,
      currentTurn,
      winner:       room.winner,
      winReason:    room.winReason,
      redCardsLeft:  room.cards.filter((c) => c.color === "red"  && !c.revealed).length,
      blueCardsLeft: room.cards.filter((c) => c.color === "blue" && !c.revealed).length,
      firstTeam:    room.firstTeam,
      clueHistory:  room.clueHistory,
      settings:     room.settings,
      hostPlayerId: room.hostPlayerId,
      myPlayerId:   playerId,
    };
  }

  // ── Private: AI word generation ──────────────────────────────────────────────

  private async generateWords(): Promise<string[]> {
    if (!this.aiApiKey) return this.getFallbackWords();

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        words: { type: "array", items: { type: "string" } },
      },
      required: ["words"],
    };

    try {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), 20000);

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${this.aiApiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.aiModel,
          input: [
            "Generate exactly 25 unique, varied Hebrew nouns suitable for the Codenames board game.",
            "They should span many different categories: animals, places, objects, nature, professions, food, abstract concepts, mythology, etc.",
            "Each entry should be 1–3 Hebrew words. Do not repeat words.",
            "Return a JSON object with a single key \"words\" whose value is an array of exactly 25 Hebrew strings.",
          ].join(" "),
          text: {
            format: {
              type:   "json_schema",
              name:   "codenames_words",
              strict: true,
              schema,
            },
          },
        }),
      });

      clearTimeout(timer);
      if (!response.ok) return this.getFallbackWords();

      const data = await response.json() as {
        output?: Array<{ content?: Array<{ text?: string }> }>;
      };
      const text = data.output?.[0]?.content?.[0]?.text;
      if (!text) return this.getFallbackWords();

      const parsed = JSON.parse(text) as { words?: string[] };
      if (!Array.isArray(parsed.words) || parsed.words.length < 25) {
        return this.getFallbackWords();
      }

      return parsed.words.slice(0, 25);
    } catch {
      return this.getFallbackWords();
    }
  }

  private getFallbackWords(): string[] {
    return shuffle([...FALLBACK_WORDS]).slice(0, 25);
  }

  // ── Private: helpers ─────────────────────────────────────────────────────────

  private getRoom(roomCode: string): StoredCodenamesRoom {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new Error("החדר לא נמצא");
    return room;
  }

  private getPlayer(room: StoredCodenamesRoom, playerId: string): StoredCodenamesPlayer {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new Error("השחקן לא נמצא");
    return player;
  }

  private requireTurn(room: StoredCodenamesRoom): StoredTurn {
    if (!room.currentTurn) throw new Error("אין תור פעיל");
    return room.currentTurn;
  }

  private assertHost(room: StoredCodenamesRoom, playerId: string) {
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

  private makePlayer(nickname: string): StoredCodenamesPlayer {
    return {
      id:           createId("cnp"),
      nickname,
      sessionToken: createSessionToken(),
      isOnline:     true,
      team:         null,
      role:         null,
    };
  }

  private validateNickname(nick: string) {
    if (!nick || nick.length < 2)  throw new Error("שם שחקן קצר מדי — לפחות 2 תווים");
    if (nick.length > 20)           throw new Error("שם שחקן ארוך מדי — עד 20 תווים");
  }
}
