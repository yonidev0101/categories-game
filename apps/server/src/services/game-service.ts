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
}

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
      submissions: new Map()
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

  async getRoomState(roomCode: string, playerId?: string | null): Promise<RoomStateSnapshot> {
    const room = this.getRoomOrThrow(roomCode);
    return this.toSnapshot(room, playerId ?? null);
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

    const duplicateMap = computeDuplicateMap(Array.from(room.submissions.values()), room.settings.categories);
    const categoryPresenceMap = computeCategoryPresenceMap(Array.from(room.submissions.values()), room.settings.categories);
    const scoreboard: ScoreBreakdown[] = [];

    for (const player of room.players) {
      const answers = room.submissions.get(player.id) ?? {};
      let aiResults = room.settings.categories.map((category) => ({
        categoryId: category.id,
        isCategoryFit: !!answers[category.id],
        confidence: 0.5,
        reason: "לא הוגשה תשובה או שבוצע fallback"
      }));
      let rawResponse: unknown = { fallback: true };

      try {
        const validation = await this.aiValidator.validateBatch({
          letter: room.round.letter,
          mode: room.settings.mode,
          categories: room.settings.categories,
          answers
        });
        aiResults = validation.results;
        rawResponse = validation.rawResponse;
      } catch {
        rawResponse = { fallback: true, reason: "validation_failed" };
      }

      const validatedAnswers = scoreAnswers({
        answers,
        aiResults,
        categories: room.settings.categories,
        letter: room.round.letter,
        mode: room.settings.mode,
        duplicateMap,
        categoryPresenceMap
      });
      const total = totalScore(validatedAnswers);
      player.score += total;
      scoreboard.push({
        playerId: player.id,
        roundNumber: room.currentRoundNumber,
        totalScore: total,
        answers: validatedAnswers
      });

      await this.mongo.saveValidationLog({
        roomId: room.id,
        roundNumber: room.currentRoundNumber,
        playerId: player.id,
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        promptVersion: "v1",
        rawResponse,
        finalizedAt: new Date().toISOString()
      });
    }

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
