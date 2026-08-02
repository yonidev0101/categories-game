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
  • Stay gender-neutral — the same item is read by a grandmother and by an
    eight-year-old boy. Never write הוא/היא, שלו/שלה, אתה/את, or a present-tense
    verb, because Hebrew present tense always picks a gender.
    Use instead, all of which are spelled identically for both genders:
      – past tense:   "כמה כוסות קפה שתית אתמול" (not "אתה שותה")
      – future tense: "המאכל שלא אטעם בשום מצב" (not "שאני מסרב לטעום")
      – infinitive:   "להירדם על הספה"
      – "יש לך" / "אצלך" / "שלי" / a plain noun phrase with no verb at all
    Check every single item for this before returning it. A gendered item is
    simply wrong for half the family.
  • No English words, no transliteration, no emoji.
  • One line each. Never repeat an item or write two that mean the same thing.
  • Short enough to read at a glance, on a phone, by a 70-year-old.

════════ CLARITY — the most common way these items fail ════════
Every item must land the first time it is read, out loud, by anyone in the room.
People are looking at a phone with a timer running; they will not re-read.

  • ONE idea per item. One clause. If you need the word "ש" twice, or "וגם",
    or "למרות ש", or "אבל" — you have written two items. Split or delete.
  • Plain everyday Hebrew a child and a grandparent both use. No slang
    ("הזוי", "זיצים", "בקטע של"), no clever wordplay, no irony that depends on
    tone, nothing abstract or meta.
  • Natural word order. Read it aloud in your head — if you stumble even once,
    rewrite it simpler.
  • Concrete over general. A thing you can picture beats a category.

Real failures to learn from:
  BAD:  "מי הכי סביר להתפלל שחבר משפחה לא יאחר שוב לתפילה"
        (a clause inside a clause — nobody parses this in three seconds)
  GOOD: "לאחר לתפילה בשבת בבוקר"

  BAD:  "מה תמיד נכנס אצלי לרשימת קניות לשבת גם אם לא צריך בכלל"
        (two ideas stapled together, and far too long)
  GOOD: "המוצר שקניתי השבוע בלי צורך"

  BAD:  "התפקיד שלי הכי חשוב בערב שישי אצל מיכל"
        (broken word order, and names a person)
  GOOD: "התפקיד שלי בהכנות לשבת"
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
Nobody wrote anything about the family, so write items that fit any frum
household: the Shabbos table, the Friday rush, cooking and the kitchen, hosting
guests, Yom Tov preparations, shopping, waking up for davening, tidiness and
mess, lost keys, and who falls asleep first.`.trim();

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

export const SURVEY_PROMPT = `
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
Ask about the reader themselves, without using "אתה" or "את".
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

  // Label-shaped and easy to read first; anything clumsy only if we run short.
  const good = all.filter((q) => !looksLikeQuestion(q) && !isTangled(q, 8) && !hasSlang(q));
  const rest = all.filter((q) => !good.includes(q)).sort(byClarity(8));

  const chosen = [...good, ...rest].slice(0, count);
  return chosen.length >= 2 ? chosen : null;
}

const INTERROGATIVE = /^(מה|איך|למה|מתי|כמה|איזה|איזו|היכן|איפה|עם מי|מי)\b/;

/** Survey items should be first-person labels, not questions. */
function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return t.includes("?") || INTERROGATIVE.test(t);
}

// ─── Call 2 — round questions (end of survey) ────────────────────────────────

