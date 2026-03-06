const STORAGE_PREFIX = "categories-game";

export interface StoredSession {
  roomCode: string;
  playerId: string;
  sessionToken: string;
}

export function getRoomStorageKey(roomCode: string): string {
  return `${STORAGE_PREFIX}:${roomCode.toUpperCase()}`;
}

export function saveSession(session: StoredSession) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(getRoomStorageKey(session.roomCode), JSON.stringify(session));
}

export function listSessions(): StoredSession[] {
  if (typeof window === "undefined") return [];
  const prefix = `${STORAGE_PREFIX}:`;
  return Object.keys(localStorage)
    .filter((k) => k.startsWith(prefix))
    .flatMap((k) => {
      try { return [JSON.parse(localStorage.getItem(k) ?? "") as StoredSession]; }
      catch { return []; }
    });
}

export function readSession(roomCode: string): StoredSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(getRoomStorageKey(roomCode));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}


