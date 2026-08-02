// AI question generation for "מי מהמשפחה?".
//
// This never replaces content.ts — it is an alternative pool the host can pick
// in the lobby. Any failure (no key, timeout, bad JSON, too few questions)
// falls silently back to the file and the game continues exactly as it would
// have.
//
// There are two calls, because the material arrives at two different moments:
//
//   1. In the lobby — survey questions, from the host's description of the
//      family. Nobody is waiting on a timer yet.
//   2. At the end of the survey — the "מי הכי סביר" statements and the number
//      questions, now that we can also read what everyone actually wrote. This
//      one is capped hard, because a round is about to start.

export interface SurveyAnswerMaterial {
  nickname: string;
  question: string;
  answer: string;
}

export interface GeneratedRounds {
  mostLikely: string[];
  numberQuestions: string[];
}

// ─── Shared rules ────────────────────────────────────────────────────────────

const CONTEXT = `
You write content for a Hebrew party game called "מי מהמשפחה?" played by a family
in a living room — grandparents, parents, teenagers and children all in the same
room, reading the questions out loud to each other.
`.trim();

const SAFETY = `
════════ HARD SAFETY RULES ════════

This game is played by a HAREDI (ultra-Orthodox Jewish) family, three
generations in one room — grandparents, parents and children together. The
standard is not "inoffensive"; it is content that would be entirely at home at
a Shabbos table. When in doubt, leave it out. A single wrong item ends the
evening and cannot be taken back.

ABSOLUTELY FORBIDDEN — never allude to, hint at, or joke around:
  • anything sexual, romantic, or physical between people — no dating, no
    matchmaking beyond nothing, no exes, no marriage tension, no flirting,
    no attraction, no body parts
  • anything touching emunah — no questioning faith, no doubting Torah or
    mitzvos, no "what if" about Hashem, no theological speculation, nothing
    that could read as kefira, no mocking rabbonim, halacha or observance
  • non-kosher food of any kind, or mixing meat and milk
  • Shabbos or Yom Tov violation — no driving, phones, money, cooking, writing
    or shopping on Shabbos, not even hypothetically or as a joke
  • television, movies, secular music, celebrities, sports stars, video games
  • immodesty — never about a woman's appearance, clothing, hair or body;
    never about mixed-gender company
  • gambling, alcohol beyond a normal kiddush, smoking, anything illegal

ALSO FORBIDDEN, as in any family game:
  • money, salary, debt, what something cost, who paid
  • weight, body size, looks, dieting
  • health, illness, medication, death, or anyone who has passed away
  • politics and elections
  • how observant someone is, or comparing anyone's level in ruchniyus
  • school grades, career failure, being unemployed, shidduchim
  • any real conflict or sore point that could restart an argument

WHAT IS WELCOME — this is where the humour lives:
  the Shabbos and Yom Tov table, zemiros, cholent, the Friday rush, hosting
  guests, Pesach cleaning, the Seder, Sukkah building, Purim costumes and
  mishloach manos, Chanukah candles, the kitchen, shopping before Shabbos,
  waking up for davening, kids and grandchildren, family trips, lost keys and
  glasses, being early or late, tidiness and mess, leftovers, who talks the
  most, who falls asleep first.

Tease habits and quirks, never a person's worth and never their Yiddishkeit.
If anything you were told about this family falls into a forbidden category,
silently ignore that detail — do not work around it, do not soften it, drop it.
`.trim();

const HEBREW = `
════════ HEBREW LANGUAGE RULES ════════
  • Write natural, spoken Hebrew — the way an Israeli family actually talks.
  • Stay gender-neutral. Never write הוא/היא, שלו/שלה, or endings that pick a
    gender for the person being guessed.
  • No English words, no transliteration, no emoji.
  • One line each. Never repeat an item or write two that mean the same thing.
  • Short enough to read at a glance, on a phone, by a 70-year-old.
  • Proofread every sentence before returning it. It must be grammatically
    correct Hebrew that a native speaker would say out loud without stumbling.
    Check that no word is missing — especially the subject pronoun. Reject and
    rewrite anything that reads awkwardly, is missing a word, or contains an
    invented word. Correctness matters more than cleverness: if you cannot
    phrase an idea in clean Hebrew, write a simpler question instead.

Return valid JSON only, matching the schema. No commentary.
`.trim();