export const ROUNDS_PROMPT = `
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

The WHOLE item stays in the infinitive. Do not slip into first person partway
through, and never use שלו / שלה / אותו / אותה about the person being guessed.
  BAD:  "לאבד שקית או לשכוח איפה הנחתי אותה"   (drops into first person)
  BAD:  "להתעקש שהחמין שלו הכי טוב"             (שלו picks a gender)
  GOOD: "לאבד שקית ולא למצוא אותה אף פעם"
  GOOD: "להתעקש שהחמין הזה הכי טוב שהיה"

LENGTH: 4 to 9 words. It must be readable at a glance, on a phone, by a
70-year-old.

CONTENT: an ordinary thing people actually do in a home or at a family table,
that produces instant recognition. Before you keep an item, ask: "have I seen
this happen in a real family, this year?" If not, delete it.

Never invent a scenario that does not exist in family life. The verb must be
plain and everyday — talking, eating, forgetting, arriving, tidying, singing,
looking for something, falling asleep. Do not reach for an unusual verb to
sound clever; unusual verbs are where nonsense comes from.
  BAD: "להתראיין על הרגלים מוזרים בסעודת שבת"
       (nobody is interviewed at a Shabbos meal — this scene does not exist)
  GOOD: "לדבר הכי הרבה בסעודת שבת"
  BAD: "להרצות על חשיבות הסדר בבית"     (nobody lectures; they nag)
  GOOD: "להעיר לכולם על הבלגן בסלון"
  BAD: "מי הכי נחמד"                   (abstract, not a scene)
  BAD: "לזכות בפרס נובל"               (fits nobody)
  BAD: "להיות הכי עצלן"                (an insult, not a scene)

TONE — this is a party game, not a survey. Items should make the room laugh,
not just nod. Mix these registers across the set instead of writing thirteen
of the same kind:

  • gentle absurdity — treating an object or a machine like a person. This is
    the funniest register and the most underused:
      "להתווכח עם הוויז על הדרך הכי קצרה"
      "להסביר למכונת הכביסה מה היא עשתה לא בסדר"
      "לנהל משא ומתן עם התנור"
  • caught in the act — the small thing everyone does and nobody admits:
      "לטעום מהסיר ולהגיד שלא נגע"
      "להיעלם בדיוק כשמתחילים לפנות"
  • stubborn conviction — absolute certainty about something tiny:
      "להתעקש שהדרך הזאת קצרה בשתי דקות"
  • everyday blunders out in the world — driving, parking, errands, queues.
    Do NOT keep every item inside the house; half of family life happens out:
      "לנסוע נגד כיוון התנועה בלי לשים לב"
      "לחפש את החניה שהרכב חונה בה"
      "לחזור מהמכולת בלי הדבר שבשבילו הלכו"
  • warm and affectionate — not every item should tease:
      "להיות הראשון להתלהב ממתנה קטנה"

Aim for roughly a third absurd, a third caught-in-the-act, and the rest split
between conviction and warmth. An item nobody smiles at is a wasted round.
Absurd does NOT mean invented: arguing with Waze is funny because it really
happens. Keep every item inside real family life.

SPREAD the items roughly evenly across these axes. AT MOST half may be set at
home — the rest must happen out in the world, or the game feels claustrophobic:

  AT HOME
  • the rhythm of שבת and חגים — the meal, the זמירות, the פלטה, the Friday rush
  • Yom Tov preparation — Pesach cleaning, the Seder, building the Sukkah,
    Purim costumes and mishloach manos, Chanukah candles
  • household oddities — lost keys, glasses on the head, leftovers, the junk drawer
  • the kitchen and hosting guests

  OUT IN THE WORLD
  • driving and navigation — wrong turns, parking, arguing with the GPS
  • errands — the makolet, the queue, coming home without the one thing
  • buses, waiting rooms, appointments, getting lost
  • family trips — packing, the car, "are we there yet"

  ANYWHERE
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
THAT PLAYER THEMSELVES. It must never ask about another family member, and never
about the family as a group — the person reading it is the only one who can
answer it.

Do NOT write "אתה" or "את" — you do not know who will receive it. Use past tense
or "יש לך", both of which read correctly for anyone:
  GOOD: "כמה כוסות קפה שתית היום?"
  GOOD: "כמה מפתחות יש לך על הצרור?"
  BAD:  "כמה כוסות קפה אתה שותה ביום?"   (masculine only)

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
Write ${counts.mostLikely + 5} "mostLikely" statements and ${counts.numbers + 3} "numberQuestions" for one game.

${familyBlock(familyDescription, GENERIC_NOTE)}

${materialBlock}

${varietyBlock(usedQuestions)}
`.trim();

  const parsed = await callOpenAi(apiKey, model, ROUNDS_PROMPT, user, ROUNDS_SCHEMA, "family_rounds", timeoutMs);
  if (!parsed) return null;

  // Ask for extra, then keep the ones that read cleanly. Only fall back to the
  // tangled ones if that would otherwise leave the game short of rounds.
  const pick = (raw: unknown, want: number, maxWords: number) => {
    const all = clean(raw, want + 8);
    const good = all.filter((q) => !isTangled(q, maxWords) && !hasSlang(q));
    const rest = all.filter((q) => !good.includes(q)).sort(byClarity(maxWords));
    return [...good, ...rest].slice(0, want);
  };

  const result: GeneratedRounds = {
    mostLikely: pick(parsed.mostLikely, counts.mostLikely, 9),
    numberQuestions: pick(parsed.numberQuestions, counts.numbers, 10),
  };

  // A thin response is worse than the curated file — treat it as a failure.
  return result.mostLikely.length >= 2 ? result : null;
}

