import type { AIValidationResult, CategoryDefinition, GameMode } from "@categories-game/shared";

// ─── Constants ────────────────────────────────────────────────────
const VALIDATION_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = `You are a judge for the Hebrew word game "ארץ עיר" (Categories).

TASK: For each submitted answer, decide if it genuinely belongs to its stated category.

RULES:
- Check ONLY category membership. Letter/spelling rules are enforced elsewhere — ignore them completely.
- Be lenient: accept Hebrew spelling variations (כתיב מלא/חסר), nicknames, slang names, and common transliterations of real things.
- Accept well-known proper nouns, colloquial animal names, historical entities, and recognized slang.
- Empty or gibberish answers are invalid.
- When in doubt (60%+ confidence it fits) → mark valid. Err on the side of the player.

CATEGORY REFERENCE (covers most common categories; use common sense for others):
- ארץ / מדינה: any real sovereign state, territory, or historically recognized nation.
- עיר / יישוב / כפר: any real city, town, village, or settlement, anywhere in the world.
- חיה / חי / בעל חיים: any real animal — mammals, birds, fish, insects, reptiles — common Hebrew name or scientific name accepted.
- צמח / צומח / עץ / פרח: any real plant, tree, shrub, flower, or vegetation.
- דומם: any inanimate object, material, substance, or physical thing.
- ילד / שם ילד / שם פרטי זכר: a name used for boys/men in Hebrew or Israeli culture.
- ילדה / שם ילדה / שם פרטי נקבה: a name used for girls/women in Hebrew or Israeli culture.
- מקצוע / עבודה: any recognized job, occupation, or profession.
- צבע: any real color name.
- פרי / ירק: any real fruit or vegetable.
- For any other category: strict common sense — does this word or phrase genuinely belong?

OUTPUT: valid JSON per schema. Reason must be a single short sentence in Hebrew.`.trim();

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
    // Map category id → Hebrew label (sent once, not per player/answer)
    const categoryLabels = Object.fromEntries(input.categories.map((c) => [c.id, c.label]));

    return {
      categories: categoryLabels,
      players: input.submissions.map((sub) => ({
        playerId: sub.playerId,
        // Only include non-empty answers; empty ones are auto-invalid in scoring
        answers: Object.fromEntries(
          input.categories
            .map((cat) => [cat.id, (sub.answers[cat.id] ?? "").trim()] as [string, string])
            .filter(([, answer]) => answer.length > 0),
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
