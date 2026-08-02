import { createId, createRoomCode, createSessionToken } from "@categories-game/shared";
import type {
  FamilyPhase,
  FamilyRoundType,
  FamilyRoundStage,
  FamilyPlayerInfo,
  FamilySurveyView,
  FamilyQuestionView,
  FamilyVoteReveal,
  FamilyNumberReveal,
  FamilyPointsAwarded,
  FamilyRevealView,
  FamilyTitle,
  FamilyRoomState,
  FamilySnapshot,
} from "@categories-game/shared";
import type { FamilyQuestionSource, FamilySetup } from "@categories-game/shared";
import { CONFIG, ROUND_ORDER, MOST_LIKELY, SURVEY_QUESTIONS, NUMBER_QUESTIONS } from "../games/whoInFamily/content.js";
import {
  generateSurveyQuestions,
  generateRoundQuestions,
  type GeneratedRounds,
  type SurveyAnswerMaterial,
} from "../games/whoInFamily/ai-questions.js";

const NOTE_MAX = 400;

// ─── Stored types ─────────────────────────────────────────────────────────────

interface StoredFamilyPlayer {
  id: string;
  nickname: string;
  sessionToken: string;
  isHost: boolean;
  isOnline: boolean;
  isShared: boolean;
  score: number;
  /** what this player wrote about the family in the lobby, fed to the AI */
  note: string;
  /** survey questions assigned to this player (empty if they joined mid-game) */
  surveyQuestions: string[];
  /** index-aligned with surveyQuestions */
  surveyAnswers: string[];
  // ── stats, used only for the fun titles at the end ──
  votesReceived: number;
  majorityHits: number;
  /** how many round-B answers of theirs were shown */
  authorAppearances: number;
  /** total guesses made against their answers */
  authorTotalGuesses: number;
  /** of those, how many were correct */
  authorCorrectGuesses: number;
}

interface PlannedRound {
  type: FamilyRoundType;
  /** A: the statement. B: the survey question. C: the number question. */
  prompt: string;
  /** B */
  authorId?: string;
  answerText?: string;
  /** C */
  subjectId?: string;
}

interface StoredFamilyRoom {
  id: string;
  code: string;
  phase: FamilyPhase;
  hostPlayerId: string;
  players: StoredFamilyPlayer[];

  rounds: PlannedRound[];
  roundIndex: number;
  stage: FamilyRoundStage | null;

  /** playerId → the player they voted for (rounds A and B) */
  votes: Record<string, string>;
  /** playerId → their guess (round C) */
  numbers: Record<string, number>;
  /** the number the subject submitted (round C) */
  subjectNumber: number | null;

  reveal: FamilyRevealView | null;
  titles: FamilyTitle[];

  source: FamilyQuestionSource;
  /** how many rounds this game runs, chosen by the host */
  roundCount: number;
  /** the shuffled type sequence for this game, decided before the AI is asked */
  roundTypes: FamilyRoundType[];
  /** every question this room has already played, so a rematch feels new */
  usedQuestions: string[];
  isPreparing: boolean;
  aiFailed: boolean;
  /** AI survey questions for this game; null means "use content.ts" */
  generatedSurvey: string[] | null;
  /** AI round questions, written after reading everyone's survey answers */
  generatedRounds: GeneratedRounds | null;

  phaseEndsAt: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  createdAt: string;
}

