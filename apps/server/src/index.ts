import http from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import type { CreateRoomInput, JoinRoomInput, SubmissionPayload, UpdateRoomSettingsInput, QuestionAnswer } from "@categories-game/shared";
import { serverConfig } from "./config";
import { MongoPersistence } from "./lib/mongo";
import { RedisCoordinator } from "./lib/redis";
import { AIValidatorService } from "./services/ai-validator";
import { GameService } from "./services/game-service";
import { PersonalityService } from "./services/personality-service";
import { TabooService } from "./services/taboo-service";
import { CodenamesService } from "./services/codenames-service";
import { FamilyService } from "./services/family-service";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: serverConfig.clientUrl,
    credentials: true
  }
});

// ── Personality game: emit personalized snapshots to each socket in the room ──
function emitPersonalityState(roomCode: string) {
  const sockets = io.sockets.adapter.rooms.get(`personality:${roomCode}`);
  if (!sockets) return;
  for (const socketId of sockets) {
    const s = io.sockets.sockets.get(socketId);
    if (!s) continue;
    const pid = s.data.personalityPlayerId as string | undefined;
    try {
      const snap = personalityService.getRoomState(roomCode, pid ?? null);
      s.emit("personality_state", snap);
    } catch { /* room gone */ }
  }
}

const personalityService = new PersonalityService({ onState: emitPersonalityState });

// ── Taboo game: emit personalized snapshots to each socket in the room ────────
function emitTabooState(roomCode: string) {
  const sockets = io.sockets.adapter.rooms.get(`taboo:${roomCode}`);
  if (!sockets) return;
  for (const socketId of sockets) {
    const s = io.sockets.sockets.get(socketId);
    if (!s) continue;
    const pid = s.data.tabooPlayerId as string | undefined;
    try {
      const snap = tabooService.getRoomState(roomCode, pid ?? null);
      s.emit("taboo_state", snap);
    } catch { /* room gone */ }
  }
}

const tabooService = new TabooService(
  { onState: emitTabooState },
  serverConfig.openAiApiKey,
  serverConfig.openAiModel,
);

// ── Codenames game: emit personalized snapshots to each socket in the room ────
function emitCodenamesState(roomCode: string) {
  const sockets = io.sockets.adapter.rooms.get(`codenames:${roomCode}`);
  if (!sockets) return;
  for (const socketId of sockets) {
    const s = io.sockets.sockets.get(socketId);
    if (!s) continue;
    const pid = s.data.codenamesPlayerId as string | undefined;
    try {
      const snap = codenamesService.getRoomState(roomCode, pid ?? null);
      s.emit("cn_state", snap);
    } catch { /* room gone */ }
  }
}

const codenamesService = new CodenamesService(
  { onState: emitCodenamesState },
  serverConfig.openAiApiKey,
  serverConfig.openAiModel,
);

// ── "מי מהמשפחה?": emit personalized snapshots to each socket in the room ─────
function emitFamilyState(roomCode: string) {
  const sockets = io.sockets.adapter.rooms.get(`family:${roomCode}`);
  if (!sockets) return;
  for (const socketId of sockets) {
    const s = io.sockets.sockets.get(socketId);
    if (!s) continue;
    const pid = s.data.familyPlayerId as string | undefined;
    try {
      const snap = familyService.getRoomState(roomCode, pid ?? null);
      s.emit("family_state", snap);
    } catch { /* room gone */ }
  }
}

const familyService = new FamilyService(
  { onState: emitFamilyState },
  serverConfig.openAiApiKey,
  serverConfig.familyOpenAiModel,
  serverConfig.familySurveyModel,
);

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

// ── Personality REST endpoints ────────────────────────────────────────────────

