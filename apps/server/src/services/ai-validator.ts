import type { AIValidationResult, CategoryDefinition, GameMode } from "@categories-game/shared";

// ─── Constants ────────────────────────────────────────────────────
const VALIDATION_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = `You are a strict, knowledgeable judge for the Israeli word game "ארץ עיר" (Countries and Cities), played in Hebrew.

Your task: for each player's submitted answer, decide whether it is a valid response for the stated category.

You must check exactly TWO things per answer:

1. EXISTENCE — Is this a real, recognized word, name, or entity?
   - It must actually exist in the real world or in Hebrew vocabulary.
   - Nonsense strings, random letters, or clearly made-up words → INVALID.
   - Accepted: common names, proper nouns, slang animal names, historical names.

2. CATEGORY FIT — Does this answer genuinely belong to the stated category?
   - "ארץ" / country: a real sovereign country, territory, or historically recognized nation.
   - "עיר" / city: a real city, town, or settlement anywhere in the world.
   - "חיה" / animal: any real animal species (common or scientific name, including colloquial Hebrew names).
   - "שם פרטי" / first name: a name used as a given name by real people.
   - "מקצוע" / profession: a recognized occupation or job title.
   - "צבע" / color: a real color name.
   - "פרי" / fruit: a real fruit.
   - For any other category: apply strict common sense — does this word genuinely belong?

Important rules:
- DO NOT check letter rule compliance (handled separately) — only judge existence and category fit.
- Be lenient with Hebrew spelling variations (ktiv male vs. haser, niqqud omission) of valid real things.
- An empty string is always INVALID (isCategoryFit: false, confidence: 1.0).
- When genuinely uncertain, set confidence below 0.7 but still provide your best judgment.
- Provide a short Hebrew reason (1 sentence) for each decision.

Return only valid JSON matching the provided schema.`.trim();

// ─── Types ────────────────────────────────────────────────────────
export interface SubmissionEntry {
  playerId: string;
  answers: Record<string, string>;
}

export interface BatchValidationResult {
  byPlayer: Map<string, AIValidationResult[]>;
  rawResponse: unknown;
}

// ─── Service ──────────────────────────────────────────────────────
export class AIValidatorService {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async validateAllSubmissions(input: {
    letter: string;
    mode: GameMode;
    categories: CategoryDefinition[];
    submissions: SubmissionEntry[];
  }): Promise<BatchValidationResult> {
    if (!this.apiKey) {
      return this.buildFallback(input.submissions, input.categories);
    }

    const userPayload = this.buildUserPayload(input);
    const schema = this.buildJsonSchema();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user",   content: JSON.stringify(userPayload) },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "categories_validation",
              schema,
            },
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "(unreadable)");
        throw new Error(`OpenAI API error ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const raw = (await response.json()) as Record<string, unknown>;
      const text = extractResponseText(raw);
      const parsed = JSON.parse(text) as {
        players: Array<{ playerId: string; answers: AIValidationResult[] }>;
      };

      const byPlayer = new Map<string, AIValidationResult[]>();
      for (const entry of parsed.players) {
        byPlayer.set(entry.playerId, entry.answers);
      }

      // Fill in any missing players with fallback
      for (const sub of input.submissions) {
        if (!byPlayer.has(sub.playerId)) {
          byPlayer.set(sub.playerId, this.fallbackForPlayer(sub.answers, input.categories));
        }
      }

      return { byPlayer, rawResponse: raw };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────

  private buildUserPayload(input: {
    letter: string;
    mode: GameMode;
    categories: CategoryDefinition[];
    submissions: SubmissionEntry[];
  }) {
    const ruleNote =
      input.mode === "classic"
        ? `The round letter is "${input.letter}". Answers should start with it, but DO NOT check this — only check existence and category fit.`
        : `The round letters are "${input.letter}". Answers should contain both, but DO NOT check this — only check existence and category fit.`;

    return {
      note: ruleNote,
      categories: input.categories.map((c) => ({ id: c.id, label: c.label })),
      players: input.submissions.map((sub) => ({
        playerId: sub.playerId,
        answers: Object.fromEntries(
          input.categories.map((cat) => [
            cat.id,
            { category: cat.label, answer: sub.answers[cat.id] ?? "" },
          ]),
        ),
      })),
    };
  }

  private buildJsonSchema() {
    const answerItem = {
      type: "object",
      additionalProperties: false,
      properties: {
        categoryId:    { type: "string"  },
        isCategoryFit: { type: "boolean" },
        confidence:    { type: "number"  },
        reason:        { type: "string"  },
      },
      required: ["categoryId", "isCategoryFit", "confidence", "reason"],
    };

    const playerEntry = {
      type: "object",
      additionalProperties: false,
      properties: {
        playerId: { type: "string" },
        answers:  { type: "array", items: answerItem },
      },
      required: ["playerId", "answers"],
    };

    return {
      type: "object",
      additionalProperties: false,
      properties: {
        players: { type: "array", items: playerEntry },
      },
      required: ["players"],
    };
  }

  private buildFallback(
    submissions: SubmissionEntry[],
    categories: CategoryDefinition[],
  ): BatchValidationResult {
    const byPlayer = new Map<string, AIValidationResult[]>();
    for (const sub of submissions) {
      byPlayer.set(sub.playerId, this.fallbackForPlayer(sub.answers, categories));
    }
    return { byPlayer, rawResponse: { fallback: true } };
  }

  private fallbackForPlayer(
    answers: Record<string, string>,
    categories: CategoryDefinition[],
  ): AIValidationResult[] {
    return categories.map((cat) => ({
      categoryId:    cat.id,
      isCategoryFit: (answers[cat.id] ?? "").trim().length > 0,
      confidence:    0.55,
      reason:        "בוצע fallback — מפתח AI לא מוגדר",
    }));
  }
}

// ─── Utilities ────────────────────────────────────────────────────
function extractResponseText(raw: Record<string, unknown>): string {
  const output = raw.output;
  if (!Array.isArray(output)) {
    throw new Error("AI response is missing the output array");
  }

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }

  throw new Error("AI response text block not found");
}