// ─── Couple game ─────────────────────────────────────────────────────────────

export interface GeneratedCouple {
  choices: Array<{ question: string; options: string[] }>;
  mostLikely: string[];
  numbers: string[];
}

const COUPLE_PROMPT = `
You write content for a Hebrew game played by ONE MARRIED COUPLE, just the two
of them, on their two phones. The whole game asks one question: how well do you
know each other?

You produce three kinds of item.

════════ "choices" — מה ענית? ════════
A question about oneself, with exactly FOUR options. Each partner picks their
own answer privately, then each guesses what the other picked.

  • all four options must be genuinely plausible for a real person — if one is
    obviously right or obviously silly, there is nothing to guess
  • keep each option to one to four words; they are buttons on a phone
  • the question is about the reader themselves, in first person
  GOOD: { "question": "מה הכי מרגיע אותי אחרי יום קשה?",
          "options": ["שקט מוחלט", "לדבר על זה", "משהו מתוק", "לצאת לנשום אוויר"] }
  BAD:  options like ["לישון", "לישון קצת", "לנוח", "לנמנם"]  (all the same)
  BAD:  options like ["שקט", "לרקוד על השולחן", "לישון", "לאכול"]  (one is absurd)

════════ "mostLikely" — מי מאיתנו ════════
The screen shows "מי מאיתנו הכי סביר" and then your item; both of them vote for
one of the two of them, and they score only when they agree.
Write ONLY the completion, in the INFINITIVE, 4 to 9 words, no question mark,
no names. Same rules as the family game.
  GOOD: "לוותר ראשון אחרי ויכוח"
  GOOD: "לשכוח מה סיכמנו אתמול"

════════ "numbers" — מה המספר ════════
One of them answers privately with a whole number, the other guesses it.
About the reader themselves, no "אתה" or "את", past tense or "יש לך".
  GOOD: "כמה שנים אנחנו מכירים?"
  GOOD: "כמה פעמים בשבוע שטפתי כלים?"

════════ TONE — the whole point of this game ════════
Two people who know each other very well are trying to prove it. The fun is in
recognition: "that is SO you". A flat, sensible item is a wasted round.

Where the laughs come from, mix all five:

  • THE RUNNING ARGUMENT — the thing they have disagreed about for years and
    will never settle
      "מה באמת קרה בפעם הראשונה שהלכנו לאיבוד?"
      options: ["הוא פספס פנייה", "היא נתנה הוראה הפוכה", "הוויז אשם", "לא הלכנו לאיבוד"]

  • THE TELL — the small thing that gives your partner away
      "מה הסימן שאני מתחיל להתעצבן?"
      options: ["שקט פתאומי", "מסדר דברים בכוח", "צוחק בלי סיבה", "עונה קצר מדי"]

  • THE SMALL BETRAYAL — everybody does it, nobody admits it
      "מה עשיתי עם החתיכה האחרונה בעוגה?"
      options: ["אכלתי", "השארתי לך", "חילקתי", "העמדתי פנים שלא ראיתי"]

  • THE RITUAL — the thing only these two do
      "מה תמיד קורה אצלנו בדרך חזרה מאירוע?"
      options: ["מנתחים את כולם", "אחד נרדם", "רבים על המוזיקה", "שקט מוחלט"]

  • THE WARM ONE — not everything is teasing. Every few items, something kind.
      "מה הכי מרגיע אותי כשיום היה קשה?"

CRITICAL — in "choices", the OPTIONS are where the joke lives, not the question.
Four flat options make a boring round no matter how good the question is. Each
option should be a small picture of a different person.
  BORING:  ["כן", "לא", "לפעמים", "תלוי"]
  BORING:  ["לישון", "לנוח", "לנמנם", "להירגע"]
  GOOD:    ["מחפש באותו מקום שלוש פעמים", "קורא לך מיד", "מוותר ומודיע שאבד", "מאשים מישהו"]

Every option must still be something a real person would actually pick — funny,
not absurd. If one option is clearly the joke answer nobody would choose, the
round collapses to three options.

════════ VARIETY — read this twice ════════
The single most common failure is writing the same item over and over in
different words. It happens because you latch onto the two or three facts the
couple wrote about themselves and keep circling them.

  • Use each fact from their notes AT MOST ONCE across the whole set. If they
    mentioned lateness, exactly one item may be about lateness.
  • No two items may be about the same habit, moment or trait.
  • Vary the SHAPE of the sentence, not just the words. If three items in a row
    begin "מה עשיתי כש...", you have written one item three times.
    Rotate between: "מה...", "איזה...", "מתי...", "איפה...", "כמה...",
    and plain noun phrases with no question word at all.

SPREAD across these areas, at most two items from any one of them:
  • the house — mess, repairs never done, who fixes what
  • the kitchen — cooking, leftovers, what always runs out
  • שבת and חגים — the table, guests, the Friday rush, Yom Tov prep
  • the car and travelling — directions, packing, who drives
  • mornings, waking up, getting out of the house
  • shopping and errands
  • the children and grandchildren
  • memories — how you met, the wedding, the first apartment
  • how you disagree, and who gives in first
  • small kindnesses and the things you do for each other

════════ WHAT THIS GAME MAY TALK ABOUT ════════
Unlike the family game, here you MAY write warmly about the marriage itself:
how they met, the wedding, what each of them values in the other, small
kindnesses, habits that drive the other one mad, who apologises first, plans
and dreams they share, how they divide the house.

But this is a frum couple, and the game is still read out loud in their home:
nothing about intimacy or physical relationship, not even hinted at, not even
as a joke. Keep it to affection, partnership and daily life together.

${SAFETY}

${HEBREW}
`.trim();

const COUPLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    choices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
        required: ["question", "options"],
      },
    },
    mostLikely: { type: "array", items: { type: "string" } },
    numbers: { type: "array", items: { type: "string" } },
  },
  required: ["choices", "mostLikely", "numbers"],
};

export async function generateCoupleRounds(
  counts: { choices: number; mostLikely: number; numbers: number },
  description: string,
  usedQuestions: string[],
  apiKey: string,
  model: string,
  timeoutMs = 60_000,
): Promise<GeneratedCouple | null> {
  if (!apiKey) return null;

  const user = `
Write ${counts.choices + 3} "choices", ${counts.mostLikely + 4} "mostLikely" and
${counts.numbers + 2} "numbers" for one game.

${familyBlock(description, "The couple wrote nothing about themselves, so write items that fit any frum married couple: the home, the routine, who does what, small habits, and how they spend an evening together.")}

${varietyBlock(usedQuestions)}
`.trim();

  const parsed = await callOpenAi(apiKey, model, COUPLE_PROMPT, user, COUPLE_SCHEMA, "couple_rounds", timeoutMs);
  if (!parsed) return null;

  const rawChoices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const choices = rawChoices
    .filter((c): c is { question: string; options: string[] } =>
      Boolean(c) && typeof (c as { question?: unknown }).question === "string" &&
      Array.isArray((c as { options?: unknown }).options))
    .map((c) => ({
      question: c.question.trim(),
      options: c.options.filter((o) => typeof o === "string").map((o) => o.trim()).filter(Boolean).slice(0, 4),
    }))
    // four real, distinct options or it is not a guessable round
    .filter((c) => c.question.length > 5 && c.options.length === 4 && new Set(c.options).size === 4)
    .slice(0, counts.choices);

  const mostLikely = clean(parsed.mostLikely, counts.mostLikely + 4)
    .filter((q) => !isTangled(q, 9) && !hasSlang(q))
    .slice(0, counts.mostLikely);

  const numbers = clean(parsed.numbers, counts.numbers + 2).slice(0, counts.numbers);

  // A thin response is worse than the curated file.
  if (choices.length < 2 || mostLikely.length < 2) return null;
  return { choices, mostLikely, numbers };
}

