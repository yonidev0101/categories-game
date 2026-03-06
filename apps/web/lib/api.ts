import type {
  CreateRoomInput,
  CreateRoomResponse,
  JoinRoomInput,
  JoinRoomResponse,
  RoomStateSnapshot,
  UpdateRoomSettingsInput
} from "@categories-game/shared";
import { getClientConfig } from "./config";

async function fetchJson<T>(path: string, init: RequestInit): Promise<T> {
  const { apiUrl } = getClientConfig();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({ message: "Request failed" }))) as { message?: string };
    throw new Error(errorBody.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export function createRoom(input: CreateRoomInput): Promise<CreateRoomResponse & { playerId: string }> {
  return fetchJson("/rooms", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function joinRoom(roomCode: string, input: JoinRoomInput): Promise<JoinRoomResponse & { playerId: string }> {
  return fetchJson(`/rooms/${roomCode}/join`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function startRoom(roomCode: string, playerId: string): Promise<{ room: RoomStateSnapshot }> {
  return fetchJson(`/rooms/${roomCode}/start`, {
    method: "POST",
    body: JSON.stringify({ playerId })
  });
}

export function getRoomState(roomCode: string, playerId?: string): Promise<{ room: RoomStateSnapshot }> {
  const query = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
  return fetchJson(`/rooms/${roomCode}/state${query}`, {
    method: "GET"
  });
}

export function updateRoomSettings(roomCode: string, input: UpdateRoomSettingsInput): Promise<{ room: RoomStateSnapshot }> {
  return fetchJson(`/rooms/${roomCode}/settings`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function rerollRoomLetters(roomCode: string, playerId: string): Promise<{ room: RoomStateSnapshot }> {
  return fetchJson(`/rooms/${roomCode}/reroll-letters`, {
    method: "POST",
    body: JSON.stringify({ playerId })
  });
}


