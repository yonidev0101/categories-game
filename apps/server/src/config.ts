import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * `.env` lives at the repo root, but `npm run dev:server` runs from
 * apps/server — so a plain dotenv.config() silently finds nothing and every
 * key ends up empty. Walk up from both the working directory and this file
 * until we find it. On Railway/Render there is no file and the platform's own
 * environment variables are used, which dotenv leaves untouched.
 */
function loadEnvFile(): string | null {
  const starts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];

  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 6; depth += 1) {
      const candidate = path.join(dir, ".env");
      if (fs.existsSync(candidate)) {
        dotenv.config({ path: candidate });
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const envFile = loadEnvFile();

export const serverConfig = {
  port: Number(process.env.PORT ?? 4000),
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:3000",
  mongodbUri: process.env.MONGODB_URI ?? "",
  mongodbDbName: process.env.MONGODB_DB_NAME ?? "categories-game",
  redisUrl: process.env.REDIS_URL ?? "",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  // "מי מהמשפחה?" writes whole Hebrew sentences that get read aloud, so it uses
  // its own model. gpt-5.6-luna writes visibly cleaner Hebrew than gpt-4.1 and
  // costs about a third as much; it is also far slower, which only became
  // affordable once round generation moved to the background during the survey.
  // Override with FAMILY_OPENAI_MODEL.
  familyOpenAiModel: process.env.FAMILY_OPENAI_MODEL ?? "gpt-5.6-luna",
  // The survey call runs in the lobby with the host watching a spinner, so it
  // defaults to the fast model. The rounds call runs in the background during
  // the survey and can afford the slower, better one.
  familySurveyModel:
    process.env.FAMILY_SURVEY_MODEL ?? process.env.FAMILY_OPENAI_MODEL ?? "gpt-4.1",
  adminSecret: process.env.ADMIN_SECRET ?? "",
};


