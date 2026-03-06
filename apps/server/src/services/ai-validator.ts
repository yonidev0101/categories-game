import type { AIValidationBatchResult, AIValidationResult, CategoryDefinition, GameMode } from "@categories-game/shared";

interface ValidateBatchInput {
  letter: string;
  mode: GameMode;
  categories: CategoryDefinition[];
  answers: Record<string, string>;
}

export class AIValidatorService {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async validateBatch(input: ValidateBatchInput): Promise<{ results: AIValidationResult[]; rawResponse: unknown }> {
    if (!this.apiKey) {
      const fallback = input.categories.map((category) => ({
        categoryId: category.id,
        isCategoryFit: (input.answers[category.id] ?? "").trim().length > 0,
        confidence: 0.55,
        reason: "בוצע fallback דטרמיניסטי ללא ספק AI פעיל"
      }));

      return { results: fallback, rawResponse: { fallback: true } };
    }

    const prompt = {
      system: "You validate a Hebrew Categories Game answer sheet. Return strict JSON only.",
      instructions: {
        requiredLetters: input.mode === "advanced" ? input.letter.split("+").map((item) => item.trim()) : [input.letter],
        mode: input.mode,
        categories: input.categories,
        answers: input.answers,
        output: {
          answers: [
            {
              categoryId: "string",
              isCategoryFit: true,
              confidence: 0.0,
              reason: "short Hebrew explanation"
            }
          ]
        }
      }
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: JSON.stringify(prompt),
        text: {
          format: {
            type: "json_schema",
            name: "categories_validation",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                answers: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      categoryId: { type: "string" },
                      isCategoryFit: { type: "boolean" },
                      confidence: { type: "number" },
                      reason: { type: "string" }
                    },
                    required: ["categoryId", "isCategoryFit", "confidence", "reason"]
                  }
                }
              },
              required: ["answers"]
            }
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`AI validation failed with status ${response.status}`);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const text = extractResponseText(raw);
    const parsed = JSON.parse(text) as AIValidationBatchResult;
    return { results: parsed.answers, rawResponse: raw };
  }
}

function extractResponseText(raw: Record<string, unknown>): string {
  const output = raw.output;
  if (!Array.isArray(output)) {
    throw new Error("AI response does not contain output array");
  }

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const maybeText = (part as { text?: unknown }).text;
      if (typeof maybeText === "string") {
        return maybeText;
      }
    }
  }

  throw new Error("AI response text was not found");
}


