import { getClientConfig } from "./config";
import type { CreateTabooRoomResponse, JoinTabooRoomResponse, TabooSnapshot, TabooSettings } from "@categories-game/shared";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function createTabooRoom(nickname: string): Promise<CreateTabooRoomResponse> {
  const { apiUrl } = getClientConfig();
  return fetchJson<CreateTabooRoomResponse>(`${apiUrl}/taboo-rooms`, {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

export async function joinTabooRoom(roomCode: string, nickname: string): Promise<JoinTabooRoomResponse> {
  const { apiUrl } = getClientConfig();
  return fetchJson<JoinTabooRoomResponse>(`${apiUrl}/taboo-rooms/${roomCode.toUpperCase()}/join`, {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

export async function getTabooRoomState(roomCode: string, playerId?: string | null): Promise<TabooSnapshot> {
  const { apiUrl } = getClientConfig();
  const qs = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
  const data = await fetchJson<{ room: TabooSnapshot }>(`${apiUrl}/taboo-rooms/${roomCode.toUpperCase()}/state${qs}`);
  return data.room;
}

export async function updateTabooSettings(
  roomCode: string,
  playerId: string,
  settings: Partial<TabooSettings>,
): Promise<TabooSnapshot> {
  const { apiUrl } = getClientConfig();
  return fetchJson<TabooSnapshot>(`${apiUrl}/taboo-rooms/${roomCode.toUpperCase()}/settings`, {
    method: "PATCH",
    body: JSON.stringify({ playerId, settings }),
  });
}