app.post("/personality-rooms", (req, res) => {
  try {
    const nickname = String(req.body.nickname ?? "");
    const result = personalityService.createRoom(nickname);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.post("/personality-rooms/:code/join", (req, res) => {
  try {
    const nickname = String(req.body.nickname ?? "");
    const result = personalityService.joinRoom(req.params.code.toUpperCase(), nickname);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.get("/personality-rooms/:code/state", (req, res) => {
  try {
    const playerId = typeof req.query.playerId === "string" ? req.query.playerId : null;
    const snap = personalityService.getRoomState(req.params.code.toUpperCase(), playerId);
    res.json({ room: snap });
  } catch (error) {
    res.status(404).json({ message: getErrorMessage(error) });
  }
});

// ── Taboo REST endpoints ──────────────────────────────────────────────────────

app.post("/taboo-rooms", (req, res) => {
  try {
    const nickname = String(req.body.nickname ?? "");
    const result = tabooService.createRoom(nickname);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.post("/taboo-rooms/:code/join", (req, res) => {
  try {
    const nickname = String(req.body.nickname ?? "");
    const result = tabooService.joinRoom(req.params.code.toUpperCase(), nickname);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.get("/taboo-rooms/:code/state", (req, res) => {
  try {
    const playerId = typeof req.query.playerId === "string" ? req.query.playerId : null;
    const snap = tabooService.getRoomState(req.params.code.toUpperCase(), playerId);
    res.json({ room: snap });
  } catch (error) {
    res.status(404).json({ message: getErrorMessage(error) });
  }
});

app.patch("/taboo-rooms/:code/settings", (req, res) => {
  try {
    const { playerId, settings } = req.body as { playerId: string; settings: Record<string, unknown> };
    const result = tabooService.updateSettings(req.params.code.toUpperCase(), playerId, settings as never);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

// ── Codenames REST endpoints ──────────────────────────────────────────────────

app.post("/codenames-rooms", (req, res) => {
  try {
    const nickname = String(req.body.nickname ?? "");
    const result   = codenamesService.createRoom(nickname);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.post("/codenames-rooms/:code/join", (req, res) => {
  try {
    const nickname = String(req.body.nickname ?? "");
    const result   = codenamesService.joinRoom(req.params.code.toUpperCase(), nickname);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.get("/codenames-rooms/:code/state", (req, res) => {
  try {
    const playerId = typeof req.query.playerId === "string" ? req.query.playerId : null;
    const snap     = codenamesService.getRoomState(req.params.code.toUpperCase(), playerId);
    res.json({ room: snap });
  } catch (error) {
    res.status(404).json({ message: getErrorMessage(error) });
  }
});

app.patch("/codenames-rooms/:code/settings", (req, res) => {
  try {
    const { playerId, settings } = req.body as { playerId: string; settings: Record<string, unknown> };
    codenamesService.updateSettings(req.params.code.toUpperCase(), playerId, settings as never);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

// ── "מי מהמשפחה?" REST endpoints ──────────────────────────────────────────────

app.post("/family-rooms", (req, res) => {
  try {
    const nickname = String(req.body.nickname ?? "");
    const partnerName = req.body.partnerName ? String(req.body.partnerName) : undefined;
    const mode = req.body.mode === "couple" ? "couple" : "family";
    res.json(familyService.createRoom(nickname, partnerName, mode));
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.post("/family-rooms/:code/join", (req, res) => {
  try {
    const nickname = String(req.body.nickname ?? "");
    const partnerName = req.body.partnerName ? String(req.body.partnerName) : undefined;
    res.json(familyService.joinRoom(req.params.code.toUpperCase(), nickname, partnerName));
  } catch (error) {
    res.status(400).json({ message: getErrorMessage(error) });
  }
});

app.get("/family-rooms/:code/state", (req, res) => {
  try {
    const playerId = typeof req.query.playerId === "string" ? req.query.playerId : null;
    const snap = familyService.getRoomState(req.params.code.toUpperCase(), playerId);
    res.json({ room: snap });
  } catch (error) {
    res.status(404).json({ message: getErrorMessage(error) });
  }
});

// ── Categories REST endpoints ─────────────────────────────────────────────────

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

  socket.on(
    "host_update_answer",
    async ({
      roomCode,
      targetPlayerId,
      categoryId,
      outcome
    }: {
      roomCode: string;
      targetPlayerId: string;
      categoryId: string;
      outcome: "valid_normal" | "valid_duplicate" | "valid_unique" | "invalid";
    }) => {
      try {
        await gameService.hostSetAnswerOutcome(
          roomCode.toUpperCase(),
          String(socket.data.playerId),
          targetPlayerId,
          categoryId,
          outcome
        );
      } catch (error) {
        socket.emit("error_message", { message: getErrorMessage(error) });
      }
    }
  );

  socket.on("host_override_answer", async ({ roomCode, targetPlayerId, categoryId }: { roomCode: string; targetPlayerId: string; categoryId: string }) => {
    try {
      await gameService.hostOverrideAnswer(roomCode.toUpperCase(), String(socket.data.playerId), targetPlayerId, categoryId);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("send_reaction", ({ roomCode, emoji }: { roomCode: string; emoji: string }) => {
    const allowed = ["👍", "😂", "🔥", "😮", "👏", "❤️", "😱"];
    if (!allowed.includes(emoji) || !socket.data.playerId) {
      return;
    }
    io.to(roomCode.toUpperCase()).emit("player_reaction", { playerId: String(socket.data.playerId), emoji });
  });

  // ── Personality socket handlers ─────────────────────────────────────────────

  socket.on("p_join_room", async ({ roomCode, sessionToken }: { roomCode: string; sessionToken: string }) => {
    try {
      const code = roomCode.toUpperCase();
      const player = personalityService.findPlayerBySession(code, sessionToken);
      if (!player) { socket.emit("error_message", { message: "סשן לא תקף" }); return; }

      socket.data.personalityRoomCode = code;
      socket.data.personalityPlayerId = player.id;
      personalityService.setOnlineStatus(code, player.id, true);
      await socket.join(`personality:${code}`);
      emitPersonalityState(code);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("p_start_room", ({ roomCode }: { roomCode: string }) => {
    try {
      personalityService.startRoom(roomCode.toUpperCase(), String(socket.data.personalityPlayerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("p_set_picker", ({ roomCode, pickerId }: { roomCode: string; pickerId: string }) => {
    try {
      personalityService.setPicker(roomCode.toUpperCase(), String(socket.data.personalityPlayerId), pickerId);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("p_set_character", ({ roomCode, character, gender }: { roomCode: string; character: string; gender?: "male" | "female" }) => {
    try {
      personalityService.setCharacter(roomCode.toUpperCase(), String(socket.data.personalityPlayerId), character, gender);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("p_ask_question", ({ roomCode, question }: { roomCode: string; question: string }) => {
    try {
      personalityService.askQuestion(roomCode.toUpperCase(), String(socket.data.personalityPlayerId), question);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("p_answer_question", ({ roomCode, questionId, answer }: { roomCode: string; questionId: string; answer: QuestionAnswer }) => {
    try {
      personalityService.answerQuestion(roomCode.toUpperCase(), String(socket.data.personalityPlayerId), questionId, answer);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("p_make_guess", ({ roomCode, guess }: { roomCode: string; guess: string }) => {
    try {
      personalityService.makeGuess(roomCode.toUpperCase(), String(socket.data.personalityPlayerId), guess);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("p_reset_room", ({ roomCode }: { roomCode: string }) => {
    try {
      personalityService.resetRoom(roomCode.toUpperCase(), String(socket.data.personalityPlayerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  // ── Taboo socket events ──────────────────────────────────────────────────────

  socket.on("t_join_room", async ({ roomCode, sessionToken }: { roomCode: string; sessionToken: string }) => {
    try {
      const code = roomCode.toUpperCase();
      const player = tabooService.findPlayerBySession(code, sessionToken);
      if (!player) { socket.emit("error_message", { message: "סשן לא תקף" }); return; }

      socket.data.tabooRoomCode = code;
      socket.data.tabooPlayerId = player.id;
      tabooService.setOnlineStatus(code, player.id, true);
      await socket.join(`taboo:${code}`);
      emitTabooState(code);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("t_start_game", ({ roomCode }: { roomCode: string }) => {
    void (async () => {
      try {
        await tabooService.startGame(roomCode.toUpperCase(), String(socket.data.tabooPlayerId));
      } catch (error) {
        socket.emit("error_message", { message: getErrorMessage(error) });
      }
    })();
  });

  socket.on("t_update_settings", ({ roomCode, settings }: { roomCode: string; settings: Record<string, unknown> }) => {
    try {
      tabooService.updateSettings(roomCode.toUpperCase(), String(socket.data.tabooPlayerId), settings as never);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("t_send_hint", ({ roomCode, text }: { roomCode: string; text: string }) => {
    try {
      tabooService.sendHint(roomCode.toUpperCase(), String(socket.data.tabooPlayerId), text);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("t_make_guess", ({ roomCode, text }: { roomCode: string; text: string }) => {
    try {
      tabooService.makeGuess(roomCode.toUpperCase(), String(socket.data.tabooPlayerId), text);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("t_skip_word", ({ roomCode }: { roomCode: string }) => {
    try {
      tabooService.skipWord(roomCode.toUpperCase(), String(socket.data.tabooPlayerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("t_reset_room", ({ roomCode }: { roomCode: string }) => {
    try {
      tabooService.resetRoom(roomCode.toUpperCase(), String(socket.data.tabooPlayerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  // ── Codenames socket handlers ────────────────────────────────────────────────

  socket.on("cn_join_room", async ({ roomCode, sessionToken }: { roomCode: string; sessionToken: string }) => {
    try {
      const code   = roomCode.toUpperCase();
      const player = codenamesService.findPlayerBySession(code, sessionToken);
      if (!player) { socket.emit("error_message", { message: "סשן לא תקף" }); return; }

      socket.data.codenamesRoomCode = code;
      socket.data.codenamesPlayerId = player.id;
      codenamesService.setOnlineStatus(code, player.id, true);
      await socket.join(`codenames:${code}`);
      emitCodenamesState(code);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("cn_select_team", ({ roomCode, team }: { roomCode: string; team: string }) => {
    try {
      codenamesService.selectTeam(roomCode.toUpperCase(), String(socket.data.codenamesPlayerId), team as "red" | "blue");
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("cn_select_role", ({ roomCode, role }: { roomCode: string; role: string }) => {
    try {
      codenamesService.selectRole(roomCode.toUpperCase(), String(socket.data.codenamesPlayerId), role as "spymaster" | "operative");
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("cn_start_game", ({ roomCode }: { roomCode: string }) => {
    void (async () => {
      try {
        await codenamesService.startGame(roomCode.toUpperCase(), String(socket.data.codenamesPlayerId));
      } catch (error) {
        socket.emit("error_message", { message: getErrorMessage(error) });
      }
    })();
  });

  socket.on("cn_give_clue", ({ roomCode, clueWord, clueNumber }: { roomCode: string; clueWord: string; clueNumber: number }) => {
    try {
      codenamesService.giveClue(roomCode.toUpperCase(), String(socket.data.codenamesPlayerId), clueWord, clueNumber);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("cn_guess_card", ({ roomCode, cardId }: { roomCode: string; cardId: number }) => {
    try {
      codenamesService.guessCard(roomCode.toUpperCase(), String(socket.data.codenamesPlayerId), cardId);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("cn_end_turn", ({ roomCode }: { roomCode: string }) => {
    try {
      codenamesService.endTurn(roomCode.toUpperCase(), String(socket.data.codenamesPlayerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("cn_update_settings", ({ roomCode, settings }: { roomCode: string; settings: Record<string, unknown> }) => {
    try {
      codenamesService.updateSettings(roomCode.toUpperCase(), String(socket.data.codenamesPlayerId), settings as never);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("cn_reset_room", ({ roomCode }: { roomCode: string }) => {
    try {
      codenamesService.resetRoom(roomCode.toUpperCase(), String(socket.data.codenamesPlayerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  // ── "מי מהמשפחה?" socket handlers ───────────────────────────────────────────

  socket.on("f_join_room", async ({ roomCode, sessionToken }: { roomCode: string; sessionToken: string }) => {
    try {
      const code = roomCode.toUpperCase();
      const player = familyService.findPlayerBySession(code, sessionToken);
      if (!player) { socket.emit("error_message", { message: "סשן לא תקף" }); return; }

      socket.data.familyRoomCode = code;
      socket.data.familyPlayerId = player.id;
      familyService.setOnlineStatus(code, player.id, true);
      await socket.join(`family:${code}`);
      // Always push the full current state — this is what makes reconnect work.
      socket.emit("family_state", familyService.getRoomState(code, player.id));
      emitFamilyState(code);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("f_start_game", ({ roomCode }: { roomCode: string }) => {
    void (async () => {
      try {
        await familyService.startGame(roomCode.toUpperCase(), String(socket.data.familyPlayerId));
      } catch (error) {
        socket.emit("error_message", { message: getErrorMessage(error) });
      }
    })();
  });

  socket.on(
    "f_update_setup",
    ({ roomCode, source, roundCount }: { roomCode: string; source?: "file" | "ai"; roundCount?: number }) => {
      try {
        familyService.updateSetup(roomCode.toUpperCase(), String(socket.data.familyPlayerId), { source, roundCount });
      } catch (error) {
        socket.emit("error_message", { message: getErrorMessage(error) });
      }
    },
  );

  socket.on("f_finish_survey", ({ roomCode }: { roomCode: string }) => {
    try {
      familyService.finishSurveyNow(roomCode.toUpperCase(), String(socket.data.familyPlayerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("f_set_note", ({ roomCode, text }: { roomCode: string; text: string }) => {
    try {
      familyService.setFamilyNote(roomCode.toUpperCase(), String(socket.data.familyPlayerId), String(text ?? ""));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("f_survey_answer", ({ roomCode, index, text }: { roomCode: string; index: number; text: string }) => {
    try {
      familyService.submitSurveyAnswer(roomCode.toUpperCase(), String(socket.data.familyPlayerId), index, text);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("f_vote", ({ roomCode, targetPlayerId }: { roomCode: string; targetPlayerId: string }) => {
    try {
      familyService.castVote(roomCode.toUpperCase(), String(socket.data.familyPlayerId), targetPlayerId);
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("f_choice", ({ roomCode, optionIndex }: { roomCode: string; optionIndex: number }) => {
    try {
      familyService.submitChoice(roomCode.toUpperCase(), String(socket.data.familyPlayerId), Number(optionIndex));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("f_text", ({ roomCode, text }: { roomCode: string; text: string }) => {
    try {
      familyService.submitText(roomCode.toUpperCase(), String(socket.data.familyPlayerId), String(text ?? ""));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("f_number", ({ roomCode, value }: { roomCode: string; value: number }) => {
    try {
      familyService.submitNumber(roomCode.toUpperCase(), String(socket.data.familyPlayerId), Number(value));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("f_skip_round", ({ roomCode }: { roomCode: string }) => {
    try {
      familyService.skipRound(roomCode.toUpperCase(), String(socket.data.familyPlayerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("f_reset_room", ({ roomCode }: { roomCode: string }) => {
    try {
      familyService.resetRoom(roomCode.toUpperCase(), String(socket.data.familyPlayerId));
    } catch (error) {
      socket.emit("error_message", { message: getErrorMessage(error) });
    }
  });

  socket.on("disconnect", async () => {
    if (socket.data.roomCode && socket.data.playerId) {
      await gameService.setOnlineStatus(String(socket.data.roomCode), String(socket.data.playerId), false);
      io.to(String(socket.data.roomCode)).emit("player_presence_changed", { playerId: String(socket.data.playerId), isOnline: false });
    }
    if (socket.data.personalityRoomCode && socket.data.personalityPlayerId) {
      personalityService.setOnlineStatus(String(socket.data.personalityRoomCode), String(socket.data.personalityPlayerId), false);
      emitPersonalityState(String(socket.data.personalityRoomCode));
    }
    if (socket.data.tabooRoomCode && socket.data.tabooPlayerId) {
      tabooService.setOnlineStatus(String(socket.data.tabooRoomCode), String(socket.data.tabooPlayerId), false);
      emitTabooState(String(socket.data.tabooRoomCode));
    }
    if (socket.data.codenamesRoomCode && socket.data.codenamesPlayerId) {
      codenamesService.setOnlineStatus(String(socket.data.codenamesRoomCode), String(socket.data.codenamesPlayerId), false);
      emitCodenamesState(String(socket.data.codenamesRoomCode));
    }
    if (socket.data.familyRoomCode && socket.data.familyPlayerId) {
      familyService.setOnlineStatus(String(socket.data.familyRoomCode), String(socket.data.familyPlayerId), false);
      emitFamilyState(String(socket.data.familyRoomCode));
    }
  });
});

// All game state lives in memory, so losing the process loses every active
// room. A single bad round is not worth that — log loudly and keep serving.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (server kept alive):", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception (server kept alive):", error);
});

/** Never let an optional dependency stop the server from starting. */
async function tryConnect(label: string, connect: () => Promise<unknown>, ms: number) {
  try {
    await Promise.race([
      connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);
    console.log(`${label}: connected`);
  } catch (error) {
    console.warn(`${label}: unavailable, continuing without it —`, error instanceof Error ? error.message : error);
  }
}

async function bootstrap() {
  if (serverConfig.redisUrl) await tryConnect("Redis", () => redis.connect(), 4000);
  if (serverConfig.mongodbUri) {
    await tryConnect("MongoDB", async () => {
      await mongo.connect();
      await mongo.repairRoomIndexes();
    }, 8000);
  }

  // Failing to bind is not survivable — exit loudly instead of lingering as a
  // process that is alive but listening to nothing.
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `\nPort ${serverConfig.port} is already in use — another server is still running.\n` +
        `  netstat -ano | findstr :${serverConfig.port}\n` +
        `  taskkill /PID <pid> /F\n`,
      );
    } else {
      console.error("Server failed to start:", error);
    }
    process.exit(1);
  });

  server.listen(serverConfig.port, () => {
    console.log(`Server listening on http://localhost:${serverConfig.port}`);
    console.log(
      serverConfig.openAiApiKey
        ? `OpenAI: on — "מי מהמשפחה?" uses ${serverConfig.familySurveyModel} (lobby) and ${serverConfig.familyOpenAiModel} (rounds)`
        : 'OpenAI: OFF — no OPENAI_API_KEY found, games fall back to their built-in questions',
    );
  });
}

void bootstrap();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
