interface ProjectDetailContent {
  tagline: string;
  overview: string;
  problem: string;
  solution: string;
  features: {
    title: string;
    description: string;
  }[];
  highlights: string[];
  setup: {
    prerequisites: string[];
    steps: {
      label: string;
      command?: string;
      note?: string;
    }[];
  };
}

// ENGLISH
const detailEn: ProjectDetailContent = {
  tagline: "Real-time multiplayer Hebrew word game with AI-powered answer validation.",

  overview:
    "A full-stack multiplayer adaptation of the classic Israeli word game ארץ עיר (Country City). Players race to fill 8 Hebrew categories before anyone else finishes, then watch an AI judge evaluate every submission for accuracy. The game runs entirely in-memory and degrades gracefully — MongoDB, Redis, and the OpenAI API are all optional.",

  problem:
    "The classic pen-and-paper word game has no good digital multiplayer version that handles the nuances of Hebrew — where final-letter variants, duplicate detection, and category-fit are hard to judge fairly at speed. Manual judging creates arguments; pure string matching is too strict for a living language.",

  solution:
    "The server holds authoritative room state in a Node.js Map and pushes updates over Socket.IO. When a round ends, each player's answers go through a three-stage pipeline: rule validation (letter position rules), OpenAI structured-JSON validation for Hebrew category fit, then duplicate-detection across all submissions. Scoring is computed server-side from the combined results. MongoDB and Redis are wired in as optional layers for persistence and future horizontal scaling.",

  features: [
    {
      title: "Live Round Engine",
      description:
        "The first player to submit a complete answer set triggers a configurable countdown, giving late players a grace window before the round locks. All transitions — lobby → in_round → countdown → validating → round_results — are broadcast over Socket.IO so every client stays in sync.",
    },
    {
      title: "AI Answer Validation",
      description:
        "OpenAI's API scores each Hebrew answer against its category using a strict JSON schema response. The service handles Hebrew final-letter normalization, times out at 20 seconds, and falls back to lenient deterministic validation when the API is unavailable.",
    },
    {
      title: "Host Override Controls",
      description:
        "After AI validation completes, the host can manually flip any answer's validity before scores are revealed, handling edge cases the model gets wrong.",
    },
    {
      title: "Classic & Advanced Modes",
      description:
        "Classic mode requires answers to start with a single random Hebrew letter; Advanced mode draws two letters that must both appear anywhere in the answer, raising the difficulty significantly.",
    },
    {
      title: "Reactions & Live Presence",
      description:
        "Players can fire emoji reactions that float across everyone's screen in real time. The UI tracks which players are online and shows a per-category 'pressure gauge' indicating how many others have already answered each field.",
    },
  ],

  highlights: [
    "npm workspaces monorepo — shared TypeScript types and pure game-logic functions consumed by both Next.js and Express without a build step (Next.js imports the .ts source directly)",
    "Three-tier optional persistence: in-memory Map (always), MongoDB snapshots (if URI present), Redis pub/sub (if URL present) — the server starts and runs without either",
    "OpenAI structured output with a strict JSON schema ensures the validation response is always machine-readable, with a 20-second timeout and deterministic fallback",
    "Unique-answer scoring incentive (15 pts) versus duplicate penalty (5 pts) drives strategic divergence between players",
    "Socket.IO room isolation — each game room is a named namespace channel; the session token stored in localStorage re-authenticates the socket on reconnect",
    "Deployed to Railway via Dockerfile pair (Dockerfile.web / Dockerfile.server) using direct file upload — no git remote needed",
  ],

  setup: {
    prerequisites: [
      "Node.js >= 22",
      "Docker (for local MongoDB + Redis)",
      "OpenAI API key (optional — game works without it)",
    ],
    steps: [
      {
        label: "Clone and install dependencies",
        command: "npm install",
      },
      {
        label: "Copy environment variables",
        command: "cp .env.example .env",
        note: "Add OPENAI_API_KEY to enable AI validation; leave blank for deterministic fallback",
      },
      {
        label: "Start MongoDB and Redis",
        command: "docker compose up -d",
        note: "Optional — the server runs fully in-memory without them",
      },
      {
        label: "Start the Express + Socket.IO server",
        command: "npm run dev:server",
        note: "Runs on http://localhost:4000",
      },
      {
        label: "Start the Next.js frontend",
        command: "npm run dev:web",
        note: "Runs on http://localhost:3000",
      },
    ],
  },
};

