"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createRoom, joinRoom } from "../lib/api";
import { listSessions, saveSession, type StoredSession } from "../lib/storage";

export function LandingShell() {
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [createNickname, setCreateNickname] = useState("");
  const [joinNickname, setJoinNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<"classic" | "advanced">("classic");
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"create" | "join" | null>(null);
  const [existingSessions, setExistingSessions] = useState<StoredSession[]>([]);

  useEffect(() => {
    setExistingSessions(listSessions());
  }, []);

  function validateNickname(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return "הכנס שם שחקן";
    if (trimmed.length < 2) return "שם קצר מדי — לפחות 2 תווים";
    if (trimmed.length > 20) return "שם ארוך מדי — עד 20 תווים";
    return null;
  }

  async function handleCreate() {
    const err = validateNickname(createNickname);
    if (err) { setMessage(err); return; }
    try {
      setBusyAction("create");
      setMessage(null);
      const result = await createRoom({ nickname: createNickname.trim(), settings: { mode } });
      saveSession({ roomCode: result.room.room.code, playerId: result.playerId, sessionToken: result.sessionToken });
      router.push(`/rooms/${result.room.room.code}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "לא ניתן ליצור חדר כרגע");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleJoin() {
    const err = validateNickname(joinNickname);
    if (err) { setMessage(err); return; }
    if (!joinCode.trim()) { setMessage("הכנס קוד חדר"); return; }
    try {
      setBusyAction("join");
      setMessage(null);
      const code = joinCode.toUpperCase().trim();
      const result = await joinRoom(code, { nickname: joinNickname.trim() });
      saveSession({ roomCode: code, playerId: result.playerId, sessionToken: result.sessionToken });
      router.push(`/rooms/${code}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "לא ניתן להצטרף לחדר כרגע");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="landing-main">
      <div className="landing-center">
        <header className="landing-header">
          <div className="game-logo" aria-hidden>🗺️</div>
          <h1 className="game-title">ארץ עיר</h1>
          <p className="game-subtitle">משחק קטגוריות מולטיפלייר • בזמן אמת</p>
        </header>

        {/* Rejoin existing rooms */}
        {existingSessions.length > 0 ? (
          <div className="existing-rooms">
            <span className="existing-rooms-label">חדרים שהיית בהם</span>
            <div className="existing-rooms-list">
              {existingSessions.map((s) => (
                <a key={s.roomCode} href={`/rooms/${s.roomCode}`} className="existing-room-btn">
                  <span className="existing-room-code">{s.roomCode}</span>
                  <span className="existing-room-cta">המשך ›</span>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <div className="panel landing-card">
          <div className="landing-tabs">
            <button
              className={`tab-btn${tab === "create" ? " tab-btn-active" : ""}`}
              onClick={() => { setTab("create"); setMessage(null); }}
              type="button"
            >
              צור חדר חדש
            </button>
            <button
              className={`tab-btn${tab === "join" ? " tab-btn-active" : ""}`}
              onClick={() => { setTab("join"); setMessage(null); }}
              type="button"
            >
              הצטרף לחדר
            </button>
          </div>

          {tab === "create" ? (
            <div className="landing-form">
              <div className="field">
                <label htmlFor="createNickname">השם שלך במשחק</label>
                <input
                  id="createNickname"
                  className="input"
                  value={createNickname}
                  onChange={(e) => setCreateNickname(e.target.value)}
                  placeholder="לדוגמה: יוני"
                  maxLength={20}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
                />
              </div>

              <div className="field">
                <label>מצב משחק</label>
                <div className="mode-toggle">
                  <button type="button" className={`mode-btn${mode === "classic" ? " mode-btn-active" : ""}`} onClick={() => setMode("classic")}>
                    <span className="mode-icon">🔤</span>
                    <span className="mode-text"><strong>Classic</strong><span>אות אחת בהתחלה</span></span>
                  </button>
                  <button type="button" className={`mode-btn${mode === "advanced" ? " mode-btn-active" : ""}`} onClick={() => setMode("advanced")}>
                    <span className="mode-icon">🔀</span>
                    <span className="mode-text"><strong>Advanced</strong><span>שתי אותיות בתוך המילה</span></span>
                  </button>
                </div>
              </div>

              <button className="button button-full" disabled={busyAction !== null} onClick={() => void handleCreate()} type="button">
                {busyAction === "create" ? "יוצר חדר..." : "צור חדר ›"}
              </button>
            </div>
          ) : (
            <div className="landing-form">
              <div className="field">
                <label htmlFor="joinCode">קוד החדר</label>
                <input
                  id="joinCode"
                  className="input input-code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  maxLength={8}
                  autoCapitalize="characters"
                />
              </div>

              <div className="field">
                <label htmlFor="joinNickname">השם שלך במשחק</label>
                <input
                  id="joinNickname"
                  className="input"
                  value={joinNickname}
                  onChange={(e) => setJoinNickname(e.target.value)}
                  placeholder="מי נכנס?"
                  maxLength={20}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleJoin(); }}
                />
              </div>

              <button className="button-secondary button-full" disabled={busyAction !== null} onClick={() => void handleJoin()} type="button">
                {busyAction === "join" ? "מצטרף..." : "הצטרף לחדר ›"}
              </button>
            </div>
          )}

          {message ? <div className="message-banner">{message}</div> : null}
        </div>
      </div>
    </main>
  );
}