interface FamilyEvents {
  onState?: (roomCode: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * ROUND_ORDER sets the *ratio* between round types, not the length of the game.
 * The host picks the length; this scales the ratio to it, shuffles, and then
 * breaks up any run of three identical types so the game keeps changing shape.
 */
function buildRoundTypes(count: number): FamilyRoundType[] {
  const template = ROUND_ORDER.length > 0 ? ROUND_ORDER : (["A"] as FamilyRoundType[]);

  const remaining = new Map<FamilyRoundType, number>();
  for (let i = 0; i < count; i += 1) {
    const type = template[i % template.length];
    remaining.set(type, (remaining.get(type) ?? 0) + 1);
  }

  // Always place whichever type has the most left, skipping anything that would
  // make three in a row. Shuffling and then patching does not work: by the tail
  // there is nothing left to swap with, and the game ends on a long run of one
  // type. Placing the scarcest-last keeps every type spread to the end.
  const types: FamilyRoundType[] = [];
  while (types.length < count) {
    const options = shuffle([...remaining.entries()].filter(([, left]) => left > 0));

    const wouldRepeat = (type: FamilyRoundType) =>
      types.length >= 2 && types[types.length - 1] === type && types[types.length - 2] === type;

    const allowed = options.filter(([type]) => !wouldRepeat(type));
    const from = allowed.length > 0 ? allowed : options;
    if (from.length === 0) break;

    const [pick] = from.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    types.push(pick);
    remaining.set(pick, (remaining.get(pick) ?? 1) - 1);
  }

  // Round C needs a subject and reads oddly as an opener — never start on it.
  if (types[0] === "C") {
    const other = types.findIndex((t) => t !== "C");
    if (other !== -1) [types[0], types[other]] = [types[other], types[0]];
  }

  return types;
}

/** Draw `count` items, reshuffling and reusing the pool if it runs out. */
function drawCycling<T>(pool: readonly T[], count: number): T[] {
  if (pool.length === 0) return [];
  const out: T[] = [];
  let bag = shuffle(pool);
  while (out.length < count) {
    if (bag.length === 0) bag = shuffle(pool);
    out.push(bag.pop() as T);
  }
  return out;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class FamilyService {
  private readonly rooms = new Map<string, StoredFamilyRoom>();

  constructor(
    private readonly events: FamilyEvents = {},
    private readonly aiApiKey: string = "",
    private readonly aiModel: string = "gpt-4.1-mini",
  ) {}

  // ── Room lifecycle ──────────────────────────────────────────────────────────

  createRoom(nickname: string, partnerName?: string) {
    const player = this.makePlayer(nickname, partnerName, true);
    const room: StoredFamilyRoom = {
      id: createId("froom"),
      code: this.uniqueCode(),
      phase: "lobby",
      hostPlayerId: player.id,
      players: [player],
      rounds: [],
      roundIndex: 0,
      stage: null,
      votes: {},
      numbers: {},
      subjectNumber: null,
      reveal: null,
      titles: [],
      // Fresh questions every game is the better experience, so that is the
      // default whenever we have a key. content.ts stays as the safety net.
      source: this.aiApiKey ? "ai" : "file",
      roundCount: CONFIG.DEFAULT_ROUNDS,
      roundTypes: [],
      usedQuestions: [],
      isPreparing: false,
      aiFailed: false,
      generatedSurvey: null,
      generatedRounds: null,
      phaseEndsAt: null,
      timer: null,
      createdAt: new Date().toISOString(),
    };

    this.rooms.set(room.code, room);
    return { room: this.snap(room, player.id), sessionToken: player.sessionToken, playerId: player.id };
  }

  joinRoom(roomCode: string, nickname: string, partnerName?: string) {
    const room = this.getRoom(roomCode);
    if (room.phase === "final") throw new Error("המשחק כבר הסתיים");

    const player = this.makePlayer(nickname, partnerName, false);
    if (room.players.some((p) => p.nickname === player.nickname)) throw new Error("השם כבר תפוס בחדר");

    room.players.push(player);
    this.emit(room.code);
    return { room: this.snap(room, player.id), sessionToken: player.sessionToken, playerId: player.id };
  }

  /** Only the host decides where the questions come from and how long we play. */
  updateSetup(
    roomCode: string,
    playerId: string,
    setup: { source?: FamilyQuestionSource; roundCount?: number },
  ) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "lobby") throw new Error("אפשר לשנות רק לפני שהמשחק מתחיל");
    if (room.isPreparing) throw new Error("מכינים שאלות, רגע");

    if (setup.source === "ai" || setup.source === "file") {
      room.source = setup.source === "ai" && !this.aiApiKey ? "file" : setup.source;
    }
    if (typeof setup.roundCount === "number" && Number.isFinite(setup.roundCount)) {
      room.roundCount = Math.min(CONFIG.MAX_ROUNDS, Math.max(CONFIG.MIN_ROUNDS, Math.round(setup.roundCount)));
    }

    this.emit(room.code);
    return this.snap(room, playerId);
  }

  /** Everyone writes their own note about the family — not just the host. */
  setFamilyNote(roomCode: string, playerId: string, text: string) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "lobby") throw new Error("אפשר לכתוב רק לפני שהמשחק מתחיל");
    if (room.isPreparing) throw new Error("מכינים שאלות, רגע");

