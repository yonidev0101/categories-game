import http from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import type { CreateRoomInput, JoinRoomInput, SubmissionPayload, UpdateRoomSettingsInput } from "@categories-game/shared";
import { serverConfig } from "./config";
import { MongoPersistence } from "./lib/mongo";
import { RedisCoordinator } from "./lib/redis";
import { AIValidatorService } from "./services/ai-validator";
import { GameService } from "./services/game-service";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: serverConfig.clientUrl,
    credentials: true
  }
});

const mongo = new MongoPersistence(serverConfig.mongodbUri, serverConfig.mongodbDbName);
const redis = new RedisCoordinator(serverConfig.redisUrl);
const aiValidator = new AIValidatorService(serverConfig.openAiApiKey, serverConfig.openAiModel);
const gameService = new GameService(aiValidator, mongo, redis, {
  onRoomState: (roomCode, snapshot) => {
    io.to(roomCode).emit("room_state", snapshot);
  },
  onCountdown: (roomCode, endsAt) => {
    io.to(roomCode).emit("countdown_started", { endsAt });
  },
  onAnswersLocked: (roomCode) => {
    io.to(roomCode).emit("answers_locked", { roomCode });
  },
  onRoundResults: (roomCode, scoreboard) => {
    io.to(roomCode).emit("round_results", { scoreboard });
  },
  onGameResults: (roomCode, scoreboard) => {
    io.to(roomCode).emit("game_results", { scoreboard });
  }
});

app.use(cors({ origin: serverConfig.clientUrl, credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/admin/stats", (req, res) => {
  const secret = serverConfig.adminSecret;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  res.json(gameService.getAdminStats());
});

app.post("/rooms", async (req, res) => {
  try {
    const body = req.body as CreateRoomInput;
    const result = await gameService.createRoom(body);
    res.json({ room: result.room, sessionToken: result.sessionToken, playerId: result.playerId });
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.post("/rooms/:code/join", async (req, res) => {
  try {
    const body = req.body as JoinRoomInput;
    const result = await gameService.joinRoom(req.params.code.toUpperCase(), body.nickname);
    res.json({ room: result.room, sessionToken: result.sessionToken, playerId: result.playerId });
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.post("/rooms/:code/start", async (req, res) => {
  try {
    const playerId = String(req.body.playerId ?? "");
    const room = await gameService.startRoom(req.params.code.toUpperCase(), playerId);
    res.json({ room });
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.post("/rooms/:code/settings", async (req, res) => {
  try {
    const body = req.body as UpdateRoomSettingsInput;
    const room = await gameService.updateRoomSettings(req.params.code.toUpperCase(), body.playerId, body.settings);
    res.json({ room });
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.post("/rooms/:code/reroll-letters", async (req, res) => {
  try {
    const playerId = String(req.body.playerId ?? "");
    const room = await gameService.rerollRoundLetters(req.params.code.toUpperCase(), playerId);
    res.json({ room });
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.get("/rooms/:code/state", async (req, res) => {
  try {
    const playerId = typeof req.query.playerId === "string" ? req.query.playerId : null;
    const room = await gameService.getRoomState(req.params.code.toUpperCase(), playerId);
    res.json({ room });
  } catch (error) {
    res.status(404).json({ message: getErrorMessage(error) });
  }
});

io.on("connection", (socket) => {
  socket.on("join_room", async ({ roomCode, sessionToken }: { roomCode: string; sessionToken: string }) => {
    try {
      const normalizedCode = roomCode.toUpperCase();
      const player = gameService.findPlayerBySession(normalizedCode, sessionToken);
      if (!player) {
        socket.emit("error_message", { message: "סשן לא תקף" });
        return;
      }

      socket.data.roomCode = normalizedCode;
      socket.data.playerId = player.id;
      await gameService.setOnlineStatus(normalizedCode, player.id, true);
      await socket.join(normalizedCode);
      const snapshot = await gameService.getRoomState(normalizedCode, player.id);
      socket.emit("room_state", snapshot);
      io.to(normalizedCode).emit("player_presence_changed", { playerId: player.id, isOnline: true });
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("set_ready", async ({ roomCode, isReady }: { roomCode: string; isReady: boolean }) => {
    try {
      await gameService.setReady(roomCode.toUpperCase(), String(socket.data.playerId), isReady);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("update_answers", async (payload: SubmissionPayload) => {
    try {
      await gameService.updateAnswers(payload.roomCode.toUpperCase(), String(socket.data.playerId), payload.roundNumber, payload.answers);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("finish_round", async ({ roomCode }: { roomCode: string }) => {
    try {
      await gameService.finishRound(roomCode.toUpperCase(), String(socket.data.playerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("start_next_round", async ({ roomCode }: { roomCode: string }) => {
    try {
      await gameService.startNextRound(roomCode.toUpperCase(), String(socket.data.playerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("reset_room", async ({ roomCode }: { roomCode: string }) => {
    try {
      await gameService.resetRoom(roomCode.toUpperCase(), String(socket.data.playerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("host_override_answer", async ({ roomCode, targetPlayerId, categoryId }: { roomCode: string; targetPlayerId: string; categoryId: string }) => {
    try {
      await gameService.hostOverrideAnswer(roomCode.toUpperCase(), String(socket.data.playerId), targetPlayerId, categoryId);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("send_reaction", ({ roomCode, emoji }: { roomCode: string; emoji: string }) => {
    const VALID = ["👍", "😂", "🔥", "😮", "👏", "❤️", "😱"];
    if (!VALID.includes(emoji) || !socket.data.playerId) return;
    io.to(roomCode.toUpperCase()).emit("player_reaction", { playerId: String(socket.data.playerId), emoji });
  });

  socket.on("disconnect", async () => {
    if (socket.data.roomCode && socket.data.playerId) {
      await gameService.setOnlineStatus(String(socket.data.roomCode), String(socket.data.playerId), false);
      io.to(String(socket.data.roomCode)).emit("player_presence_changed", { playerId: String(socket.data.playerId), isOnline: false });
    }
  });
});

async function bootstrap() {
  await redis.connect();

  try {
    await mongo.connect();
    await mongo.repairRoomIndexes();
  } catch (error) {
    console.error("MongoDB is unavailable, continuing with in-memory room storage.", error);
  }

  server.listen(serverConfig.port, () => {
    console.log(`Server listening on http://localhost:${serverConfig.port}`);
  });
}

void bootstrap();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}


