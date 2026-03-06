import { DEFAULT_CATEGORIES, HEBREW_LETTERS } from "./categories";
import type {
  AIValidationResult,
  CategoryDefinition,
  GameMode,
  PlayerSummary,
  RoomSettings,
  ScoreBreakdown,
  ValidatedAnswer
} from "./types";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  roundsCount: 5,
  countdownSeconds: 10,
  roundTimeSeconds: 90,
  mode: "classic",
  categories: DEFAULT_CATEGORIES
};

export function createRoomCode(length = 6): string {
  return Array.from({ length }, () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]).join("");
}

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createSessionToken(): string {
  return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
}

export function pickRoundLetter(): string {
  return HEBREW_LETTERS[Math.floor(Math.random() * HEBREW_LETTERS.length)];
}

export function pickRoundLetters(mode: GameMode): string[] {
  if (mode === "classic") {
    return [pickRoundLetter()];
  }

  const firstIndex = Math.floor(Math.random() * HEBREW_LETTERS.length);
  let secondIndex = Math.floor(Math.random() * HEBREW_LETTERS.length);
  while (secondIndex === firstIndex) {
    secondIndex = Math.floor(Math.random() * HEBREW_LETTERS.length);
  }

  return [HEBREW_LETTERS[firstIndex], HEBREW_LETTERS[secondIndex]];
}

export function formatRoundLetters(letters: string[]): string {
  return letters.join(" + ");
}

export function normalizeAnswer(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("he");
}

function parseRequiredLetters(letter: string, mode: GameMode): string[] {
  if (mode === "classic") {
    return [letter.trim().toLocaleLowerCase("he")].filter(Boolean);
  }

  return letter
    .split("+")
    .map((item) => item.trim().toLocaleLowerCase("he"))
    .filter(Boolean);
}

export function validateAnswerByMode(answer: string, letter: string, mode: GameMode): { valid: boolean; reason: string } {
  const normalized = normalizeAnswer(answer);
  const requiredLetters = parseRequiredLetters(letter, mode);

  if (!normalized) {
    return { valid: false, reason: "לא הוזנה תשובה" };
  }

  if (mode === "classic") {
    const [requiredLetter] = requiredLetters;
    if (!requiredLetter || !normalized.startsWith(requiredLetter)) {
      return { valid: false, reason: `התשובה חייבת להתחיל באות ${letter}` };
    }

    return { valid: true, reason: "התשובה עומדת בכלל האות" };
  }

  const missingLetters = requiredLetters.filter((requiredLetter) => !normalized.includes(requiredLetter));
  if (missingLetters.length > 0) {
    return { valid: false, reason: `התשובה חייבת להכיל את האותיות ${letter}` };
  }

  return { valid: true, reason: "התשובה עומדת בכלל שתי האותיות" };
}

export function buildPlayerProgress(answerMap: Record<string, string>, categories: CategoryDefinition[]): number {
  return categories.filter((category) => normalizeAnswer(answerMap[category.id] ?? "").length > 0).length;
}

export function mergeSettings(input?: Partial<RoomSettings>): RoomSettings {
  return {
    ...DEFAULT_ROOM_SETTINGS,
    ...input,
    categories: input?.categories?.length ? input.categories : DEFAULT_ROOM_SETTINGS.categories
  };
}

export function scoreAnswers(params: {
  answers: Record<string, string>;
  aiResults: AIValidationResult[];
  categories: CategoryDefinition[];
  letter: string;
  mode: GameMode;
  duplicateMap: Map<string, number>;
  categoryPresenceMap: Map<string, number>;
}): ValidatedAnswer[] {
  const aiMap = new Map(params.aiResults.map((item) => [item.categoryId, item]));

  return params.categories.map((category) => {
    const answer = params.answers[category.id] ?? "";
    const normalizedAnswer = normalizeAnswer(answer);
    const ruleResult = validateAnswerByMode(answer, params.letter, params.mode);
    const aiResult = aiMap.get(category.id);
    const isCategoryFit = aiResult?.isCategoryFit ?? ruleResult.valid;
    const isValid = ruleResult.valid && isCategoryFit;
    const isDuplicate = normalizedAnswer.length > 0 && (params.duplicateMap.get(`${category.id}:${normalizedAnswer}`) ?? 0) > 1;
    const answeredCount = params.categoryPresenceMap.get(category.id) ?? 0;
    const score = !isValid ? 0 : answeredCount <= 1 ? 15 : isDuplicate ? 5 : 10;

    return {
      categoryId: category.id,
      answer,
      normalizedAnswer,
      isRuleValid: ruleResult.valid,
      isCategoryFit,
      isValid,
      isDuplicate,
      score,
      reason: !ruleResult.valid ? ruleResult.reason : aiResult?.reason ?? "התשובה אושרה",
      confidence: aiResult?.confidence ?? (ruleResult.valid ? 0.8 : 1)
    };
  });
}

export function totalScore(breakdown: ValidatedAnswer[]): number {
  return breakdown.reduce((sum, item) => sum + item.score, 0);
}

export function rankPlayers<T extends PlayerSummary>(players: T[]): T[] {
  return [...players].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, "he"));
}

export function computeDuplicateMap(submissions: Array<Record<string, string>>, categories: CategoryDefinition[]): Map<string, number> {
  const duplicateMap = new Map<string, number>();

  for (const answers of submissions) {
    for (const category of categories) {
      const normalizedAnswer = normalizeAnswer(answers[category.id] ?? "");
      if (!normalizedAnswer) {
        continue;
      }

      const key = `${category.id}:${normalizedAnswer}`;
      duplicateMap.set(key, (duplicateMap.get(key) ?? 0) + 1);
    }
  }

  return duplicateMap;
}

export function computeCategoryPresenceMap(
  submissions: Array<Record<string, string>>,
  categories: CategoryDefinition[]
): Map<string, number> {
  const presenceMap = new Map<string, number>();

  for (const category of categories) {
    presenceMap.set(
      category.id,
      submissions.reduce((count, answers) => count + (normalizeAnswer(answers[category.id] ?? "") ? 1 : 0), 0)
    );
  }

  return presenceMap;
}

export function createEmptyScoreBreakdown(playerId: string, roundNumber: number): ScoreBreakdown {
  return {
    playerId,
    roundNumber,
    totalScore: 0,
    answers: []
  };
}