// ─── Couple survey questions ─────────────────────────────────────────────────

const COUPLE_SURVEY_PROMPT = `
${CONTEXT}

A married couple is about to play. You are writing the OPENING SURVEY: both of
them will answer the SAME questions privately, each about themselves. Later in
the game a question is shown with four options — their two real answers plus two
decoys — and each has to spot which one their partner wrote.

That end use dictates everything:
  • the answer must fit on a button, so ask something answerable in two to six
    words. A question that invites a sentence ruins the round.
  • the two of them should plausibly answer DIFFERENTLY. If everyone would give
    the same answer there is nothing to guess.
  • ALWAYS about the person answering, NEVER about their partner. Both of them
    answer the same question, so a question about one of them by name is
    answered twice about the same person and the round makes no sense.
    BAD:  "המאכל ששרה הכי אוהבת להגיש לאורחים"   (about the partner, by name)
    BAD:  "הדבר הראשון שיוני מחפש כשחוזרים"      (same)
    GOOD: "המאכל שאני הכי גאה להגיש לאורחים"
    Never write either of their names into a survey question.

FORMAT: mix the shapes deliberately. Some as a plain first-person label with no
question mark, some as a real question. Never three of the same shape in a row.
  "התירוץ הקבוע שלי כשמאחרים"
  "מה הכי מרגיז אותי בבית?"
  "איזו מטלה אני הכי דוחה?"
  "מתי אני הכי שמח בשבת?"

${SAFETY}

${HEBREW}
`.trim();

export async function generateCoupleSurveyQuestions(
  count: number,
  description: string,
  usedQuestions: string[],
  apiKey: string,
  model: string,
): Promise<string[] | null> {
  if (!apiKey) return null;

  const user = `
Write ${count + 4} survey questions for one game. All must be different from
each other, and spread across different areas of life together.

${familyBlock(description, "The couple wrote nothing about themselves, so keep to everyday life in a frum home.")}

${varietyBlock(usedQuestions)}
`.trim();

  const parsed = await callOpenAi(apiKey, model, COUPLE_SURVEY_PROMPT, user, SURVEY_SCHEMA, "couple_survey", 30_000);
  if (!parsed) return null;

  const all = clean(parsed.surveyQuestions, count + 4).filter((q) => !isTangled(q, 9) && !hasSlang(q));
  return all.length >= 3 ? all.slice(0, count) : null;
}

// ─── Couple decoys ───────────────────────────────────────────────────────────

export interface CoupleSurveyEntry {
  question: string;
  /** what each of them actually wrote, in their own words */
  answers: string[];
}

const DECOY_PROMPT = `
A married couple is playing a Hebrew guessing game. Each of them privately
answered the same short questions about themselves, in their own words. In the
game the question is shown with four options — the two real answers plus two
you write — and each partner has to pick which option their partner wrote.

Your only job is to write the two DECOYS for each question.

════════ THE ONLY WAY THIS ROUND FAILS ════════
Players do not recognise the real answer by its meaning. They recognise it
because the decoys are written BETTER. A polished, complete, well-punctuated
option is instantly spotted as the one nobody at this table wrote, and the
round is over before it started.

You are not writing good Hebrew here. You are impersonating two specific people.

  • Write decoy #1 in the voice of the FIRST person and decoy #2 in the voice
    of the SECOND. Then no style stands out as foreign.
  • Copy their level of polish exactly. Fragment with no verb → write a
    fragment with no verb. No final period → no final period. Lowercase
    casual phrasing → the same.
  • Never longer than their longest real answer. Shorter is safer.
  • Do not correct or improve anything about how they write.
  • Do not add detail they did not use. If they wrote two words, two words.

A decoy must also be:
  • plausible — something either of them could truly have written
  • clearly different in MEANING from both real answers, so there is exactly
    one correct pick and never two that mean the same thing
  • never funnier or stranger than the real ones
  • correct Hebrew. Broken phrasing is the loudest tell of all — nobody at the
    table writes ungrammatically in a way a machine does.
    BAD:  "נותן הליכה קצרה"    (not Hebrew anyone speaks)
    GOOD: "יוצא להליכה"

  question: "מה שאני עושה כשאני לא מוצא משהו"
  real:     ["מחפש באותו מקום שוב ושוב", "צועק שמישהו הזיז"]
  GOOD decoys: ["מוותר ומחכה שיצוץ", "מתחיל לרוקן מגירות"]
  BAD decoys:  ["מחפש שוב באותו מקום", "מתקשר למשטרה"]
               (first repeats a real answer, second is absurd)

${SAFETY}

${HEBREW}
`.trim();

