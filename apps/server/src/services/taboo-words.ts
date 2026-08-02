// ─── Static fallback word bank ────────────────────────────────────────────────
export interface TabooCard {
  word: string;
  forbiddenWords: string[];
}

const WORD_BANK: TabooCard[] = [
  { word: "כדורגל", forbiddenWords: ["כדור", "שחקן", "שער", "ליגה", "מגרש"] },
  { word: "פיצה", forbiddenWords: ["אוכל", "גבינה", "עגבניה", "תנור", "איטלקי"] },
  { word: "כלב", forbiddenWords: ["חיה", "נביחה", "בית", "גור", "חיית מחמד"] },
  { word: "טלפון", forbiddenWords: ["שיחה", "סלולרי", "מסך", "אפליקציה", "אינטרנט"] },
  { word: "ירושלים", forbiddenWords: ["עיר", "ישראל", "בירה", "כותל", "עתיקה"] },
  { word: "מטוס", forbiddenWords: ["טיסה", "כנף", "נוסע", "שמיים", "שדה תעופה"] },
  { word: "קפה", forbiddenWords: ["שתייה", "בוקר", "חם", "ספל", "בית קפה"] },
  { word: "ים", forbiddenWords: ["מים", "גלים", "חוף", "שחייה", "דגים"] },
  { word: "תפוז", forbiddenWords: ["פרי", "צבע", "מיץ", "עץ", "ויטמין"] },
  { word: "מחשב", forbiddenWords: ["מקלדת", "מסך", "עכבר", "תוכנה", "אינטרנט"] },
  { word: "חתול", forbiddenWords: ["חיה", "מיאו", "פרווה", "חיית מחמד", "טפרים"] },
  { word: "רכבת", forbiddenWords: ["נסיעה", "פסים", "תחנה", "קרון", "מהירה"] },
  { word: "שוקולד", forbiddenWords: ["מתוק", "קקאו", "ממתק", "חום", "חלב"] },
  { word: "בית ספר", forbiddenWords: ["ילדים", "מורה", "שיעור", "כיתה", "לימוד"] },
  { word: "גשם", forbiddenWords: ["מים", "עננים", "מטריה", "סתיו", "קר"] },
  { word: "רופא", forbiddenWords: ["בריאות", "חולה", "בית חולים", "תרופה", "מקצוע"] },
  { word: "אריה", forbiddenWords: ["חיה", "אפריקה", "מלך", "ג'ונגל", "שיניים"] },
  { word: "פסנתר", forbiddenWords: ["מוזיקה", "מקשים", "נגינה", "כלי", "שיר"] },
  { word: "קוסם", forbiddenWords: ["קסם", "כובע", "ארנב", "מופע", "קלפים"] },
  { word: "שמש", forbiddenWords: ["חום", "אור", "כוכב", "קרניים", "שמיים"] },
  { word: "ספר", forbiddenWords: ["קריאה", "דפים", "כתיבה", "סופר", "ספרייה"] },
  { word: "בנק", forbiddenWords: ["כסף", "חשבון", "הלוואה", "כספומט", "בנקאי"] },
  { word: "חתונה", forbiddenWords: ["כלה", "חתן", "טבעת", "מסיבה", "נישואים"] },
  { word: "עץ", forbiddenWords: ["עלים", "שורש", "ענף", "יער", "עץ פרי"] },
  { word: "נעל", forbiddenWords: ["רגל", "גרב", "ריצה", "עור", "שרוך"] },
  { word: "דגל", forbiddenWords: ["מדינה", "צבע", "מוט", "סמל", "לאומי"] },
  { word: "מסעדה", forbiddenWords: ["אוכל", "תפריט", "מלצר", "שולחן", "ארוחה"] },
  { word: "סוס", forbiddenWords: ["רכיבה", "חווה", "רגליים", "ריצה", "חיה"] },
  { word: "שוטר", forbiddenWords: ["חוק", "מעצר", "ניידת", "מדים", "פשע"] },
  { word: "גן", forbiddenWords: ["צמח", "פרחים", "ירוק", "בחוץ", "גינה"] },
  { word: "כוס", forbiddenWords: ["שתייה", "זכוכית", "מים", "כלי", "שבירה"] },
  { word: "פרה", forbiddenWords: ["חלב", "חווה", "בשר", "קרניים", "חיה"] },
  { word: "מנורה", forbiddenWords: ["אור", "חשמל", "לילה", "נורה", "כבה"] },
  { word: "שקית", forbiddenWords: ["פלסטיק", "קניות", "כיס", "נשיאה", "אריזה"] },
  { word: "נחש", forbiddenWords: ["זוחל", "ארס", "עור", "לשון", "מדבר"] },
  { word: "מטבח", forbiddenWords: ["בישול", "אוכל", "תנור", "קדירה", "שף"] },
  { word: "מצלמה", forbiddenWords: ["תמונה", "צילום", "עדשה", "פלאש", "פוטוגרף"] },
  { word: "אוניברסיטה", forbiddenWords: ["לימודים", "תואר", "סטודנט", "קמפוס", "מרצה"] },
  { word: "גשר", forbiddenWords: ["נהר", "מעבר", "בנייה", "מים", "כביש"] },
  { word: "כיסא", forbiddenWords: ["ישיבה", "רגליים", "שולחן", "ריפוד", "משרד"] },
  { word: "פרפר", forbiddenWords: ["חרק", "כנפיים", "פרח", "זחל", "עפיפון"] },
  { word: "עירייה", forbiddenWords: ["עיר", "ראש עיר", "ממשל", "תושבים", "שירותים"] },
  { word: "מזוודה", forbiddenWords: ["נסיעה", "טיול", "בגדים", "מטוס", "ידית"] },
  { word: "שטיח", forbiddenWords: ["רצפה", "בד", "שכיבה", "ספה", "כרבולת"] },
  { word: "יוגה", forbiddenWords: ["ספורט", "מדיטציה", "גמישות", "מחצלת", "נשימה"] },
  { word: "מגדלור", forbiddenWords: ["ים", "אור", "ספינה", "חוף", "גבוה"] },
  { word: "גלידה", forbiddenWords: ["מתוק", "קר", "קרם", "קורנט", "וניל"] },
  { word: "נהר", forbiddenWords: ["מים", "זרם", "גדה", "דגים", "גשר"] },
  { word: "כפפות", forbiddenWords: ["יד", "קור", "אצבעות", "בד", "קיקבוקסינג"] },
  { word: "כוכב", forbiddenWords: ["שמיים", "לילה", "אור", "חלל", "מרחק"] },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── AI word generation ───────────────────────────────────────────────────────

const CATEGORIES = ["חיות", "אוכל ושתייה", "ספורט", "ישראל", "טכנולוגיה", "טבע", "מקצועות", "מקומות"];

const SYSTEM_PROMPT = `You generate Hebrew Taboo game cards.
Each card has a Hebrew word to guess and exactly 5 forbidden words in Hebrew (words the explainer cannot say).
The forbidden words should be the most obvious, direct words someone would use to explain the target word.
Return valid JSON only — no extra text.`.trim();

export async function generateTabooWords(
  count: number,
  apiKey: string,
  model: string,
): Promise<TabooCard[]> {
  if (!apiKey) return getFallback(count);

  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const userPrompt = `Generate ${count} Hebrew Taboo cards in the category: "${category}".`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      cards: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            word:         { type: "string" },
            forbiddenWords: { type: "array", items: { type: "string" } },
          },
          required: ["word", "forbiddenWords"],
        },
      },
    },
    required: ["cards"],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: userPrompt },
        ],
        text: { format: { type: "json_schema", name: "taboo_cards", schema } },
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) throw new Error(`OpenAI ${response.status}`);

    const raw = (await response.json()) as Record<string, unknown>;
    const text = extractText(raw);
    const parsed = JSON.parse(text) as { cards: TabooCard[] };

    if (!Array.isArray(parsed.cards) || parsed.cards.length === 0) {
      return getFallback(count);
    }

    // Ensure each card has exactly 5 forbidden words
    return parsed.cards.slice(0, count).map((c) => ({
      word: c.word,
      forbiddenWords: (c.forbiddenWords ?? []).slice(0, 5),
    }));
  } catch {
    return getFallback(count);
  }
}

function getFallback(count: number): TabooCard[] {
  return shuffle(WORD_BANK).slice(0, count);
}

function extractText(raw: Record<string, unknown>): string {
  const output = raw.output;
  if (!Array.isArray(output)) throw new Error("Missing output");
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
  throw new Error("Text block not found");
}
