import {
  buildPlayerProgress,
  computeCategoryPresenceMap,
  computeDuplicateMap,
  createId,
  createRoomCode,
  createSessionToken,
  formatRoundLetters,
  mergeSettings,
  normalizeAnswer,
  pickRoundLetters,
  rankPlayers,
  scoreAnswers,
  totalScore,
  type AIValidationResult,
  type CreateRoomInput,
  type RoomSettings,
  type RoomStateSnapshot,
  type RoundSnapshot,
  type ScoreBreakdown
} from "@categories-game/shared";
import type { AIValidatorService } from "./ai-validator";
import type { MongoPersistence } from "../lib/mongo";
import type { RedisCoordinator } from "../lib/redis";

interface StoredPlayer {
  id: string;
  nickname: string;
  sessionToken: string;
  score: number;
  isHost: boolean;
  isReady: boolean;
  isOnline: boolean;
  progressCount: number;
  hasFinishedRound: boolean;
}

interface StoredRoom {
  id: string;
  code: string;
  phase: RoomStateSnapshot["room"]["phase"];
  hostPlayerId: string;
  settings: RoomSettings;
  currentRoundNumber: number;
  activeLetter: string | null;
  activeLetters: string[];
  countdownEndsAt: string | null;
  roundEndsAt: string | null;
  players: StoredPlayer[];
  round: RoundSnapshot | null;
  scoreboard: ScoreBreakdown[];
  submissions: Map<string, Record<string, string>>;
  createdAt: string;
}

type HostAnswerOutcome = "valid_normal" | "valid_duplicate" | "valid_unique" | "invalid";

interface GameEvents {
  onRoomState?: (roomCode: string, snapshot: RoomStateSnapshot) => void;
  onCountdown?: (roomCode: string, endsAt: string) => void;
  onAnswersLocked?: (roomCode: string) => void;
  onRoundResults?: (roomCode: string, scoreboard: ScoreBreakdown[]) => void;
  onGameResults?: (roomCode: string, scoreboard: ScoreBreakdown[]) => void;
}

