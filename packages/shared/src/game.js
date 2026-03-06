import { DEFAULT_CATEGORIES, HEBREW_LETTERS } from "./categories";
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const DEFAULT_ROOM_SETTINGS = {
    roundsCount: 5,
    countdownSeconds: 15,
    roundTimeSeconds: 90,
    mode: "classic",
    categories: DEFAULT_CATEGORIES
};
export function createRoomCode(length = 6) {
    return Array.from({ length }, () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]).join("");
}
export function createId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
export function createSessionToken() {
    return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}`;
}
export function pickRoundLetter() {
    return HEBREW_LETTERS[Math.floor(Math.random() * HEBREW_LETTERS.length)];
}
export function normalizeAnswer(value) {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("he");
}
export function validateAnswerByMode(answer, letter, mode) {
    const normalized = normalizeAnswer(answer);
    const normalizedLetter = letter.toLocaleLowerCase("he");
    if (!normalized) {
        return { valid: false, reason: "�� ����� �����" };
    }
    if (mode === "classic") {
        if (!normalized.startsWith(normalizedLetter)) {
            return { valid: false, reason: `������ ����� ������ ���� ${letter}` };
        }
        return { valid: true, reason: "������ ����� ���� ����" };
    }
    const occurrences = [...normalized].filter((char) => char === normalizedLetter).length;
    if (occurrences < 2) {
        return { valid: false, reason: `������ ����� ����� �� ���� ${letter} ����� ������` };
    }
    return { valid: true, reason: "������ ����� ���� ���� �������" };
}
export function buildPlayerProgress(answerMap, categories) {
    return categories.filter((category) => normalizeAnswer(answerMap[category.id] ?? "").length > 0).length;
}
export function mergeSettings(input) {
    return {
        ...DEFAULT_ROOM_SETTINGS,
        ...input,
        categories: input?.categories?.length ? input.categories : DEFAULT_ROOM_SETTINGS.categories
    };
}
export function scoreAnswers(params) {
    const aiMap = new Map(params.aiResults.map((item) => [item.categoryId, item]));
    return params.categories.map((category) => {
        const answer = params.answers[category.id] ?? "";
        const normalizedAnswer = normalizeAnswer(answer);
        const ruleResult = validateAnswerByMode(answer, params.letter, params.mode);
        const aiResult = aiMap.get(category.id);
        const isCategoryFit = aiResult?.isCategoryFit ?? ruleResult.valid;
        const isValid = ruleResult.valid && isCategoryFit;
        const isDuplicate = normalizedAnswer.length > 0 && (params.duplicateMap.get(`${category.id}:${normalizedAnswer}`) ?? 0) > 1;
        const score = !isValid ? 0 : isDuplicate ? 5 : 10;
        return {
            categoryId: category.id,
            answer,
            normalizedAnswer,
            isRuleValid: ruleResult.valid,
            isCategoryFit,
            isValid,
            isDuplicate,
            score,
            reason: !ruleResult.valid ? ruleResult.reason : aiResult?.reason ?? "������ �����",
            confidence: aiResult?.confidence ?? (ruleResult.valid ? 0.8 : 1)
        };
    });
}
export function totalScore(breakdown) {
    return breakdown.reduce((sum, item) => sum + item.score, 0);
}
export function rankPlayers(players) {
    return [...players].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, "he"));
}
export function computeDuplicateMap(submissions, categories) {
    const duplicateMap = new Map();
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
export function createEmptyScoreBreakdown(playerId, roundNumber) {
    return {
        playerId,
        roundNumber,
        totalScore: 0,
        answers: []
    };
}
