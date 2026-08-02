import { getClientConfig } from "./config";
import type { CreateFamilyRoomResponse, JoinFamilyRoomResponse, FamilySnapshot } from "@categories-game/shared";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function createFamilyRoom(
  nickname: string,
  partnerName?: string,
  mode: "family" | "couple" = "family",
): Promise<CreateFamilyRoomResponse> {
  const { apiUrl } = getClientConfig();
  return fetchJson<CreateFamilyRoomResponse>(`${apiUrl}/family-rooms`, {
    method: "POST",
    body: JSON.stringify({ nickname, partnerName, mode }),
  });
}

export async function joinFamilyRoom(roomCode: string, nickname: string, partnerName?: string): Promise<JoinFamilyRoomResponse> {
  const { apiUrl } = getClientConfig();
  return fetchJson<JoinFamilyRoomResponse>(`${apiUrl}/family-rooms/${roomCode.toUpperCase()}/join`, {
    method: "POST",
    body: JSON.stringify({ nickname, partnerName }),
  });
}

export async function getFamilyRoomState(roomCode: string, playerId?: string | null): Promise<FamilySnapshot> {
  const { apiUrl } = getClientConfig();
  const qs = playerId ? `?playerId=${encodeURIComponent(playerId)}` : "";
  const data = await fetchJson<{ room: FamilySnapshot }>(`${apiUrl}/family-rooms/${roomCode.toUpperCase()}/state${qs}`);
  return data.room;
}