function familyBlock(description: string, fallbackNote: string) {
  const text = description.trim();
  if (!text) return fallbackNote;
  return `
The players described their own family in the lobby. Each line is one player,
written by them, in the form "name: what they wrote":

"""
${text}
"""

Use all of it. These are different points of view — when two players mention
the same habit, that is your strongest material. Write questions that could
only have been written for THESE people: reference the habits, roles and
running jokes above, by name where a name was given. A question that would
work for any family is a wasted question.
Still obey every safety rule: if someone wrote something from the forbidden
list, leave that part alone.`.trim();
}

const GENERIC_NOTE = `
Nobody wrote anything about the family, so write questions that work for any
Israeli family: everyday household life, food, phones, holidays, driving,
shopping, sleep, and small domestic habits.`.trim();

/**
 * Same family, same description, same prompt would produce nearly the same
 * questions every time. A rotating angle plus the room's history is what makes
 * a rematch feel like a different game.
 */
const ANGLES = [
  "סעודות שבת והשולחן",
  "ההכנות לשבת ביום שישי",
  "פסח — הניקיונות והסדר",
  "סוכות, פורים וחנוכה",
  "המטבח, הבישולים והאורחים",
  "הבית — סדר, בלגן ותיקונים שלא נעשו",
  "בקרים, השכמה ותפילה בזמן",
  "קניות לשבת ולחגים",
  "נסיעות וטיולים משפחתיים",
  "ילדות, זיכרונות וסיפורים מהסבים",
];

function varietyBlock(usedQuestions: string[]) {
  const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
  const recent = usedQuestions.slice(-40);

  const avoid = recent.length
    ? `

This family has played before. These questions were already used — do not
repeat them, and do not write anything that means roughly the same thing:

"""
${recent.join("\n")}
"""`
    : "";

  return `
For variety between games, make sure at least two items this time touch on:
${angle}. Keep the overall spread across the axes above.${avoid}`.trim();
}

// ─── Call 1 — survey questions (lobby) ───────────────────────────────────────

const SURVEY_PROMPT = `
${CONTEXT}

You are writing the OPENING SURVEY. Each player privately writes a short answer
about THEMSELVES (up to 80 characters). Later in the game one answer is shown
anonymously and everyone guesses who wrote it.

FORMAT: write each item as a short first-person noun phrase describing what the
player should write about — a label, not a full question. No question mark.
  GOOD: "כישרון נסתר שיש לי"
  GOOD: "הפחד הכי מטופש שלי"
  GOOD: "הדבר שאני הכי גרוע בו במטבח"
  BAD:  "מה הכישרון הנסתר שלך?"        (a full question — wrong shape)

NEVER use a question mark, and NEVER begin an item with an interrogative word:
מה / איך / למה / מתי / כמה / איזה / עם מי / איפה. If an item starts with one of
those, you have written a question instead of a label — rewrite it.
  BAD:  "איך אתה מגיב כשמשנים תוכניות?"
  GOOD: "התגובה שלי כשמשנים תוכניות ברגע האחרון"

A good item is:
  • answerable in one short line
  • produces an answer that is guessable but not instantly obvious
  • cheerful or amusing — NEVER confessional
  BAD: "הדבר הכי מביך שקרה לי"
       (invites answers that do not belong at a mixed family table)
  BAD: "המאכל שאני אוהב"               (too plain — everyone answers the same)

CRITICAL — every question is handed out at random, and you do not know who will
receive it. So each one must be answerable by EVERY member of the family.
Address the reader as "אתה" and ask about THEM.
    BAD:  "מתי נתפסת בודק מייל באמצע ארוחה?"   (only one person does this)
    BAD:  "איך זה מרגיש כשמשנים לך את הרשימה?"  (aimed at one person)
    GOOD: "מה הכי מעצבן אותך כשמשנים תוכניות ברגע האחרון?"

EQUALLY CRITICAL — never state, imply, or assume that a NAMED person has a
particular habit or flaw. The whole game is built on the family arguing about
who is like that; if your question announces the answer, you have spoiled a
later round before it started.
    BAD: "מה הקנייה הכי מיותרת שיוסי התעקש לעשות?"
         (declares that יוסי buys useless things — nobody voted on that)
    BAD: "מה מיכל תמיד שוכחת למרות הרשימות?"
         (declares that מיכל forgets things)

Use the notes for SETTING and VOCABULARY — the situations this family actually
lives in, the places, the objects, the running jokes — never for verdicts about
who is what. If the notes talk about arguments over shopping, write about
shopping. Do not write about who wins the arguments.
    GOOD: "מה הדבר האחרון שקנית והתחרטת עליו?"
    GOOD: "מה תמיד נשכח ברשימת הקניות שלכם?"

You may mention a name only for a neutral shared fact nobody would dispute
("מה אתם תמיד אוכלים בשישי אצל סבתא רחל?"), never for a judgement.

${SAFETY}

${HEBREW}
`.trim();

