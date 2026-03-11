import dotenv from "dotenv";

dotenv.config();

export const serverConfig = {
  port: Number(process.env.PORT ?? 4000),
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:3000",
  mongodbUri: process.env.MONGODB_URI ?? "",
  mongodbDbName: process.env.MONGODB_DB_NAME ?? "categories-game",
  redisUrl: process.env.REDIS_URL ?? "",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  adminSecret: process.env.ADMIN_SECRET ?? "",
};