    this.getPlayer(room, playerId).note = text.slice(0, NOTE_MAX);
    this.emit(room.code);
    return this.snap(room, playerId);
  }

  /**
   * Everything the family said about itself, labelled by who said it — the AI
   * writes far better questions when it knows whose observation it is.
   */
  private composeFamilyDescription(room: StoredFamilyRoom): string {
    return room.players
      .filter((p) => p.note.trim().length > 0)
      .map((p) => `${p.nickname}: ${p.note.trim()}`)
      .join("\n");
  }

  async startGame(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "lobby") throw new Error("המשחק כבר התחיל");
    if (room.isPreparing) throw new Error("כבר מכינים שאלות");
    if (room.players.length < CONFIG.MIN_PLAYERS) {
      throw new Error(`דרושים לפחות ${CONFIG.MIN_PLAYERS} שחקנים`);
    }

    room.aiFailed = false;
    room.generatedSurvey = null;
    room.generatedRounds = null;
    // Decide the shape of the game up front — the AI needs to know how many of
    // each type to write, and the mix must not change once we have asked.
    room.roundTypes = buildRoundTypes(room.roundCount);

    // First AI call, in the lobby: the survey questions. Nothing is on a timer
    // yet, so this one can take its time. On failure we use content.ts.
    if (room.source === "ai" && this.aiApiKey) {
      room.isPreparing = true;
      this.emit(room.code);

      const needed = Math.max(6, room.players.length * CONFIG.SURVEY_QUESTIONS_PER_PLAYER);
      room.generatedSurvey = await generateSurveyQuestions(
        needed,
        this.composeFamilyDescription(room),
        room.usedQuestions,
        this.aiApiKey,
        this.aiModel,
      );
      if (room.generatedSurvey) room.usedQuestions.push(...room.generatedSurvey);
      room.aiFailed = room.generatedSurvey === null;
      room.isPreparing = false;

      // The host may have reset the room while we were waiting.
      if (room.phase !== "lobby") return this.snap(room, playerId);
    }

    this.dealSurveyQuestions(room);

    room.phase = "survey";
    this.schedule(room, CONFIG.SURVEY_SECONDS, () => this.endSurvey(room));
    this.emit(room.code);
    return this.snap(room, playerId);
  }

  /**
   * Deal survey questions from ONE shuffled deck rather than giving each player
   * an independent draw — an independent draw hands the same question to
   * several people even when the pool is large. With a pool of at least
   * players × SURVEY_QUESTIONS_PER_PLAYER, nobody sees a repeat at all.
   */
  private dealSurveyQuestions(room: StoredFamilyRoom) {
    const perPlayer = CONFIG.SURVEY_QUESTIONS_PER_PLAYER;
    const pool = this.pool(room, "survey");
    let bag = shuffle(pool);

    for (const player of room.players) {
      const mine: string[] = [];
      while (mine.length < perPlayer && pool.length > 0) {
        if (bag.length === 0) bag = shuffle(pool);
        // When the deck wraps, skip anything this player already holds — nobody
        // should ever see the same question twice on their own screen.
        const index = Math.max(0, bag.findIndex((q) => !mine.includes(q)));
        mine.push(bag.splice(index, 1)[0]);
      }
      player.surveyQuestions = mine;
      player.surveyAnswers = mine.map(() => "");
    }
  }

  /** AI questions when we have them, the curated file otherwise. */
  private pool(room: StoredFamilyRoom, kind: "mostLikely" | "survey" | "numbers"): string[] {
    if (kind === "survey") {
      return room.generatedSurvey?.length ? room.generatedSurvey : SURVEY_QUESTIONS;
    }
    const rounds = room.generatedRounds;
    if (kind === "mostLikely") {
      return rounds && rounds.mostLikely.length > 0 ? rounds.mostLikely : MOST_LIKELY;
    }
    const fileNumbers = [...NUMBER_QUESTIONS.live, ...NUMBER_QUESTIONS.personal];
    return rounds && rounds.numberQuestions.length > 0 ? rounds.numberQuestions : fileNumbers;
  }

  /**
   * The survey window is deliberately generous, so the host needs a way to say
   * "everyone's done, let's play" instead of watching the clock run out.
   */
  finishSurveyNow(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "survey") throw new Error("השאלון לא פעיל");
    if (room.isPreparing) throw new Error("כבר מכינים את הסבבים");

    this.clearTimer(room);
    this.endSurvey(room);
    return this.snap(room, playerId);
  }

  /**
   * The host can drop the question on screen instantly. Nothing is scored and
   * the round is discarded — this exists so that an item nobody should have to
   * read can be gone in one tap, without waiting for the timer.
   */
  skipRound(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);
    if (room.phase !== "question" && room.phase !== "reveal") {
      throw new Error("אפשר לדלג רק על שאלה שמוצגת עכשיו");
    }

    const skipped = this.currentRound(room);
    if (skipped) {
      // Never hand the same item out again, in this game or a rematch.
      room.usedQuestions.push(skipped.prompt);
      if (skipped.type === "A" && room.generatedRounds) {
        room.generatedRounds.mostLikely = room.generatedRounds.mostLikely.filter((q) => q !== skipped.prompt);
      }
      if (skipped.type === "C" && room.generatedRounds) {
        room.generatedRounds.numberQuestions = room.generatedRounds.numberQuestions.filter((q) => q !== skipped.prompt);
      }
    }

    this.clearTimer(room);
    this.nextRound(room);
    return this.snap(room, playerId);
  }

  resetRoom(roomCode: string, playerId: string) {
    const room = this.getRoom(roomCode);
    this.assertHost(room, playerId);

    this.clearTimer(room);
    room.phase = "lobby";
    room.rounds = [];
    room.roundIndex = 0;
    room.stage = null;
    room.votes = {};
    room.numbers = {};
    room.subjectNumber = null;
    room.reveal = null;
    room.titles = [];
    room.phaseEndsAt = null;
    room.isPreparing = false;
    room.aiFailed = false;
    room.generatedSurvey = null;
    room.generatedRounds = null;
    for (const p of room.players) {
      p.score = 0;
      p.surveyQuestions = [];
      p.surveyAnswers = [];
      p.votesReceived = 0;
      p.majorityHits = 0;
      p.authorAppearances = 0;
      p.authorTotalGuesses = 0;
      p.authorCorrectGuesses = 0;
    }

    this.emit(room.code);
    return this.snap(room, playerId);
  }

  // ── Player actions ──────────────────────────────────────────────────────────

  submitSurveyAnswer(roomCode: string, playerId: string, index: number, text: string) {
    const room = this.getRoom(roomCode);
    if (room.phase !== "survey") throw new Error("שלב הסקר הסתיים");

    const player = this.getPlayer(room, playerId);
    if (index < 0 || index >= player.surveyQuestions.length) throw new Error("שאלה לא קיימת");

    player.surveyAnswers[index] = text.trim().slice(0, CONFIG.SURVEY_ANSWER_MAX_CHARS);
    this.emit(room.code);

    if (room.players.every((p) => this.hasFinishedSurvey(p))) {
      this.hurryUp(room, () => this.endSurvey(room));
    }
  }

  castVote(roomCode: string, playerId: string, targetPlayerId: string) {
    const room = this.getRoom(roomCode);
    const round = this.currentRound(room);
    if (room.phase !== "question" || !round) throw new Error("אין סבב פעיל");
    if (round.type === "C") throw new Error("בסבב הזה מזינים מספר, לא מצביעים");
    if (round.type === "B" && round.authorId === playerId) throw new Error("זו התשובה שלך");
    if (!room.players.some((p) => p.id === targetPlayerId)) throw new Error("שחקן לא נמצא");

    room.votes[playerId] = targetPlayerId;
    this.emit(room.code);

    if (this.answeredCount(room) >= this.expectedCount(room)) {
      this.hurryUp(room, () => this.endQuestion(room));
    }
  }

  submitNumber(roomCode: string, playerId: string, value: number) {
    const room = this.getRoom(roomCode);
    const round = this.currentRound(room);
    if (room.phase !== "question" || !round || round.type !== "C") throw new Error("אין סבב מספרים פעיל");
    if (!Number.isFinite(value)) throw new Error("צריך להזין מספר");

    const num = Math.round(value);

    if (room.stage === "subject_input") {
      if (playerId !== round.subjectId) throw new Error("רק הנבדק מזין את המספר בשלב הזה");
      room.subjectNumber = num;
      this.emit(room.code);
      this.hurryUp(room, () => this.beginNumberGuessing(room));
      return;
    }

    if (playerId === round.subjectId) throw new Error("אתה הנבדק — אתה לא מנחש");
    room.numbers[playerId] = num;
    this.emit(room.code);

    if (this.answeredCount(room) >= this.expectedCount(room)) {
      this.hurryUp(room, () => this.endQuestion(room));
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  getRoomState(roomCode: string, playerId?: string | null): FamilySnapshot {
    return this.snap(this.getRoom(roomCode), playerId ?? null);
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
    if (!player) return;
    player.isOnline = isOnline;
    this.emit(room.code);
  }

  // ── Phase machine ───────────────────────────────────────────────────────────

  private endSurvey(room: StoredFamilyRoom) {
    // An unhandled rejection here would take down the whole process — and with
    // it every room of every game. Fall through to the file instead.
    void this.finishSurvey(room).catch((error) => {
      console.error("[family] survey handoff failed, using content.ts", error);
      room.isPreparing = false;
      room.aiFailed = true;
      try {
        this.buildRounds(room);
        room.roundIndex = -1;
        this.nextRound(room);
      } catch (fatal) {
        console.error("[family] could not start rounds", fatal);
      }
    });
  }

  /**
   * Second AI call: now that everyone has written something, use it to write
   * the rounds. Capped hard — a round is about to start, so we would rather
   * play with the curated file than keep the room staring at a screen.
   */
  private async finishSurvey(room: StoredFamilyRoom) {
    if (room.source === "ai" && this.aiApiKey) {
      room.isPreparing = true;
      room.phaseEndsAt = null;
      this.clearTimer(room);
      this.emit(room.code);

      const material: SurveyAnswerMaterial[] = room.players.flatMap((p) =>
        p.surveyQuestions.map((question, i) => ({
          nickname: p.nickname,
          question,
          answer: p.surveyAnswers[i] ?? "",
        })),
      );

      room.generatedRounds = await generateRoundQuestions(
        {
          mostLikely: Math.max(6, room.roundTypes.filter((t) => t === "A").length),
          numbers: Math.max(4, room.roundTypes.filter((t) => t === "C").length),
        },
        this.composeFamilyDescription(room),
        material,
        room.usedQuestions,
        this.aiApiKey,
        this.aiModel,
      );
      if (room.generatedRounds) {
        room.usedQuestions.push(...room.generatedRounds.mostLikely, ...room.generatedRounds.numberQuestions);
      }
      // Keep the history from growing without bound across a long evening.
      if (room.usedQuestions.length > 120) {
        room.usedQuestions = room.usedQuestions.slice(-120);
      }

      room.isPreparing = false;
      if (room.generatedRounds === null) room.aiFailed = true;

      // The room could have been reset while we waited.
      if (room.phase !== "survey") return;
    }

    this.buildRounds(room);
    room.roundIndex = -1;
    this.nextRound(room);
  }

  /**
   * Turn ROUND_ORDER into a concrete list of rounds. Round B needs real survey
   * answers, so this can only run once the survey is over. B rounds with no
   * answer left to use are downgraded to A rounds rather than dropped.
   */
  private buildRounds(room: StoredFamilyRoom) {
    const plan = room.roundTypes.length > 0 ? room.roundTypes : buildRoundTypes(room.roundCount);
    const statements = drawCycling(this.pool(room, "mostLikely"), plan.length);
    const numberPool = drawCycling(this.pool(room, "numbers"), plan.length);

    // Every non-empty survey answer, shuffled, so round B never repeats one.
    const answerPool = shuffle(
      room.players.flatMap((p) =>
        p.surveyQuestions
          .map((question, i) => ({ authorId: p.id, question, answer: p.surveyAnswers[i] ?? "" }))
          .filter((entry) => entry.answer.length > 0),
      ),
    );

    const subjectOrder = shuffle(room.players.map((p) => p.id));
    let statementIdx = 0;
    let numberIdx = 0;
    let subjectIdx = 0;

    const rounds: PlannedRound[] = [];
    for (const type of plan) {
      if (type === "B") {
        const entry = answerPool.pop();
        if (entry) {
          rounds.push({ type: "B", prompt: entry.question, authorId: entry.authorId, answerText: entry.answer });
          continue;
        }
        // no survey answers left — fall through to an A round
      }

      if (type === "C") {
        rounds.push({
          type: "C",
          prompt: numberPool[numberIdx++ % numberPool.length],
          subjectId: subjectOrder[subjectIdx++ % subjectOrder.length],
        });
        continue;
      }

      rounds.push({ type: "A", prompt: statements[statementIdx++ % statements.length] });
    }

    room.rounds = rounds;
  }

  private nextRound(room: StoredFamilyRoom) {
    room.roundIndex += 1;
    room.votes = {};
    room.numbers = {};
    room.subjectNumber = null;
    room.reveal = null;
    room.stage = null;

    const round = this.currentRound(room);
    if (!round) {
      this.endGame(room);
      return;
    }

    room.phase = "question";

    if (round.type === "C") {
      room.stage = "subject_input";
      this.schedule(room, CONFIG.ROUND_C_SUBJECT_SECONDS, () => this.beginNumberGuessing(room));
    } else {
      const seconds = round.type === "A" ? CONFIG.ROUND_A_SECONDS : CONFIG.ROUND_B_SECONDS;
      this.schedule(room, seconds, () => this.endQuestion(room));
    }

    this.emit(room.code);
  }

  private beginNumberGuessing(room: StoredFamilyRoom) {
    // The subject never answered — nothing to guess, so move on.
    if (room.subjectNumber === null) {
      this.nextRound(room);
      return;
    }

    room.stage = "guessing";
    this.schedule(room, CONFIG.ROUND_C_GUESS_SECONDS, () => this.endQuestion(room));
    this.emit(room.code);
  }

  private endQuestion(room: StoredFamilyRoom) {
    const round = this.currentRound(room);
    if (!round) {
      this.endGame(room);
      return;
    }

    room.reveal = round.type === "C" ? this.scoreNumbers(room, round) : this.scoreVotes(room, round);
    room.phase = "reveal";
    room.stage = null;
    this.schedule(room, CONFIG.REVEAL_SECONDS, () => this.nextRound(room));
    this.emit(room.code);
  }

  private endGame(room: StoredFamilyRoom) {
    this.clearTimer(room);
    room.phase = "final";
    room.phaseEndsAt = null;
    room.titles = this.computeTitles(room);
    this.emit(room.code);
  }

  // ── Scoring ─────────────────────────────────────────────────────────────────

  private scoreVotes(room: StoredFamilyRoom, round: PlannedRound): FamilyRevealView {
    const tally = new Map<string, string[]>();
    for (const [voterId, targetId] of Object.entries(room.votes)) {
      const voters = tally.get(targetId) ?? [];
      voters.push(voterId);
      tally.set(targetId, voters);
    }

    const points = new Map<string, number>();
    const reasons = new Map<string, string>();
    const award = (playerId: string, amount: number, reason: string) => {
      points.set(playerId, (points.get(playerId) ?? 0) + amount);
      reasons.set(playerId, reason);
      const player = room.players.find((p) => p.id === playerId);
      if (player) player.score += amount;
    };

    for (const [targetId, voters] of tally) {
      const target = room.players.find((p) => p.id === targetId);
      if (target) target.votesReceived += voters.length;
    }

    if (round.type === "A") {
      // Everyone who voted with the majority scores. On a tie, every tied
      // group counts as a majority — nobody is punished for a split vote.
      const topCount = Math.max(0, ...[...tally.values()].map((v) => v.length));
      for (const voters of tally.values()) {
        if (voters.length !== topCount) continue;
        for (const voterId of voters) {
          award(voterId, CONFIG.POINTS_A_MAJORITY, "הצבעתם עם הרוב");
          const voter = room.players.find((p) => p.id === voterId);
          if (voter) voter.majorityHits += 1;
        }
      }
    } else {
      const correctVoters = tally.get(round.authorId ?? "") ?? [];
      const totalGuesses = Object.keys(room.votes).length;
      for (const voterId of correctVoters) award(voterId, CONFIG.POINTS_B_CORRECT, "ניחשתם נכון מי כתב");

      const author = room.players.find((p) => p.id === round.authorId);
      if (author) {
        author.authorAppearances += 1;
        author.authorTotalGuesses += totalGuesses;
        author.authorCorrectGuesses += correctVoters.length;
        const misses = totalGuesses - correctVoters.length;
        if (misses > 0) {
          award(author.id, misses * CONFIG.POINTS_B_AUTHOR_PER_MISS, `${misses} לא זיהו שזה אתם`);
        }
      }
    }

    const votes: FamilyVoteReveal[] = [...tally.entries()]
      .map(([targetId, voters]) => ({
        playerId: targetId,
        nickname: room.players.find((p) => p.id === targetId)?.nickname ?? "?",
        votes: voters.length,
        voterIds: voters,
        isAuthor: round.type === "B" && targetId === round.authorId,
      }))
      .sort((a, b) => a.votes - b.votes);

    return {
      roundNumber: room.roundIndex + 1,
      type: round.type,
      prompt: round.prompt,
      votes,
      numbers: [],
      answerText: round.answerText ?? null,
      authorId: round.authorId ?? null,
      authorNickname: room.players.find((p) => p.id === round.authorId)?.nickname ?? null,
      subjectNickname: null,
      correctNumber: null,
      pointsAwarded: this.formatPoints(room, points, reasons),
      summary: this.summariseVotes(room, round, votes),
    };
  }

  /** One plain sentence closing the round, so nobody has to read a table. */
  private summariseVotes(room: StoredFamilyRoom, round: PlannedRound, votes: FamilyVoteReveal[]): string {
    if (votes.length === 0) return "אף אחד לא הצביע הפעם.";
    const top = votes[votes.length - 1];
    const voters = Object.keys(room.votes).length;

    if (round.type === "A") {
      if (votes.length === 1 && top.votes === voters) return `פה אחד — כולם הצביעו על ${top.nickname}.`;
      const tiedAtTop = votes.filter((v) => v.votes === top.votes);
      if (tiedAtTop.length > 1) {
        return `תיקו בין ${tiedAtTop.map((v) => v.nickname).join(" ו")}. המשפחה מפולגת.`;
      }
      return `רוב המשפחה הצביעה על ${top.nickname}.`;
    }

    const author = room.players.find((p) => p.id === round.authorId);
    const correct = votes.find((v) => v.isAuthor)?.votes ?? 0;
    if (!author) return "";
    if (correct === 0) return `${author.nickname} כתבו את זה — ואף אחד לא ניחש.`;
    if (correct === voters) return `${author.nickname} כתבו את זה — וכולם ידעו.`;
    return `${author.nickname} כתבו את זה. ${correct} מתוך ${voters} ניחשו נכון.`;
  }

  private scoreNumbers(room: StoredFamilyRoom, round: PlannedRound): FamilyRevealView {
    const target = room.subjectNumber ?? 0;
    const entries = Object.entries(room.numbers).map(([playerId, guess]) => ({
      playerId,
      nickname: room.players.find((p) => p.id === playerId)?.nickname ?? "?",
      guess,
      distance: Math.abs(guess - target),
      isExact: guess === target,
      isClosest: false,
    }));

    const points = new Map<string, number>();
    const reasons = new Map<string, string>();
    const best = entries.length > 0 ? Math.min(...entries.map((e) => e.distance)) : -1;

    for (const entry of entries) {
      if (entry.distance !== best) continue;
      entry.isClosest = true;
      let amount = CONFIG.POINTS_C_CLOSEST;
      if (entry.isExact) amount += CONFIG.POINTS_C_EXACT_BONUS;
      points.set(entry.playerId, amount);
      reasons.set(entry.playerId, entry.isExact ? "פגעתם בול" : "הניחוש הכי קרוב");
      const player = room.players.find((p) => p.id === entry.playerId);
      if (player) player.score += amount;
    }

    // furthest first, so the closest guess is revealed last
    entries.sort((a, b) => b.distance - a.distance);

    return {
      roundNumber: room.roundIndex + 1,
      type: "C",
      prompt: round.prompt,
      votes: [],
      numbers: entries as FamilyNumberReveal[],
      answerText: null,
      authorId: null,
      authorNickname: null,
      subjectNickname: room.players.find((p) => p.id === round.subjectId)?.nickname ?? null,
      correctNumber: room.subjectNumber,
      pointsAwarded: this.formatPoints(room, points, reasons),
      summary: this.summariseNumbers(room, round, entries),
    };
  }

  private summariseNumbers(room: StoredFamilyRoom, round: PlannedRound, entries: FamilyNumberReveal[]): string {
    const subject = room.players.find((p) => p.id === round.subjectId)?.nickname ?? "";
    if (entries.length === 0) return `${subject} ענו ${room.subjectNumber} — ואף אחד לא ניחש.`;
    const closest = entries.filter((e) => e.isClosest);
    const exact = closest.filter((e) => e.isExact);
    if (exact.length > 0) return `${subject} ענו ${room.subjectNumber}. ${exact.map((e) => e.nickname).join(" ו")} פגעו בול.`;
    return `${subject} ענו ${room.subjectNumber}. הכי קרוב: ${closest.map((e) => e.nickname).join(" ו")}.`;
  }

  private formatPoints(
    room: StoredFamilyRoom,
    points: Map<string, number>,
    reasons: Map<string, string>,
  ): FamilyPointsAwarded[] {
    return [...points.entries()]
      .map(([playerId, amount]) => ({
        playerId,
        nickname: room.players.find((p) => p.id === playerId)?.nickname ?? "?",
        points: amount,
        reason: reasons.get(playerId) ?? "",
      }))
      .sort((a, b) => b.points - a.points);
  }

  private computeTitles(room: StoredFamilyRoom): FamilyTitle[] {
    const titles: FamilyTitle[] = [];
    const add = (key: string, label: string, player: StoredFamilyPlayer | undefined, detail: string) => {
      if (player) titles.push({ key, label, playerId: player.id, nickname: player.nickname, detail });
    };

    const mostVoted = [...room.players].sort((a, b) => b.votesReceived - a.votesReceived)[0];
    if (mostVoted && mostVoted.votesReceived > 0) {
      add("most_voted", "כוכב הערב", mostVoted, `קיבל/ה ${mostVoted.votesReceived} הצבעות`);
    }

    const authors = room.players.filter((p) => p.authorAppearances > 0 && p.authorTotalGuesses > 0);
    const mystery = authors.sort(
      (a, b) => a.authorCorrectGuesses / a.authorTotalGuesses - b.authorCorrectGuesses / b.authorTotalGuesses,
    )[0];
    if (mystery) {
      const pct = Math.round((mystery.authorCorrectGuesses / mystery.authorTotalGuesses) * 100);
      add("mystery", "האיש המסתורי", mystery, `רק ${pct}% ניחשו נכון שזה הוא/היא`);
    }

    const voiceOfPeople = [...room.players].sort((a, b) => b.majorityHits - a.majorityHits)[0];
    if (voiceOfPeople && voiceOfPeople.majorityHits > 0) {
      add("majority", "קול העם", voiceOfPeople, `הצביע/ה עם הרוב ${voiceOfPeople.majorityHits} פעמים`);
    }

    return titles;
  }

  // ── Timing ──────────────────────────────────────────────────────────────────

  /**
   * The single source of truth for phase length. The server always fires,
   * whether or not players answered — nothing here ever waits on a player.
   */
  private schedule(room: StoredFamilyRoom, seconds: number, fn: () => void) {
    this.clearTimer(room);
    room.phaseEndsAt = new Date(Date.now() + seconds * 1000).toISOString();
    room.timer = setTimeout(() => {
      room.timer = null;
      // A throw inside a timer callback is an uncaught exception, which would
      // kill the server. One broken room must never do that.
      try {
        fn();
      } catch (error) {
        console.error(`[family] phase transition failed in room ${room.code}`, error);
      }
    }, seconds * 1000);
  }

  /** Everyone answered early — shorten the wait, but never extend it. */
  private hurryUp(room: StoredFamilyRoom, fn: () => void) {
    const remaining = room.phaseEndsAt ? new Date(room.phaseEndsAt).getTime() - Date.now() : 0;
    if (remaining <= CONFIG.ALL_ANSWERED_GRACE_SECONDS * 1000) return;
    this.schedule(room, CONFIG.ALL_ANSWERED_GRACE_SECONDS, fn);
    this.emit(room.code);
  }

  private clearTimer(room: StoredFamilyRoom) {
    if (room.timer !== null) {
      clearTimeout(room.timer);
      room.timer = null;
    }
  }

  // ── Snapshot ────────────────────────────────────────────────────────────────

  private snap(room: StoredFamilyRoom, playerId: string | null): FamilySnapshot {
    const me = playerId ? room.players.find((p) => p.id === playerId) ?? null : null;

    const state: FamilyRoomState = {
      id: room.id,
      code: room.code,
      phase: room.phase,
      hostPlayerId: room.hostPlayerId,
      players: room.players.map(
        (p): FamilyPlayerInfo => ({
          id: p.id,
          nickname: p.nickname,
          isHost: p.isHost,
          isOnline: p.isOnline,
          score: p.score,
          isShared: p.isShared,
        }),
      ),
      roundNumber: room.roundIndex + 1,
      totalRounds: room.rounds.length || room.roundCount,
      phaseEndsAt: room.phaseEndsAt,
      survey: room.phase === "survey" ? this.surveyView(room, me) : null,
      question: room.phase === "question" ? this.questionView(room, playerId) : null,
      reveal: room.phase === "reveal" ? room.reveal : null,
      final:
        room.phase === "final"
          ? {
              standings: room.players
                .map(
                  (p): FamilyPlayerInfo => ({
                    id: p.id,
                    nickname: p.nickname,
                    isHost: p.isHost,
                    isOnline: p.isOnline,
                    score: p.score,
                    isShared: p.isShared,
                  }),
                )
                .sort((a, b) => b.score - a.score),
              titles: room.titles,
            }
          : null,
      setup: {
        source: room.source,
        roundCount: room.roundCount,
        myNote: me?.note ?? "",
        notes: room.players.map((p) => ({
          playerId: p.id,
          nickname: p.nickname,
          hasWritten: p.note.trim().length > 0,
        })),
        isPreparing: room.isPreparing,
        aiFailed: room.aiFailed,
        aiAvailable: Boolean(this.aiApiKey),
      } satisfies FamilySetup,
      config: {
        surveyAnswerMaxChars: CONFIG.SURVEY_ANSWER_MAX_CHARS,
        minPlayers: CONFIG.MIN_PLAYERS,
        noteMaxChars: NOTE_MAX,
        minRounds: CONFIG.MIN_ROUNDS,
        maxRounds: CONFIG.MAX_ROUNDS,
      },
      createdAt: room.createdAt,
    };

    return {
      room: state,
      me: { playerId, nickname: me?.nickname ?? null },
    };
  }

  private surveyView(room: StoredFamilyRoom, me: StoredFamilyPlayer | null): FamilySurveyView {
    return {
      questions: me?.surveyQuestions ?? [],
      myAnswers: me?.surveyAnswers ?? [],
      iAmFinished: me ? this.hasFinishedSurvey(me) : true,
      finishedCount: room.players.filter((p) => this.hasFinishedSurvey(p)).length,
      totalCount: room.players.length,
      finishedIds: room.players.filter((p) => this.hasFinishedSurvey(p)).map((p) => p.id),
    };
  }

  private questionView(room: StoredFamilyRoom, playerId: string | null): FamilyQuestionView | null {
    const round = this.currentRound(room);
    if (!round) return null;

    const iAmAuthor = round.type === "B" && round.authorId === playerId;
    const iAmSubject = round.type === "C" && round.subjectId === playerId;

    // In round C the question itself is private until the subject has answered.
    const prompt = round.type === "C" && room.stage === "subject_input" && !iAmSubject ? null : round.prompt;

    const votableIds =
      round.type === "A"
        ? // you may vote for yourself here — plenty of statements fit
          room.players.map((p) => p.id)
        : round.type === "B"
          ? // the author MUST be an option, they are the correct answer. Only the
            // person looking at the screen is dropped, since they know it is not them.
            room.players.filter((p) => p.id !== playerId).map((p) => p.id)
          : [];

    return {
      roundNumber: room.roundIndex + 1,
      totalRounds: room.rounds.length,
      type: round.type,
      prompt,
      stage: room.stage,
      answerText: round.answerText ?? null,
      iAmAuthor,
      subjectId: round.subjectId ?? null,
      subjectNickname: room.players.find((p) => p.id === round.subjectId)?.nickname ?? null,
      iAmSubject,
      votableIds,
      myVote: playerId ? room.votes[playerId] ?? null : null,
      myNumber: playerId
        ? iAmSubject && room.stage === "subject_input"
          ? room.subjectNumber
          : room.numbers[playerId] ?? null
        : null,
      answeredCount: this.answeredCount(room),
      expectedCount: this.expectedCount(room),
      participantIds: this.participantIds(room),
      answeredIds: this.answeredIds(room),
    };
  }

  /** Who this round is waiting on. */
  private participantIds(room: StoredFamilyRoom): string[] {
    const round = this.currentRound(room);
    if (!round) return [];
    if (round.type === "A") return room.players.map((p) => p.id);
    if (round.type === "B") return room.players.filter((p) => p.id !== round.authorId).map((p) => p.id);
    if (room.stage === "subject_input") return round.subjectId ? [round.subjectId] : [];
    return room.players.filter((p) => p.id !== round.subjectId).map((p) => p.id);
  }

  private answeredIds(room: StoredFamilyRoom): string[] {
    const round = this.currentRound(room);
    if (!round) return [];
    const participants = new Set(this.participantIds(room));
    if (round.type !== "C") return Object.keys(room.votes).filter((id) => participants.has(id));
    if (room.stage === "subject_input") {
      return room.subjectNumber !== null && round.subjectId ? [round.subjectId] : [];
    }
    return Object.keys(room.numbers).filter((id) => participants.has(id));
  }

  // ── Progress helpers ────────────────────────────────────────────────────────

  private hasFinishedSurvey(player: StoredFamilyPlayer): boolean {
    if (player.surveyQuestions.length === 0) return true;
    return player.surveyAnswers.every((a) => a.trim().length > 0);
  }

  private answeredCount(room: StoredFamilyRoom): number {
    const round = this.currentRound(room);
    if (!round) return 0;
    if (round.type !== "C") return Object.keys(room.votes).length;
    if (room.stage === "subject_input") return room.subjectNumber === null ? 0 : 1;
    return Object.keys(room.numbers).length;
  }

  private expectedCount(room: StoredFamilyRoom): number {
    const round = this.currentRound(room);
    if (!round) return 0;
    if (round.type === "A") return room.players.length;
    if (round.type === "B") return Math.max(0, room.players.length - 1);
    return room.stage === "subject_input" ? 1 : Math.max(0, room.players.length - 1);
  }

  private currentRound(room: StoredFamilyRoom): PlannedRound | null {
    return room.rounds[room.roundIndex] ?? null;
  }

  // ── Misc helpers ────────────────────────────────────────────────────────────

  private getRoom(roomCode: string): StoredFamilyRoom {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new Error("החדר לא נמצא");
    return room;
  }

  private getPlayer(room: StoredFamilyRoom, playerId: string): StoredFamilyPlayer {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new Error("השחקן לא נמצא");
    return player;
  }

  private assertHost(room: StoredFamilyRoom, playerId: string) {
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

  private makePlayer(nickname: string, partnerName: string | undefined, isHost: boolean): StoredFamilyPlayer {
    const first = nickname.trim();
    const second = (partnerName ?? "").trim();
    this.validateNickname(first);
    if (second) this.validateNickname(second);

    return {
      id: createId("fp"),
      nickname: second ? `${first} + ${second}` : first,
      sessionToken: createSessionToken(),
      isHost,
      isOnline: true,
      isShared: Boolean(second),
      score: 0,
      note: "",
      surveyQuestions: [],
      surveyAnswers: [],
      votesReceived: 0,
      majorityHits: 0,
      authorAppearances: 0,
      authorTotalGuesses: 0,
      authorCorrectGuesses: 0,
    };
  }

  private validateNickname(nick: string) {
    if (!nick || nick.length < 2) throw new Error("שם קצר מדי — לפחות 2 תווים");
    if (nick.length > 20) throw new Error("שם ארוך מדי — עד 20 תווים");
  }
}
