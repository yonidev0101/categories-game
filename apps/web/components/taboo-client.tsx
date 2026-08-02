"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../lib/socket";
import { getTabooRoomState } from "../lib/taboo-api";
import { readSession } from "../lib/storage";
import type { TabooSnapshot, TabooSettings } from "@categories-game/shared";

const PLAYER_COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#f97316", "#a855f7", "#14b8a6"];

function playerColor(index: number) {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

function Avatar({ nickname, index, size = 36 }: { nickname: string; index: number; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: playerColor(index),
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: size * 0.38, color: "#fff", flexShrink: 0,
    }}>
      {nickname[0]}
    </div>
  );
}

function TimerRing({ timeLeft, total }: { timeLeft: number; total: number }) {
  const pct = Math.max(0, timeLeft / total);
  const r = 28;
  const circ = 2 * Math.PI * r;
  const danger = pct < 0.25;
  const color = danger ? "#f87171" : pct < 0.5 ? "#f59e0b" : "#10b981";
  return (
    <div className="t-timer-ring-wrap">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4" />
        <circle
          cx="36" cy="36" r={r} fill="none"
          stroke={color} strokeWidth="4"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ transition: "stroke-dashoffset 0.9s linear, stroke 0.3s" }}
        />
      </svg>
      <span className="t-timer-value" style={{ color: danger ? "#f87171" : undefined }}>
        {timeLeft}
      </span>
    </div>
  );
}

interface Props { roomCode: string }

