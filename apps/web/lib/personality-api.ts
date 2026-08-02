import { getClientConfig } from "./config";
import type { PersonalitySnapshot, CreatePersonalityRoomResponse, JoinPersonalityRoomResponse } from "@categories-game/shared";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function createPersonalityRoom(nickname: string): Promise<CreatePersonalityRoomResponse> {
  const { apiUrl } = getClientConfig();
  return fetchJson<CreatePersonalityRoomResponse>(`${apiUrl}/personality-rooms`, {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

export async function joinPersonalityRoom(roomCode: string, nickname: string): Promise<JoinPersonalityRoomResponse> {
  const { apiUrl } = getClientConfig();
  return fetchJson<JoinPersonalityRoomResponse>(`${apiUrl}/personality-rooms/${roomCode.toUpperCase()}/join`, {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

export async function getPersonalityRoomState(roomCode: string, playerId?: string | null): Promise<PersonalitySnapshot> {
  const { apiUrl } = getClientConfig();
  const qs = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
  const data = await fetchJson<{ room: PersonalitySnapshot }>(`${apiUrl}/personality-rooms/${roomCode.toUpperCase()}/state${qs}`);
  return data.room;
}