const DECOY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          decoys: { type: "array", items: { type: "string" } },
        },
        required: ["question", "decoys"],
      },
    },
  },
  required: ["items"],
};

/** Returns a map from question text to its two decoys. */
export async function generateCoupleDecoys(
  entries: CoupleSurveyEntry[],
  description: string,
  apiKey: string,
  model: string,
  timeoutMs = 90_000,
): Promise<Map<string, string[]> | null> {
  const usable = entries.filter((e) => e.answers.filter((a) => a.trim()).length >= 1);
  if (!apiKey || usable.length === 0) return null;

  const block = usable
    .map((e) => `question: "${e.question}"\nreal: [${e.answers.filter(Boolean).map((a) => `"${a}"`).join(", ")}]`)
    .join("\n\n");

  const user = `
Write exactly two decoys for each of these ${usable.length} questions.

${block}

${familyBlock(description, "You were told nothing else about this couple — rely on how they write.")}
`.trim();

  const parsed = await callOpenAi(apiKey, model, DECOY_PROMPT, user, DECOY_SCHEMA, "couple_decoys", timeoutMs);
  if (!parsed) return null;

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const map = new Map<string, string[]>();

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const question = (item as { question?: unknown }).question;
    const decoys = (item as { decoys?: unknown }).decoys;
    if (typeof question !== "string" || !Array.isArray(decoys)) continue;

    const entry = usable.find((e) => e.question === question.trim());
    if (!entry) continue;

    const realAnswers = entry.answers.map((a) => a.trim()).filter(Boolean);
    const realLower = realAnswers.map((a) => a.toLowerCase());

    // The model still tidies things up, so strip the tells it cannot resist:
    // a closing full stop nobody else used, and an answer noticeably longer
    // than anything the couple actually wrote.
    const realEndsWithStop = realAnswers.some((a) => /[.!]$/.test(a));
    const longest = Math.max(...realAnswers.map((a) => a.length), 0);

    const clean = decoys
      .filter((d): d is string => typeof d === "string")
      .map((d) => {
        let text = d.trim();
        if (!realEndsWithStop) text = text.replace(/[.!]+$/, "").trim();
        return text;
      })
      .filter((d) => d.length > 0 && d.length <= 80)
      .filter((d) => !realLower.includes(d.toLowerCase()))
      // a decoy half again as long as their longest answer reads as the odd one out
      .filter((d) => longest === 0 || d.length <= Math.round(longest * 1.5));

    if (clean.length >= 1) map.set(question.trim(), [...new Set(clean)].slice(0, 2));
  }

  return map.size > 0 ? map : null;
}

// ─── Round E — how close were the two answers ────────────────────────────────

const CLOSENESS_PROMPT = `
A married couple were both asked the same open question and each wrote a short
answer without seeing the other's. Judge how close the two answers are in
MEANING, and say it in one warm Hebrew line.

  0    completely different ideas
  50   same general direction, different specifics
  100  the same thing, even if worded differently

Judge meaning, never wording. "לשבת בשקט עם תה" and "ערב רגוע בבית בלי אף אחד"
are the same idea and score high. "לצאת לטייל" and "להישאר בבית" are opposites
and score low, however similar the words look.

The note is one short Hebrew sentence spoken to the couple, warm and specific
to what they wrote. Never scold, never say one of them is wrong — there is no
wrong answer here.
  high:   "שניכם כתבתם על שקט בבית. אותו ערב בדיוק."
  middle: "שניכם רוצים לצאת — רק לא לאותו מקום."
  low:    "אחד רוצה שקט והשני רוצה אנשים. יש על מה לדבר."

Plain Hebrew only in the note — no slang, not "בקטע של", not "אחלה". It is read
out loud at their table.

${HEBREW}
`.trim();

const CLOSENESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    closeness: { type: "integer" },
    note: { type: "string" },
  },
  required: ["closeness", "note"],
};

/** Rough word-overlap score, used when the model is unavailable or too slow. */
function overlapCloseness(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      s.toLowerCase().replace(/[.,!?;:״"'()]/g, " ").split(/\s+/)
        .filter((w) => w.length > 2)
        .map((w) => w.replace(/^[והבכלמש]/, "")),
    );
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return Math.round((shared / Math.min(A.size, B.size)) * 100);
}

export async function judgeCloseness(
  question: string,
  first: { nickname: string; text: string },
  second: { nickname: string; text: string },
  apiKey: string,
  model: string,
  timeoutMs = 12_000,
): Promise<{ closeness: number; note: string }> {
  const fallback = () => {
    const score = overlapCloseness(first.text, second.text);
    return {
      closeness: score,
      note: score >= 60 ? "כתבתם כמעט אותו דבר." : score >= 25 ? "יש כאן קו משותף." : "שתי תשובות שונות לגמרי.",
    };
  };

  if (!apiKey || !first.text.trim() || !second.text.trim()) return fallback();

  const user = `
question: "${question}"
${first.nickname}: "${first.text}"
${second.nickname}: "${second.text}"
`.trim();

  const parsed = await callOpenAi(apiKey, model, CLOSENESS_PROMPT, user, CLOSENESS_SCHEMA, "closeness", timeoutMs);
  if (!parsed) return fallback();

  const closeness = typeof parsed.closeness === "number" ? Math.max(0, Math.min(100, Math.round(parsed.closeness))) : null;
  const note = typeof parsed.note === "string" ? parsed.note.trim() : "";
  if (closeness === null) return fallback();

  return { closeness, note: note || fallback().note };
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

// NOTE: JavaScript's \b is defined on [A-Za-z0-9_], so it never matches at a
// Hebrew word edge — a regex like /\bאבל\b/ silently never fires. Everything
// below tokenises on whitespace instead, which is what actually works here.

const tokens = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const wordCount = (text: string) => tokens(text).length;

/**
 * Words that almost always mean two ideas were stapled together. Note this is
 * about CONTRAST, not sequence: "להתחייב לעזור ואז להיעלם" is one scene told in
 * two beats and reads fine, while "לאחר לתפילה ובכל זאת להגיע ראשון" is two
 * separate claims and stops being readable at a glance.
 */
const JOINERS = new Set(["וגם", "למרות", "אבל", "אלא", "ואילו", "בעוד", "אף", "ובכל", "למרות זאת"]);

const SLANG_WORDS = new Set([
  "הזוי", "הזויה", "זיצים", "בקטע", "וואלה", "אחלה", "סבבה", "פגז", "אש", "חבל",
]);

const strip = (word: string) => word.replace(/[.,!?;:״"'()]/g, "");

/**
 * Asking the model for short, single-clause items is not enough — it drifts.
 * These are the checks that actually keep long, tangled items off the screen.
 */
function isTangled(text: string, maxWords: number): boolean {
  const words = tokens(text).map(strip);
  if (words.length > maxWords) return true;
  if (words.some((w) => JOINERS.has(w))) return true;
  // more than one subordinate clause reads as a sentence inside a sentence
  const subordinate = words.filter((w) => /^ש[א-ת]/.test(w)).length;
  return subordinate > 1;
}

function hasSlang(text: string): boolean {
  return tokens(text).map(strip).some((w) => SLANG_WORDS.has(w));
}

/** Order by how easily an item reads: short and single-clause first. */
function byClarity(maxWords: number) {
  return (a: string, b: string) => {
    const score = (t: string) => (isTangled(t, maxWords) ? 1 : 0) + (hasSlang(t) ? 1 : 0);
    const diff = score(a) - score(b);
    return diff !== 0 ? diff : wordCount(a) - wordCount(b);
  };
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