const SURVEY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { surveyQuestions: { type: "array", items: { type: "string" } } },
  required: ["surveyQuestions"],
};

export async function generateSurveyQuestions(
  count: number,
  familyDescription: string,
  usedQuestions: string[],
  apiKey: string,
  model: string,
): Promise<string[] | null> {
  if (!apiKey) return null;

  // Ask for extra so we can drop anything that came back question-shaped and
  // still hand out a full set.
  const asked = count + 4;

  const user = `
Write ${asked} survey items for one game. All ${asked} must be different from
each other — every player gets their own, and no two players should ever
receive the same item.

${familyBlock(familyDescription, GENERIC_NOTE)}

${varietyBlock(usedQuestions)}
`.trim();

  const parsed = await callOpenAi(apiKey, model, SURVEY_PROMPT, user, SURVEY_SCHEMA, "family_survey", 25_000);
  if (!parsed) return null;

  const all = clean(parsed.surveyQuestions, asked);
  const labels = all.filter((q) => !looksLikeQuestion(q));

  // Prefer the label-shaped ones, then top up from the rest rather than
  // shipping a short list — a question still plays fine, it is just less tidy.
  const chosen = [...labels, ...all.filter((q) => looksLikeQuestion(q))].slice(0, count);
  return chosen.length >= 2 ? chosen : null;
}

const INTERROGATIVE = /^(מה|איך|למה|מתי|כמה|איזה|איזו|היכן|איפה|עם מי|מי)\b/;

/** Survey items should be first-person labels, not questions. */
function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return t.includes("?") || INTERROGATIVE.test(t);
}

// ─── Call 2 — round questions (end of survey) ────────────────────────────────

const ROUNDS_PROMPT = `
${CONTEXT}

You are writing two kinds of round. Read the rules for each carefully.

════════ "mostLikely" — מי הכי סביר ... ════════
The screen shows the fixed opening "מי הכי סביר" and then your item. Everyone
votes for the family member it fits best. There is no correct answer — the fun
is the argument afterwards.

FORMAT — this is the single most important rule:
Write ONLY the completion, in the INFINITIVE (ל+verb). Do not write the opening
words, do not add a question mark, do not write a full sentence.
The infinitive carries no gender and no number, so one item fits a grandmother,
an uncle and an eight-year-old equally. ANY other verb form genders the item and
breaks it for half the family.
  GOOD:  "להירדם על הספה אחרי סעודת ליל שבת"
  BAD:   "נרדם על הספה"                (past tense, masculine only)
  BAD:   "שיירדם על הספה"              (finite verb, masculine only)
  BAD:   "מי שנרדם על הספה"            (a full clause, does not complete the opening)
  BAD:   "מי הכי סביר להירדם על הספה"  (do not repeat the opening)

LENGTH: 4 to 9 words. It must be readable at a glance, on a phone, by a
70-year-old.

CONTENT: an observable behaviour that produces instant recognition around the
table. If you cannot picture the moment, delete it.
  BAD: "מי הכי נחמד"                   (abstract, not a scene)
  BAD: "לזכות בפרס נובל"               (fits nobody)
  BAD: "להיות הכי עצלן"                (an insult, not a scene)

SPREAD the items roughly evenly across these axes:
  • the rhythm of שבת and חגים — the meal, the זמירות, the פלטה, the Friday rush
  • Yom Tov preparation — Pesach cleaning, the Seder, building the Sukkah,
    Purim costumes and mishloach manos, Chanukah candles
  • universal household oddities — lost keys, glasses on the head, leftovers
  • the kitchen and hosting guests
  • timing and lateness — davening, the meal, leaving the house
  • generational habits — hoarding plastic bags, calling instead of texting
  • warm traits — first to clear the table, most excited by a small gift

CRITICAL — the vote must be a real argument. A statement is WORTHLESS if the
family already knows the answer, and there are two ways you can ruin it:

1. Never name a person inside the statement. Not as the answer, not as the
   object. Any name narrows the vote.
   BAD: "מי הכי סביר שיתווכח עם יוסי?"   (now it is about יוסי, not about us)

2. Never turn something a player already told us into a statement. If someone
   wrote "אני מארגנת הכל ברשימות", then "מי הכי סביר שיכין רשימה?" is a dead
   round — everyone votes for her, there is nothing to discuss. The same goes
   for anything the survey questions or survey answers already established.
   Those are settled facts. Settled facts make bad votes.

So use the notes for the WORLD this family lives in — their situations, their
objects, their kind of evening — and then write a behaviour that at least three
of them could plausibly be guilty of.
   Notes mention fighting over dishes and a crowded Friday dinner
   BAD:  "מי הכי סביר שיתחמק משטיפת כלים?"     (already established, dead vote)
   GOOD: "מי הכי סביר שיתחיל לפנות את השולחן לפני שכולם סיימו לאכול?"
   GOOD: "מי הכי סביר שיישבע שהוא מלא ואז יאכל עוד קינוח?"

════════ "numberQuestions" — מה המספר? ════════
CRITICAL: this question is shown privately to ONE player, and it asks about
THAT PLAYER THEMSELVES. Address them directly as "אתה". It must never ask about
another family member, and never about the family as a group — the person
reading it is the only one who can answer it.

Write a mix of two flavours, roughly half and half:
  • "live"     — the reader can check the answer on their phone right now
                 "כמה אחוזי סוללה יש לך עכשיו?"
  • "personal" — a fact the reader knows about themselves from memory
                 "כמה שנים אתה נוהג?"

Both require ONE exact whole number, realistically between 0 and about 100.
REJECT anything answered by a range, anything nobody truly knows, and anything
that could embarrass: never number of children, salary, weight, or age.
GOOD:  "כמה כוסות קפה אתה שותה ביום רגיל?"
BAD:   "כמה דקות סבתא רחל מאחרת?"          (about someone else — breaks the round)
BAD:   "כמה ויכוחים היו במשפחה השבוע?"     (about the group — nobody owns the answer)
BAD:   "כמה כוכבים יש בגלקסיה?"            (nobody knows, guessing is random)
BAD:   "כמה ילדים יש לך?"                  (forbidden)

${SAFETY}

${HEBREW}
`.trim();

const ROUNDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    mostLikely: { type: "array", items: { type: "string" } },
    numberQuestions: { type: "array", items: { type: "string" } },
  },
  required: ["mostLikely", "numberQuestions"],
};

export async function generateRoundQuestions(
  counts: { mostLikely: number; numbers: number },
  familyDescription: string,
  material: SurveyAnswerMaterial[],
  usedQuestions: string[],
  apiKey: string,
  model: string,
  timeoutMs = 10_000,
): Promise<GeneratedRounds | null> {
  if (!apiKey) return null;

  const transcript = material
    .filter((m) => m.answer.trim().length > 0)
    .map((m) => `${m.nickname} — "${m.question}" → "${m.answer}"`)
    .join("\n");

  const materialBlock = transcript
    ? `
The players just answered the opening survey. This is what they wrote about
themselves, in their own words:

"""
${transcript}
"""

This is your best material — it is more current and more specific than any
description. Mine it for habits, running jokes and small confessions, and build
questions around them. Do not quote an answer word for word; the same answers
are used elsewhere in the game and quoting them would spoil that round.`
    : "The survey produced no usable answers, so rely on the description alone.";

  const user = `
Write ${counts.mostLikely} "mostLikely" statements and ${counts.numbers} "numberQuestions" for one game.

${familyBlock(familyDescription, GENERIC_NOTE)}

${materialBlock}

${varietyBlock(usedQuestions)}
`.trim();

  const parsed = await callOpenAi(apiKey, model, ROUNDS_PROMPT, user, ROUNDS_SCHEMA, "family_rounds", timeoutMs);
  if (!parsed) return null;

  const result: GeneratedRounds = {
    mostLikely: clean(parsed.mostLikely, counts.mostLikely),
    numberQuestions: clean(parsed.numberQuestions, counts.numbers),
  };

  // A thin response is worse than the curated file — treat it as a failure.
  return result.mostLikely.length >= 2 ? result : null;
}

// ─── Plumbing ────────────────────────────────────────────────────────────────

async function callOpenAi(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  schema: object,
  schemaName: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        text: { format: { type: "json_schema", name: schemaName, schema } },
      }),
    });

    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const raw = (await response.json()) as Record<string, unknown>;
    return JSON.parse(extractText(raw)) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Trim, drop empties and duplicates, cap length. */
function clean(items: unknown, max: number): string[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== "string") continue;
    const text = raw.trim().replace(/\s+/g, " ");
    if (text.length < 8 || text.length > 160) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
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