export function TabooClient({ roomCode }: Props) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<TabooSnapshot | null>(null);
  const [hintInput, setHintInput] = useState("");
  const [guessInput, setGuessInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const socket = getSocket();
  const room = snapshot?.room;
  const me = snapshot?.me;
  const myPlayer = room?.players.find((p) => p.id === me?.playerId);
  const isHost = myPlayer?.isHost ?? false;

  const currentExplainerId = room ? room.explainerOrder[room.currentExplainerIndex] : null;
  const isExplainer = me?.playerId !== null && me?.playerId === currentExplainerId;
  const currentExplainer = room?.players.find((p) => p.id === currentExplainerId);

  useEffect(() => {
    const session = readSession(roomCode);
    if (!session) { router.push("/"); return; }

    void getTabooRoomState(roomCode, session.playerId)
      .then(setSnapshot)
      .catch(() => router.push("/"));

    if (!socket.connected) socket.connect();

    socket.on("taboo_state", (snap: TabooSnapshot) => { setSnapshot(snap); });
    socket.on("error_message", ({ message: msg }: { message: string }) => {
      setMessage(msg);
      setTimeout(() => setMessage(null), 4000);
    });

    socket.emit("t_join_room", { roomCode: roomCode.toUpperCase(), sessionToken: session.sessionToken });

    return () => {
      socket.off("taboo_state");
      socket.off("error_message");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [room?.currentHints.length, room?.currentGuesses.length]);

  function emit(event: string, payload: object = {}) {
    socket.emit(event, { roomCode: roomCode.toUpperCase(), ...payload });
  }

  function sendHint() {
    const t = hintInput.trim();
    if (!t) return;
    emit("t_send_hint", { text: t });
    setHintInput("");
  }

  function makeGuess() {
    const t = guessInput.trim();
    if (!t) return;
    emit("t_make_guess", { text: t });
    setGuessInput("");
  }

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (!snapshot || !room) {
    return (
      <div className="p-loading-screen">
        <div className="p-loading-glow" style={{ background: "radial-gradient(circle, rgba(245,158,11,0.2) 0%, transparent 70%)" }} />
        <div className="p-loading-inner">
          <div className="p-loading-icon">🎯</div>
          <div className="p-loading-spinner-ring" style={{ borderTopColor: "#f59e0b" }} />
          <p className="p-loading-text">טוען חדר...</p>
          <div className="p-waiting-dots" style={{ marginTop: 0 }}>
            <span style={{ background: "#f59e0b" }} /><span style={{ background: "#f59e0b" }} /><span style={{ background: "#f59e0b" }} />
          </div>
        </div>
      </div>
    );
  }

  const { phase } = room;
  const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);

  // ── Lobby ────────────────────────────────────────────────────────────────────

  if (phase === "lobby") {
    return (
      <div className="room-layout" style={{ "--game-color": "rgba(245,158,11,0.2)" } as CSSProperties}>
        <header className="room-header">
          <div className="room-header-inner">
            <button className="back-btn" onClick={() => router.push("/")}>← חזרה</button>
            <span className="room-phase-badge" style={{ color: "#fbbf24", borderColor: "rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.08)" }}>
              🎯 טאבו — לובי
            </span>
          </div>
        </header>

        <div className="room-main">
          <div className="t-lobby-wrap">

            {/* Invite card */}
            <div className="t-invite-card">
              <div className="t-invite-label">🔗 הזמן חברים לחדר</div>
              <div className="t-invite-code-row">
                <span className="t-invite-code">{roomCode}</span>
                <div className="t-invite-actions">
                  <button className="t-invite-btn" onClick={() => void navigator.clipboard.writeText(roomCode)}>
                    📋 העתק קוד
                  </button>
                  <button className="t-invite-btn"
                    onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/taboo/${roomCode}`)}>
                    🔗 שתף קישור
                  </button>
                </div>
              </div>
            </div>

            {/* Players */}
            <div className="t-players-card">
              <div className="t-players-header">
                <span className="t-players-title">שחקנים</span>
                <span className="t-players-count">{room.players.length} מחוברים</span>
              </div>
              {room.players.map((p, i) => (
                <div key={p.id} className="t-player-row">
                  <Avatar nickname={p.nickname} index={i} />
                  <span className="t-player-name">{p.nickname}</span>
                  <div className="t-player-badges">
                    {p.isHost && <span className="t-badge t-badge-host">👑 מארח</span>}
                    {!p.isOnline && <span className="t-badge t-badge-offline">⚫ אופליין</span>}
                  </div>
                </div>
              ))}

              {/* Settings (host only) */}
              {isHost && (
                <div className="t-settings-section">
                  <div className="t-settings-title">⚙️ הגדרות משחק</div>
                  <div className="t-settings-grid">
                    <div className="t-setting-item">
                      <label className="t-setting-label">סיבובים</label>
                      <div className="t-setting-btns">
                        {[1, 2, 3].map((v) => (
                          <button key={v}
                            className={`t-setting-btn${room.settings.rounds === v ? " t-setting-btn-active" : ""}`}
                            onClick={() => emit("t_update_settings", { settings: { rounds: v } })}>
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="t-setting-item">
                      <label className="t-setting-label">מילים לתור</label>
                      <div className="t-setting-btns">
                        {[3, 5, 7].map((v) => (
                          <button key={v}
                            className={`t-setting-btn${room.settings.wordsPerTurn === v ? " t-setting-btn-active" : ""}`}
                            onClick={() => emit("t_update_settings", { settings: { wordsPerTurn: v } })}>
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="t-setting-item">
                      <label className="t-setting-label">שניות למילה</label>
                      <div className="t-setting-btns">
                        {[30, 60, 90].map((v) => (
                          <button key={v}
                            className={`t-setting-btn${room.settings.secondsPerWord === v ? " t-setting-btn-active" : ""}`}
                            onClick={() => emit("t_update_settings", { settings: { secondsPerWord: v } })}>
                            {v}″
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!isHost && (
                <div className="t-settings-preview">
                  <span>🔄 {room.settings.rounds} סיבוב{room.settings.rounds > 1 ? "ים" : ""}</span>
                  <span>•</span>
                  <span>📝 {room.settings.wordsPerTurn} מילים</span>
                  <span>•</span>
                  <span>⏱️ {room.settings.secondsPerWord}″ למילה</span>
                </div>
              )}

              <div className="p-start-section">
                {isHost ? (
                  <button className="t-start-btn" disabled={room.players.length < 2}
                    onClick={() => emit("t_start_game")}>
                    {room.players.length < 2 ? "⏳ ממתין לשחקן נוסף..." : "התחל משחק 🎯"}
                  </button>
                ) : (
                  <p className="p-wait-text">⏳ ממתין שהמארח יתחיל...</p>
                )}
              </div>
            </div>

            {/* Rules */}
            <div className="t-rules-card">
              <div className="t-rules-title">איך משחקים?</div>
              <ul className="p-rules-list">
                {[
                  "כל תור שחקן אחד מסביר מילה — בלי לומר את המילים האסורות",
                  "המנחשים מקלידים ניחושות — מי שמנחש נכון מקבל נקודה",
                  <>אם המסביר אמר מילה אסורה — <strong style={{ color: "#fbbf24" }}>הכרטיס בוטל אוטומטית!</strong></>,
                  "כל שחקן מסביר בכל סיבוב — הכי הרבה נקודות מנצח",
                ].map((rule, i) => (
                  <li key={i} className="p-rule-item">
                    <span className="p-rule-num" style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b" }}>{i + 1}</span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>

        {message && <div className="message-banner">{message}</div>}
      </div>
    );
  }

  // ── Playing ──────────────────────────────────────────────────────────────────

  if (phase === "playing") {
    const isWaiting = !room.currentWord && !room.currentTurn;
    const wordsLeft = room.settings.wordsPerTurn - room.currentWordIndex;

    return (
      <div className="room-layout" style={{ "--game-color": "rgba(245,158,11,0.2)" } as CSSProperties}>
        <header className="room-header">
          <div className="room-header-inner">
            <div className="t-status-left">
              <span className="t-round-badge">
                סיבוב {room.roundNumber}/{room.settings.rounds}
              </span>
              {room.wordTimeLeft !== null && (
                <TimerRing timeLeft={room.wordTimeLeft} total={room.settings.secondsPerWord} />
              )}
            </div>
            <div className="t-scoreboard-mini">
              {sortedPlayers.slice(0, 3).map((p, i) => (
                <div key={p.id} className="t-score-chip">
                  <Avatar nickname={p.nickname} index={room.players.findIndex((x) => x.id === p.id)} size={20} />
                  <span>{p.score}</span>
                </div>
              ))}
            </div>
          </div>
        </header>

        <div className="room-main">

          {/* Waiting between turns */}
          {isWaiting && (
            <div className="t-turn-waiting">
              <div className="t-turn-waiting-icon">⏳</div>
              <p className="t-turn-waiting-text">מכינים את הסיבוב...</p>
              <div className="p-waiting-dots" style={{ justifyContent: "center" }}>
                <span style={{ background: "#f59e0b" }} /><span style={{ background: "#f59e0b" }} /><span style={{ background: "#f59e0b" }} />
              </div>
            </div>
          )}

          {/* Turn header */}
          {room.currentTurn && (
            <div className="t-turn-header">
              <Avatar nickname={currentExplainer?.nickname ?? "?"} index={room.currentExplainerIndex} size={32} />
              <div>
                <div className="t-turn-explainer">
                  {isExplainer ? "התור שלך להסביר!" : `${currentExplainer?.nickname} מסביר/ת`}
                </div>
                <div className="t-turn-meta">
                  מילה {room.currentWordIndex + 1} מתוך {room.settings.wordsPerTurn}
                  {" · "}
                  {room.currentTurn.points} נוחשו ✓
                </div>
              </div>
            </div>
          )}

          {/* Explainer: secret word card */}
          {isExplainer && room.currentWord && (
            <div className="t-word-card">
              <div className="t-word-card-glow" />
              <div className="t-word-label">המילה שלך — אל תגיד אותה!</div>
              <div className="t-secret-word">{room.currentWord}</div>
              <div className="t-forbidden-section">
                <div className="t-forbidden-title">🚫 מילים אסורות</div>
                <div className="t-forbidden-list">
                  {(room.forbiddenWords ?? []).map((w, i) => (
                    <span key={i} className="t-forbidden-pill">{w}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Guesser: mystery word placeholder */}
          {!isExplainer && room.currentTurn && room.currentWordIndex < room.settings.wordsPerTurn && (
            <div className="t-mystery-card">
              <div className="t-mystery-icon">🎯</div>
              <div className="t-mystery-word">? ? ?</div>
              <div className="t-mystery-sub">
                {currentExplainer?.nickname} מסביר — נחשו!
              </div>
            </div>
          )}

          {/* Chat: hints + guesses merged */}
          {room.currentTurn && (
            <div className="t-chat-card">
              <div className="p-chat-header">
                <span className="p-chat-title">{isExplainer ? "ניחושות השחקנים" : "רמזים וניחושות"}</span>
                <span className="p-chat-count">{room.currentHints.length + room.currentGuesses.length}</span>
              </div>
              <div ref={chatRef} className="t-chat-list">
                {room.currentHints.length === 0 && room.currentGuesses.length === 0 && (
                  <div className="p-chat-empty">
                    {isExplainer ? "הסבר את המילה בלי לומר אותה..." : "מחכים לרמזים..."}
                  </div>
                )}
                {/* Merge hints + guesses sorted by timestamp */}
                {[
                  ...room.currentHints.map((h) => ({ type: "hint" as const, item: h, ts: h.timestamp })),
                  ...room.currentGuesses.map((g) => ({ type: "guess" as const, item: g, ts: g.timestamp })),
                ]
                  .sort((a, b) => a.ts.localeCompare(b.ts))
                  .map(({ type, item }) => {
                    if (type === "hint") {
                      return (
                        <div key={item.id} className={`t-hint-row${item.isViolation ? " t-hint-violation" : ""}`}>
                          <span className="t-hint-badge">{item.isViolation ? "🚫" : "💬"}</span>
                          <span className="t-hint-text">{item.text}</span>
                          {item.isViolation && <span className="t-violation-label">הפרה!</span>}
                        </div>
                      );
                    }
                    const gIdx = room.players.findIndex((p) => p.id === item.guesserId);
                    return (
                      <div key={item.id} className={`t-guess-row-chat${item.correct ? " t-guess-correct" : ""}`}>
                        <Avatar nickname={item.guesserNickname} index={gIdx >= 0 ? gIdx : 0} size={22} />
                        <span className="t-guess-text-chat">{item.text}</span>
                        {item.correct && <span className="t-correct-badge">✅ נכון!</span>}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Resolved words in current turn */}
          {(() => {
            const currentTurnRecord = room.turns.find((t) => t.id === room.currentTurn?.id);
            const completedWords = currentTurnRecord?.words ?? [];
            if (completedWords.length === 0) return null;
            return (
              <div className="t-words-strip">
                {completedWords.map((w) => (
                  <span key={w.id} className={`t-word-chip ${w.resolvedBy ? "t-word-chip-ok" : w.violated ? "t-word-chip-bad" : "t-word-chip-skip"}`}>
                    {w.violated ? "🚫" : w.skipped ? "⏭️" : w.timedOut ? "⏰" : "✅"} {w.word}
                  </span>
                ))}
              </div>
            );
          })()}

          {/* Explainer controls */}
          {isExplainer && room.currentWord && (
            <div className="t-explainer-bar">
              <div className="t-hint-row-input">
                <input className="input t-hint-input"
                  placeholder="הסבר את המילה..."
                  value={hintInput}
                  onChange={(e) => setHintInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") sendHint(); }}
                />
                <button className="t-send-btn" onClick={sendHint} disabled={!hintInput.trim()}>
                  שלח
                </button>
              </div>
              <button className="t-skip-btn" onClick={() => emit("t_skip_word")}>
                ⏭️ דלג על המילה
              </button>
            </div>
          )}

          {/* Guesser controls */}
          {!isExplainer && room.currentWord !== undefined && room.currentTurn && (
            <div className="t-guesser-bar">
              <div className="t-hint-row-input">
                <input className="input t-hint-input"
                  placeholder="מה המילה? נחש כאן..."
                  value={guessInput}
                  onChange={(e) => setGuessInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") makeGuess(); }}
                />
                <button className="t-guess-btn-send" onClick={makeGuess} disabled={!guessInput.trim()}>
                  ניחש
                </button>
              </div>
            </div>
          )}

          {message && <div className="message-banner">{message}</div>}
        </div>
      </div>
    );
  }

  // ── Game Over ────────────────────────────────────────────────────────────────

  if (phase === "game_over") {
    const winner = sortedPlayers[0];
    const tied = sortedPlayers.filter((p) => p.score === winner?.score);

    return (
      <div className="room-layout" style={{ "--game-color": "rgba(245,158,11,0.2)" } as CSSProperties}>
        <div className="room-main">

          {/* Winner */}
          <div className="t-result-card">
            <div className="t-result-emoji">🏆</div>
            <h2 className="t-result-title">
              {tied.length > 1
                ? `תיקו בין ${tied.map((p) => p.nickname).join(" ו")}!`
                : `${winner?.nickname} ניצח/ה!`}
            </h2>
            <div className="t-leaderboard">
              {sortedPlayers.map((p, i) => {
                const pIdx = room.players.findIndex((x) => x.id === p.id);
                return (
                  <div key={p.id} className={`t-lb-row${i === 0 ? " t-lb-row-first" : ""}`}>
                    <span className="t-lb-rank">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}</span>
                    <Avatar nickname={p.nickname} index={pIdx} size={28} />
                    <span className="t-lb-name">{p.nickname}</span>
                    <span className="t-lb-score">{p.score} נק׳</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Turn history */}
          {room.turns.length > 0 && (
            <div className="t-history-card">
              <div className="t-history-title">📋 סיכום תורות</div>
              {room.turns.map((turn) => {
                const pIdx = room.players.findIndex((p) => p.id === turn.explainerId);
                return (
                  <div key={turn.id} className="t-turn-summary">
                    <div className="t-turn-summary-header">
                      <Avatar nickname={turn.explainerNickname} index={pIdx} size={22} />
                      <span className="t-turn-summary-name">{turn.explainerNickname}</span>
                      <span className="t-turn-summary-badge">סיבוב {turn.roundNumber}</span>
                      <span className="t-turn-summary-score">+{turn.points}</span>
                    </div>
                    <div className="t-turn-words-row">
                      {turn.words.map((w) => (
                        <span key={w.id} className={`t-word-chip ${w.resolvedBy ? "t-word-chip-ok" : w.violated ? "t-word-chip-bad" : "t-word-chip-skip"}`}>
                          {w.violated ? "🚫" : w.skipped ? "⏭️" : w.timedOut ? "⏰" : "✅"} {w.word}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {isHost ? (
            <button className="t-start-btn" style={{ marginTop: 4 }} onClick={() => emit("t_reset_room")}>
              🔄 משחק נוסף
            </button>
          ) : (
            <p className="p-wait-text" style={{ marginTop: 8 }}>ממתין שהמארח יתחיל מחדש...</p>
          )}

        </div>
      </div>
    );
  }

  return null;
}