export class GameService {
  private readonly rooms = new Map<string, StoredRoom>();
  private readonly countdownTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly aiValidator: AIValidatorService,
    private readonly mongo: MongoPersistence,
    private readonly redis: RedisCoordinator,
    private readonly events: GameEvents = {}
  ) {}

  async createRoom(input: CreateRoomInput) {
    const nickname = (input.nickname ?? "").trim();
    if (!nickname || nickname.length < 2) throw new Error("שם שחקן קצר מדי — לפחות 2 תווים");
    if (nickname.length > 20) throw new Error("שם שחקן ארוך מדי — עד 20 תווים");
    const settings = mergeSettings(input.settings);
    const hostPlayer = this.createPlayer(nickname, true);
    const room: StoredRoom = {
      id: createId("room"),
      code: this.generateUniqueRoomCode(),
      phase: "lobby",
      hostPlayerId: hostPlayer.id,
      settings,
      currentRoundNumber: 0,
      activeLetter: null,
      activeLetters: [],
      countdownEndsAt: null,
      roundEndsAt: null,
      players: [hostPlayer],
      round: null,
      scoreboard: [],
      submissions: new Map(),
      createdAt: new Date().toISOString(),
    };

    this.rooms.set(room.code, room);
    const snapshot = this.toSnapshot(room, hostPlayer.id);
    await this.persistRoom(snapshot);
    return { room: snapshot, sessionToken: hostPlayer.sessionToken, playerId: hostPlayer.id };
  }

  async joinRoom(roomCode: string, nicknameRaw: string) {
    const nickname = (nicknameRaw ?? "").trim();
    if (!nickname || nickname.length < 2) throw new Error("שם שחקן קצר מדי — לפחות 2 תווים");
    if (nickname.length > 20) throw new Error("שם שחקן ארוך מדי — עד 20 תווים");
    const room = this.getRoomOrThrow(roomCode);
    const existing = room.players.find((player) => player.nickname === nickname);
    if (existing) {
      throw new Error("שם השחקן כבר תפוס בחדר");
    }

    const player = this.createPlayer(nickname, false);
    room.players.push(player);
    const snapshot = this.toSnapshot(room, player.id);
    await this.persistRoom(snapshot);
    this.emitRoomState(room.code);
    return { room: snapshot, sessionToken: player.sessionToken, playerId: player.id };
  }

  async startRoom(roomCode: string, playerId: string) {
    const room = this.getRoomOrThrow(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "lobby" && room.phase !== "round_results") {
      throw new Error("לא ניתן להתחיל משחק בשלב הנוכחי");
    }

    this.startRound(room);
    await this.persistRoom(this.toSnapshot(room, playerId));
    this.emitRoomState(room.code);
    return this.toSnapshot(room, playerId);
  }

  async updateRoomSettings(roomCode: string, playerId: string, settings: Partial<RoomSettings>) {
    const room = this.getRoomOrThrow(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "lobby") {
      throw new Error("אפשר לערוך קטגוריות רק לפני תחילת המשחק");
    }

    const nextSettings = mergeSettings({
      ...room.settings,
      ...settings,
      categories: settings.categories?.length ? settings.categories : room.settings.categories
    });

    room.settings = nextSettings;
    await this.persistRoom(this.toSnapshot(room, playerId));
    this.emitRoomState(room.code);
    return this.toSnapshot(room, playerId);
  }

  async rerollRoundLetters(roomCode: string, playerId: string) {
    const room = this.getRoomOrThrow(roomCode);
    this.assertHost(room, playerId);
    if (!room.round || room.phase !== "in_round") {
      throw new Error("אפשר לרענן אותיות רק בזמן סיבוב פעיל ולפני שהספירה התחילה");
    }

    room.activeLetters = pickRoundLetters(room.settings.mode);
    room.activeLetter = formatRoundLetters(room.activeLetters);
    room.round.letter = room.activeLetter;
    room.round.letters = room.activeLetters;
    room.submissions = new Map();
    for (const player of room.players) {
      player.progressCount = 0;
      player.hasFinishedRound = false;
    }

    await this.persistRoom(this.toSnapshot(room, playerId));
    this.emitRoomState(room.code);
    return this.toSnapshot(room, playerId);
  }

  async setReady(roomCode: string, playerId: string, isReady: boolean) {
    const room = this.getRoomOrThrow(roomCode);
    const player = this.getPlayerOrThrow(room, playerId);
    player.isReady = isReady;
    await this.persistRoom(this.toSnapshot(room, playerId));
    this.emitRoomState(room.code);
  }

  async updateAnswers(roomCode: string, playerId: string, roundNumber: number, answers: Record<string, string>) {
    const room = this.getRoomOrThrow(roomCode);
    if (!room.round || room.currentRoundNumber !== roundNumber || (room.phase !== "in_round" && room.phase !== "countdown")) {
      throw new Error("לא ניתן לעדכן תשובות כרגע");
    }

    room.submissions.set(playerId, answers);
    const player = this.getPlayerOrThrow(room, playerId);
    player.progressCount = buildPlayerProgress(answers, room.settings.categories);
    await this.mongo.saveSubmission({ roomCode, roomId: room.id, roundNumber, playerId, answers });
    await this.persistRoom(this.toSnapshot(room, playerId));
    this.emitRoomState(room.code);
  }

  async finishRound(roomCode: string, playerId: string) {
    const room = this.getRoomOrThrow(roomCode);
    const player = this.getPlayerOrThrow(room, playerId);
    if (room.phase !== "in_round" && room.phase !== "countdown") {
      throw new Error("הסיבוב לא פעיל");
    }

    player.hasFinishedRound = true;
    const everyoneFinished = room.players.every((item) => item.hasFinishedRound);
    if (everyoneFinished) {
      await this.finalizeRound(room);
      return;
    }

    if (room.phase === "in_round") {
      room.phase = "countdown";
      room.countdownEndsAt = new Date(Date.now() + room.settings.countdownSeconds * 1000).toISOString();
      room.roundEndsAt = room.countdownEndsAt;
      if (room.round) {
        room.round.endsAt = room.countdownEndsAt;
      }
      this.scheduleCountdown(room);
      this.events.onCountdown?.(room.code, room.countdownEndsAt);
    }

    await this.persistRoom(this.toSnapshot(room, playerId));
    this.emitRoomState(room.code);
  }

  async startNextRound(roomCode: string, playerId: string) {
    const room = this.getRoomOrThrow(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "round_results") {
      throw new Error("אין סיבוב הבא כרגע");
    }

    if (room.currentRoundNumber >= room.settings.roundsCount) {
      room.phase = "game_over";
      this.emitGameResults(room.code);
      return;
    }

    this.startRound(room);
    await this.persistRoom(this.toSnapshot(room, playerId));
    this.emitRoomState(room.code);
  }

  async resetRoom(roomCode: string, playerId: string) {
    const room = this.getRoomOrThrow(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "game_over") {
      throw new Error("ניתן לאפס רק לאחר סיום המשחק");
    }

    this.clearCountdown(room.code);
    room.phase = "lobby";
    room.currentRoundNumber = 0;
    room.activeLetter = null;
    room.activeLetters = [];
    room.countdownEndsAt = null;
    room.roundEndsAt = null;
    room.round = null;
    room.scoreboard = [];
    room.submissions = new Map();

    for (const player of room.players) {
      player.score = 0;
      player.progressCount = 0;
      player.hasFinishedRound = false;
      player.isReady = player.isHost;
    }

    await this.persistRoom(this.toSnapshot(room, playerId));
    this.emitRoomState(room.code);
  }

    async hostOverrideAnswer(roomCode: string, hostPlayerId: string, targetPlayerId: string, categoryId: string) {
    const room = this.getRoomOrThrow(roomCode);
    this.assertHost(room, hostPlayerId);

    if (room.phase !== "round_results" && room.phase !== "game_over") {
      throw new Error("ניתן לאשר תשובות רק לאחר סיום הסיבוב");
    }

    const entry = room.scoreboard.find((s) => s.playerId === targetPlayerId);
    if (!entry) throw new Error("שחקן לא נמצא");

    const answer = entry.answers.find((a) => a.categoryId === categoryId);
    // Only override answers that: exist, are not already valid, passed the letter rule
    if (!answer || answer.isValid || !answer.isRuleValid) return;

    await this.hostSetAnswerOutcome(roomCode, hostPlayerId, targetPlayerId, categoryId, "valid_normal");
  }

  async hostSetAnswerOutcome(
    roomCode: string,
    hostPlayerId: string,
    targetPlayerId: string,
    categoryId: string,
    outcome: HostAnswerOutcome
  ) {
    const room = this.getRoomOrThrow(roomCode);
    this.assertHost(room, hostPlayerId);

    if (room.phase !== "round_results" && room.phase !== "game_over") {
      throw new Error("ניתן לעדכן תשובות רק לאחר סיום הסיבוב");
    }

    const entry = room.scoreboard.find((s) => s.playerId === targetPlayerId);
    if (!entry) throw new Error("שחקן לא נמצא");

    const answer = entry.answers.find((a) => a.categoryId === categoryId);
    if (!answer) throw new Error("תשובה לא נמצאה");

    const previousScore = answer.score;
    const isValid = outcome !== "invalid";
    const isDuplicate = outcome === "valid_duplicate";
    const score = !isValid ? 0 : outcome === "valid_unique" ? 15 : outcome === "valid_duplicate" ? 5 : 10;

    answer.isCategoryFit = isValid;
    answer.isValid = isValid;
    answer.isDuplicate = isDuplicate;
    answer.score = score;
    answer.isHostOverride = true;
    answer.reason = isValid ? "אושר ידנית על ידי המארח" : "נפסל ידנית על ידי המארח";
    answer.confidence = 1;

    const delta = score - previousScore;
    entry.totalScore += delta;

    const player = room.players.find((p) => p.id === targetPlayerId);
    if (player) player.score += delta;

    room.players = rankPlayers(room.players);
    await this.persistRoom(this.toSnapshot(room, hostPlayerId));
    this.emitRoomState(room.code);
  }
    const entry = room.scoreboard.find((s) => s.playerId === targetPlayerId);
    if (!entry) throw new Error("שחקן לא נמצא");

    const answer = entry.answers.find((a) => a.categoryId === categoryId);
    // Only override answers that: exist, are not already valid, passed the letter rule
    if (!answer || answer.isValid || !answer.isRuleValid) return;

    // Recalculate the correct score using the stored submission maps
    const allSubmissions = Array.from(room.submissions.values());
    const duplicateMap = computeDuplicateMap(allSubmissions, room.settings.categories);
    const categoryPresenceMap = computeCategoryPresenceMap(allSubmissions, room.settings.categories);

    const answeredCount = categoryPresenceMap.get(categoryId) ?? 0;
    const isDuplicate =
      answer.normalizedAnswer.length > 0 &&
      (duplicateMap.get(`${categoryId}:${answer.normalizedAnswer}`) ?? 0) > 1;
    const newScore = answeredCount <= 1 ? 15 : isDuplicate ? 5 : 10;

    // Apply override
    answer.isCategoryFit = true;
    answer.isValid = true;
    answer.isDuplicate = isDuplicate;
    answer.score = newScore;
    answer.isHostOverride = true;
    answer.reason = "אושר ידנית על ידי המארח";

    entry.totalScore += newScore;

    const player = room.players.find((p) => p.id === targetPlayerId);
    if (player) player.score += newScore;

    room.players = rankPlayers(room.players);
    await this.persistRoom(this.toSnapshot(room, hostPlayerId));
    this.emitRoomState(room.code);
  }

  async getRoomState(roomCode: string, playerId?: string | null): Promise<RoomStateSnapshot> {
    const room = this.getRoomOrThrow(roomCode);
    return this.toSnapshot(room, playerId ?? null);
  }

  getAdminStats() {
    const rooms = Array.from(this.rooms.values());
    return {
      totalRooms: rooms.length,
      activeRooms: rooms.filter((r) => r.phase !== "game_over").length,
      totalPlayers: rooms.reduce((sum, r) => sum + r.players.length, 0),
      onlinePlayers: rooms.reduce((sum, r) => sum + r.players.filter((p) => p.isOnline).length, 0),
      generatedAt: new Date().toISOString(),
      rooms: rooms
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((r) => ({
          code: r.code,
          phase: r.phase,
          mode: r.settings.mode,
          currentRoundNumber: r.currentRoundNumber,
          roundsCount: r.settings.roundsCount,
          playerCount: r.players.length,
          onlineCount: r.players.filter((p) => p.isOnline).length,
          createdAt: r.createdAt,
          players: r.players.map((p) => ({
            nickname: p.nickname,
            isHost: p.isHost,
            isOnline: p.isOnline,
            score: p.score,
          })),
        })),
    };
  }

  findPlayerBySession(roomCode: string, sessionToken: string) {
    const room = this.getRoomOrThrow(roomCode);
    return room.players.find((player) => player.sessionToken === sessionToken) ?? null;
  }

  async setOnlineStatus(roomCode: string, playerId: string, isOnline: boolean) {
    const room = this.getRoomOrThrow(roomCode);
    const player = this.getPlayerOrThrow(room, playerId);
    player.isOnline = isOnline;
    await this.persistRoom(this.toSnapshot(room, playerId));
    this.emitRoomState(room.code);
  }

  private createPlayer(nickname: string, isHost: boolean): StoredPlayer {
    return {
      id: createId("player"),
      nickname,
      sessionToken: createSessionToken(),
      score: 0,
      isHost,
      isReady: isHost,
      isOnline: true,
      progressCount: 0,
      hasFinishedRound: false
    };
  }

  private generateUniqueRoomCode(): string {
    let code = createRoomCode();
    while (this.rooms.has(code)) {
      code = createRoomCode();
    }

    return code;
  }

  private startRound(room: StoredRoom) {
    this.clearCountdown(room.code);
    room.currentRoundNumber += 1;
    room.phase = "in_round";
    room.activeLetters = pickRoundLetters(room.settings.mode);
    room.activeLetter = formatRoundLetters(room.activeLetters);
    room.countdownEndsAt = null;
    room.roundEndsAt = null;
    room.round = {
      roundNumber: room.currentRoundNumber,
      letter: room.activeLetter,
      letters: room.activeLetters,
      categories: room.settings.categories,
      startsAt: new Date().toISOString(),
      endsAt: null
    };
    room.submissions = new Map();
    for (const player of room.players) {
      player.progressCount = 0;
      player.hasFinishedRound = false;
    }
  }

  private scheduleCountdown(room: StoredRoom) {
    this.clearCountdown(room.code);
    const timer = setTimeout(() => {
      void this.finalizeRound(room).catch(() => undefined);
    }, room.settings.countdownSeconds * 1000);
    this.countdownTimers.set(room.code, timer);
  }

  private async finalizeRound(room: StoredRoom) {
    if (!room.round || room.phase === "validating" || room.phase === "round_results" || room.phase === "game_over") {
      return;
    }

    this.clearCountdown(room.code);
    room.phase = "validating";
    room.countdownEndsAt = null;
    room.roundEndsAt = new Date().toISOString();
    room.round.endsAt = room.roundEndsAt;
    this.events.onAnswersLocked?.(room.code);
    this.emitRoomState(room.code);

    const allSubmissions = Array.from(room.submissions.values());
    const duplicateMap = computeDuplicateMap(allSubmissions, room.settings.categories);
    const categoryPresenceMap = computeCategoryPresenceMap(allSubmissions, room.settings.categories);

    // ONE batched AI call for all players instead of one per player
    const submissionEntries = room.players.map((p) => ({
      playerId: p.id,
      answers: room.submissions.get(p.id) ?? {},
    }));

    let validationByPlayer: Map<string, AIValidationResult[]>;
    let rawResponse: unknown = { fallback: true };

    try {
      const result = await this.aiValidator.validateAllSubmissions({
        letter: room.round.letter,
        mode: room.settings.mode,
        categories: room.settings.categories,
        submissions: submissionEntries,
      });
      validationByPlayer = result.byPlayer;
      rawResponse = result.rawResponse;
    } catch (err) {
      console.error("AI validation failed, using fallback:", err);
      rawResponse = { fallback: true, reason: String(err) };
      // Fallback: non-empty answer → treat as valid category fit
      validationByPlayer = new Map(
        room.players.map((p) => {
          const answers = room.submissions.get(p.id) ?? {};
          return [p.id, room.settings.categories.map((cat) => ({
            categoryId:    cat.id,
            isCategoryFit: (answers[cat.id] ?? "").trim().length > 0,
            confidence:    0.5,
            reason:        "fallback — שגיאת AI",
          }))];
        }),
      );
    }

    const scoreboard: ScoreBreakdown[] = [];

    for (const player of room.players) {
      const answers = room.submissions.get(player.id) ?? {};
      const aiResults = validationByPlayer.get(player.id) ?? room.settings.categories.map((cat) => ({
        categoryId:    cat.id,
        isCategoryFit: (answers[cat.id] ?? "").trim().length > 0,
        confidence:    0.5,
        reason:        "fallback",
      }));

      const validatedAnswers = scoreAnswers({
        answers,
        aiResults,
        categories: room.settings.categories,
        letter: room.round.letter,
        mode: room.settings.mode,
        duplicateMap,
        categoryPresenceMap,
      });
      const total = totalScore(validatedAnswers);
      player.score += total;
      scoreboard.push({
        playerId: player.id,
        roundNumber: room.currentRoundNumber,
        totalScore: total,
        answers: validatedAnswers,
      });
    }

    // One log entry for the whole round
    await this.mongo.saveValidationLog({
      roomId: room.id,
      roundNumber: room.currentRoundNumber,
      playerId: "batch",
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      promptVersion: "v2-batch",
      rawResponse,
      finalizedAt: new Date().toISOString(),
    });

    room.scoreboard = scoreboard;
    room.players = rankPlayers(room.players);
    room.phase = room.currentRoundNumber >= room.settings.roundsCount ? "game_over" : "round_results";
    await this.mongo.saveRoundResults(room.code, room.currentRoundNumber, scoreboard);
    await this.persistRoom(this.toSnapshot(room, null));
    this.events.onRoundResults?.(room.code, scoreboard);
    if (room.phase === "game_over") {
      this.events.onGameResults?.(room.code, scoreboard);
    }
    this.emitRoomState(room.code);
  }

  private toSnapshot(room: StoredRoom, playerId: string | null): RoomStateSnapshot {
    const categoryPressure = this.buildCategoryPressure(room);

    return {
      room: {
        id: room.id,
        code: room.code,
        phase: room.phase,
        hostPlayerId: room.hostPlayerId,
        settings: room.settings,
        currentRoundNumber: room.currentRoundNumber,
        activeLetter: room.activeLetter,
        activeLetters: room.activeLetters,
        countdownEndsAt: room.countdownEndsAt,
        roundEndsAt: room.roundEndsAt,
        categoryPressure,
        players: room.players.map((player) => ({
          id: player.id,
          nickname: player.nickname,
          score: player.score,
          isHost: player.isHost,
          isReady: player.isReady,
          isOnline: player.isOnline,
          progressCount: player.progressCount,
          hasFinishedRound: player.hasFinishedRound
        }))
      },
      round: room.round,
      scoreboard: room.scoreboard,
      me: {
        playerId,
        nickname: playerId ? room.players.find((player) => player.id === playerId)?.nickname ?? null : null
      }
    };
  }

  private buildCategoryPressure(room: StoredRoom): Record<string, number> {
    const pressure = Object.fromEntries(room.settings.categories.map((category) => [category.id, 0]));

    for (const answers of room.submissions.values()) {
      for (const category of room.settings.categories) {
        if (normalizeAnswer(answers[category.id] ?? "")) {
          pressure[category.id] += 1;
        }
      }
    }

    return pressure;
  }

  private getRoomOrThrow(roomCode: string): StoredRoom {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) {
      throw new Error("החדר לא נמצא");
    }

    return room;
  }

  private getPlayerOrThrow(room: StoredRoom, playerId: string): StoredPlayer {
    const player = room.players.find((item) => item.id === playerId);
    if (!player) {
      throw new Error("השחקן לא נמצא");
    }

    return player;
  }

  private assertHost(room: StoredRoom, playerId: string) {
    if (room.hostPlayerId !== playerId) {
      throw new Error("רק מנהל החדר יכול לבצע את הפעולה");
    }
  }

  private emitRoomState(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return;
    }

    this.events.onRoomState?.(roomCode, this.toSnapshot(room, null));
    void this.redis.publishRoomUpdate(roomCode, { type: "room_state" });
  }

  private emitGameResults(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return;
    }

    this.events.onGameResults?.(roomCode, room.scoreboard);
  }

  private async persistRoom(snapshot: RoomStateSnapshot) {
    await this.mongo.saveRoom(snapshot);
  }

  private clearCountdown(roomCode: string) {
    const timer = this.countdownTimers.get(roomCode);
    if (timer) {
      clearTimeout(timer);
      this.countdownTimers.delete(roomCode);
    }
  }
}