// HEBREW
const detailHe: ProjectDetailContent = {
  tagline: "משחק ארץ עיר מולטיפלייר בזמן אמת עם שיפוט תשובות מבוסס בינה מלאכותית.",

  overview:
    "גרסה דיגיטלית מלאה של משחק ארץ עיר הקלאסי לכמה שחקנים במקביל. השחקנים מתחרים למלא 8 קטגוריות בעברית לפני כל האחרים, ואז מודל AI שופט כל תשובה. השרת עובד לגמרי בזיכרון — MongoDB, Redis ו-OpenAI הם אופציונליים לחלוטין.",

  problem:
    "למשחק הנייר והעיפרון הישן אין גרסה דיגיטלית טובה שמתמודדת עם הניואנסים של עברית — אותיות סופיות, זיהוי כפילויות, והתאמה לקטגוריה הם דברים שקשה לשפוט מהר באופן הוגן. שיפוט ידני מוביל לוויכוחים; התאמת מחרוזות בלבד היא נוקשה מדי לשפה חיה.",

  solution:
    "השרת שומר את מצב החדר ב-Map בזיכרון Node.js ודוחף עדכונים דרך Socket.IO. בסיום כל סיבוב, תשובות כל שחקן עוברות שלושה שלבים: ולידציה לפי חוקי האות, ולידציה של התאמה לקטגוריה דרך OpenAI עם פלט JSON מובנה, ואז זיהוי כפילויות בין כל המשתתפים. הניקוד מחושב בשרת מהתוצאות המשולבות.",

  features: [
    {
      title: "מנוע סיבובים בזמן אמת",
      description:
        "השחקן הראשון שסיים מפעיל ספירה לאחור הניתנת להגדרה, ומאפשרת לשאר שחקנים חלון גרייס. כל המעברים — המתנה, סיבוב פעיל, ספירה לאחור, ולידציה, תוצאות — משודרים דרך Socket.IO כך שכל הלקוחות מסונכרנים.",
    },
    {
      title: "ולידציה חכמה בעברית",
      description:
        "ה-API של OpenAI בודק כל תשובה עברית מול הקטגוריה שלה באמצעות JSON schema קשיח. השירות מטפל בנורמליזציה של אותיות סופיות, מגביל לזמן תגובה של 20 שניות, ונסוג לולידציה דטרמיניסטית אם ה-API לא זמין.",
    },
    {
      title: "עקיפת ולידציה למנחה",
      description:
        "לאחר שה-AI סיים, המנחה יכול להעיף ידנית את תוקף כל תשובה לפני חשיפת הניקוד — לטיפול במקרים שהמודל טעה בהם.",
    },
    {
      title: "מצב קלאסי ומתקדם",
      description:
        "במצב קלאסי התשובות חייבות להתחיל באות עברית אקראית אחת; במצב מתקדם נבחרות שתי אותיות שחייבות להופיע איפשהו בתשובה — מה שמגביר משמעותית את הקושי.",
    },
    {
      title: "תגובות ונוכחות שחקנים",
      description:
        "שחקנים יכולים לשגר תגובות אמוג׳י שצפות על המסך של כולם בזמן אמת. הממשק מציג מי מחובר ומד לחץ לכל קטגוריה — כמה שחקנים כבר ענו עליה.",
    },
  ],

  highlights: [
    "מונורפו npm workspaces — טיפוסי TypeScript ולוגיקת משחק נקייה משותפים בין Next.js ל-Express ללא שלב בנייה (Next.js מייבא ישירות קבצי .ts)",
    "שלוש שכבות אחסון אופציונליות: Map בזיכרון (תמיד), MongoDB snapshots (אם יש URI), Redis pub/sub (אם יש URL) — השרת עולה ועובד בלעדיהן",
    "פלט מובנה של OpenAI עם JSON schema קשיח מבטיח שתגובת הולידציה תמיד ניתנת לפענוח, עם timeout של 20 שניות ו-fallback דטרמיניסטי",
    "מבנה ניקוד שמתגמל מקוריות: תשובה ייחודית מקבלת 15 נקודות, תשובה כפולה רק 5 — מה שמעודד שחקנים לחשוב באופן שונה",
    "בידוד חדרים ב-Socket.IO — כל חדר משחק הוא ערוץ נפרד; טוקן הסשן ב-localStorage מאמת מחדש את החיבור בעת התחברות מחדש",
    "פריסה ל-Railway דרך זוג Dockerfiles (Dockerfile.web / Dockerfile.server) עם העלאת קבצים ישירה — ללא צורך ב-git remote",
  ],

  setup: {
    prerequisites: [
      "Node.js גרסה 22 ומעלה",
      "Docker (עבור MongoDB ו-Redis מקומיים)",
      "מפתח OpenAI API (אופציונלי — המשחק עובד גם בלעדיו)",
    ],
    steps: [
      {
        label: "התקנת תלויות",
        command: "npm install",
      },
      {
        label: "העתקת משתני סביבה",
        command: "cp .env.example .env",
        note: "הוסף OPENAI_API_KEY לולידציה חכמה; ריק = ולידציה דטרמיניסטית",
      },
      {
        label: "הפעלת MongoDB ו-Redis",
        command: "docker compose up -d",
        note: "אופציונלי — השרת עובד לגמרי בזיכרון בלעדיהם",
      },
      {
        label: "הפעלת שרת Express + Socket.IO",
        command: "npm run dev:server",
        note: "רץ על http://localhost:4000",
      },
      {
        label: "הפעלת ממשק Next.js",
        command: "npm run dev:web",
        note: "רץ על http://localhost:3000",
      },
    ],
  },
};
