import { getClientConfig } from "./config";
import type {
  CreateCodenamesRoomResponse,
  JoinCodenamesRoomResponse,
  CodenamesSnapshot,
  CodenamesSettings,
} from "@categories-game/shared";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function createCodenamesRoom(nickname: string): Promise<CreateCodenamesRoomResponse> {
  const { apiUrl } = getClientConfig();
  return fetchJson<CreateCodenamesRoomResponse>(`${apiUrl}/codenames-rooms`, {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

export async function joinCodenamesRoom(roomCode: string, nickname: string): Promise<JoinCodenamesRoomResponse> {
  const { apiUrl } = getClientConfig();
  return fetchJson<JoinCodenamesRoomResponse>(`${apiUrl}/codenames-rooms/${roomCode.toUpperCase()}/join`, {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

export async function getCodenamesRoomState(roomCode: string, playerId?: string | null): Promise<CodenamesSnapshot> {
  const { apiUrl } = getClientConfig();
  const qs = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
  const data = await fetchJson<{ room: CodenamesSnapshot }>(`${apiUrl}/codenames-rooms/${roomCode.toUpperCase()}/state${qs}`);
  return data.room;
}

export async function updateCodenamesSettings(
  roomCode: string,
  playerId: string,
  settings: Partial<CodenamesSettings>,
): Promise<void> {
  const { apiUrl } = getClientConfig();
  await fetchJson<unknown>(`${apiUrl}/codenames-rooms/${roomCode.toUpperCase()}/settings`, {
    method: "PATCH",
    body: JSON.stringify({ playerId, settings }),
  });
}
