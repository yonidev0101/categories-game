"use client";

import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../lib/socket";
import { readSession } from "../lib/storage";
import { getCodenamesRoomState } from "../lib/codenames-api";
import type {
  CodenamesSnapshot,
  CodenamesTeam,
  CodenamesRole,
  CodenamesCardView,
  CodenamesSettings,
} from "@categories-game/shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLAYER_COLORS = [
  "#6366f1", "#a855f7", "#f59e0b", "#10b981",
  "#ef4444", "#3b82f6", "#ec4899", "#14b8a6",
];

function playerColor(idx: number) { return PLAYER_COLORS[idx % PLAYER_COLORS.length]; }

function Avatar({ name, size = 32, idx = 0 }: { name: string; size?: number; idx?: number }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size, height: size, borderRadius: "50%",
      background: `${playerColor(idx)}33`,
      border: `2px solid ${playerColor(idx)}`,
      color: playerColor(idx),
      fontWeight: 700, fontSize: size * 0.38,
      flexShrink: 0,
    }}>
      {name.slice(0, 2)}
    </span>
  );
}

// ─── Countdown hook ────────────────────────────────────────────────────────────

function useCountdown(endsAt: string | null | undefined): number | null {
  const [val, setVal] = useState<number | null>(null);
  useEffect(() => {
    if (!endsAt) { setVal(null); return; }
    const tick = () => setVal(Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [endsAt]);
  return val;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      background: "#0f1e33", border: "1px solid rgba(239,68,68,0.4)",
      borderRadius: 12, padding: "12px 20px", color: "#fca5a5",
      fontSize: 14, fontWeight: 600, zIndex: 9999,
      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
      maxWidth: 360, textAlign: "center",
    }}>
      {message}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function CodenamesClient({ roomCode }: { roomCode: string }) {
  const router     = useRouter();
  const sessionRef = useRef(readSession(roomCode));

  const [hydrated,   setHydrated]  = useState(false);
  const [snapshot,   setSnapshot]  = useState<CodenamesSnapshot | null>(null);
  const [clueWord,   setClueWord]  = useState("");
  const [clueNumber, setClueNum]   = useState(3);
  const [busy,       setBusy]      = useState<string | null>(null);
  const [toast,      setToast]     = useState<string | null>(null);

  const countdown = useCountdown(snapshot?.currentTurn?.turnEndsAt);
  const showToast = useCallback((msg: string) => setToast(msg), []);

  // ── Socket setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    setHydrated(true);
    const session = sessionRef.current;
    if (!session) { router.push("/"); return; }

    const socket = getSocket();
    socket.on("cn_state", (snap: CodenamesSnapshot) => setSnapshot(snap));
    socket.on("error_message", ({ message }: { message: string }) => {
      showToast(message); setBusy(null);
    });

    socket.connect();
    socket.emit("cn_join_room", { roomCode, sessionToken: session.sessionToken });

    void getCodenamesRoomState(roomCode, session.playerId)
      .then(setSnapshot)
      .catch(() => router.push("/"));

    return () => {
      socket.off("cn_state");
      socket.off("error_message");
      socket.disconnect();
    };
  }, [roomCode, router, showToast]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (!hydrated || !snapshot) {
    return (
      <div className="cn-loading">
        <span className="cn-loading-icon">🕵️</span>
        <div className="cn-loading-title">טוען משחק...</div>
      </div>
    );
  }

  const session = sessionRef.current!;
  const myId    = session.playerId;
  const me      = snapshot.players.find((p) => p.id === myId);
  const isHost  = myId === snapshot.hostPlayerId;
  const socket  = getSocket();

  function emit(event: string, data: Record<string, unknown>) {
    socket.emit(event, { roomCode, ...data });
  }

  const turn        = snapshot.currentTurn;
  const myTeam      = me?.team ?? null;
  const myRole      = me?.role ?? null;
  const isMyTurn    = turn?.team === myTeam;
  const isSpymaster = myRole === "spymaster";
  const canGiveClue = isMyTurn && isSpymaster && turn?.phase === "giving_clue";
  const canGuess    = isMyTurn && !isSpymaster && turn?.phase === "guessing";
  const canEndTurn  = canGuess;

  const redPlayers    = snapshot.players.filter((p) => p.team === "red");
  const bluePlayers   = snapshot.players.filter((p) => p.team === "blue");
  const noTeamPlayers = snapshot.players.filter((p) => !p.team);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  function handleSelectTeam(team: CodenamesTeam) { emit("cn_select_team", { team }); }
  function handleSelectRole(role: CodenamesRole) { emit("cn_select_role", { role }); }
  async function handleStartGame() {
    setBusy("start"); socket.emit("cn_start_game", { roomCode }); setBusy(null);
  }
  function handleGiveClue() {
    if (!clueWord.trim()) { showToast("הכנס מילה לרמז"); return; }
    setBusy("clue");
    emit("cn_give_clue", { clueWord: clueWord.trim(), clueNumber });
    setClueWord(""); setBusy(null);
  }
  function handleGuessCard(cardId: number) {
    if (!canGuess || busy) return;
    setBusy(`guess-${cardId}`);
    emit("cn_guess_card", { cardId });
    setBusy(null);
  }
  function handleEndTurn() { emit("cn_end_turn", {}); }
  function handleUpdateSettings(settings: Partial<CodenamesSettings>) {
    emit("cn_update_settings", { settings });
  }
  function handleResetRoom() { emit("cn_reset_room", {}); }

  // ── Phase: Generating ─────────────────────────────────────────────────────────
  if (snapshot.phase === "generating") {
    return (
      <div className="cn-loading">
        <span className="cn-loading-icon">🤖</span>
        <div className="cn-loading-title">AI מייצר מילים...</div>
        <div className="cn-loading-sub">25 מילים עבריות ייחודיות בדרך</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="dot-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
      </div>
    );
  }

  // ── Phase: Lobby ──────────────────────────────────────────────────────────────
  if (snapshot.phase === "lobby") {
    const redSpymaster  = redPlayers.find((p) => p.role === "spymaster");
    const blueSpymaster = bluePlayers.find((p) => p.role === "spymaster");
    const canStart      = isHost && redPlayers.length > 0 && bluePlayers.length > 0 && !!redSpymaster && !!blueSpymaster;

    const startBlockReason = !isHost ? null
      : !redPlayers.length  ? "הצוות האדום חסר שחקנים"
      : !bluePlayers.length ? "הצוות הכחול חסר שחקנים"
      : !redSpymaster       ? "הצוות האדום חסר מרגל ראשי"
      : !blueSpymaster      ? "הצוות הכחול חסר מרגל ראשי"
      : null;

    return (
      <div className="cn-page">
        <div className="cn-inner">

          {/* Header */}
          <div className="cn-topbar">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 26, filter: "drop-shadow(0 0 12px rgba(16,185,129,0.5))" }}>🕵️</span>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18, color: "#10b981", lineHeight: 1.1 }}>שם קוד</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>קוד חדר: {roomCode}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", padding: "3px 10px", borderRadius: 20, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
                {snapshot.players.length} שחקנים
              </span>
              <button className="back-btn" onClick={() => router.push("/")}>← יציאה</button>
            </div>
          </div>

          {/* Team columns */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {(["red", "blue"] as CodenamesTeam[]).map((team) => {
              const members   = team === "red" ? redPlayers : bluePlayers;
              const teamColor = team === "red" ? "#ef4444" : "#3b82f6";
              const teamLabel = team === "red" ? "🔴 צוות אדום" : "🔵 צוות כחול";
              const amOnTeam  = myTeam === team;

              return (
                <div key={team} className={`cn-team-card cn-team-card-${team}`}>
                  <div className="cn-team-title" style={{ color: teamColor }}>{teamLabel}</div>

                  {members.length === 0 && (
                    <div style={{ color: "var(--muted)", fontSize: 12, fontStyle: "italic", paddingBottom: 4 }}>
                      אין שחקנים עדיין
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {members.map((p, idx) => (
                      <div key={p.id} className="cn-player-row">
                        <Avatar name={p.nickname} size={24} idx={idx} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: p.isOnline ? "var(--text)" : "var(--muted)" }}>
                          {p.nickname}
                        </span>
                        {p.role === "spymaster" && (
                          <span className="cn-role-badge" style={{ background: `${teamColor}1a`, color: teamColor, borderColor: `${teamColor}44` }}>
                            מרגל
                          </span>
                        )}
                        {p.role === "operative" && (
                          <span className="cn-role-badge" style={{ background: "rgba(255,255,255,0.05)", color: "var(--muted)", borderColor: "rgba(255,255,255,0.1)" }}>
                            סוכן
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {!amOnTeam ? (
                    <button
                      className="cn-join-btn"
                      style={{ color: teamColor, borderColor: `${teamColor}55` }}
                      onClick={() => handleSelectTeam(team)}
                    >
                      הצטרף לצוות ›
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className={`cn-role-btn${myRole === "spymaster" ? ` cn-role-btn-active-${team}` : ""}`}
                        onClick={() => handleSelectRole("spymaster")}
                      >
                        🔍 מרגל
                      </button>
                      <button
                        className={`cn-role-btn${myRole === "operative" ? " cn-role-btn-active-neutral" : ""}`}
                        onClick={() => handleSelectRole("operative")}
                      >
                        🕵️ סוכן
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Players without a team */}
          {noTeamPlayers.length > 0 && (
            <div className="cn-no-team">
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>ממתינים לצוות</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {noTeamPlayers.map((p, idx) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, background: "rgba(255,255,255,0.05)", fontSize: 13 }}>
                    <Avatar name={p.nickname} size={22} idx={idx + snapshot.players.length} />
                    {p.nickname}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Settings (host only) */}
          {isHost && (
            <div className="cn-settings">
              <div className="cn-settings-title">⚙️ הגדרות</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>טיימר לתור:</span>
                  {[false, true].map((v) => (
                    <button
                      key={String(v)}
                      className={`cn-toggle-btn${snapshot.settings.timerEnabled === v ? " cn-toggle-btn-active" : ""}`}
                      onClick={() => handleUpdateSettings({ timerEnabled: v })}
                    >
                      {v ? "✓ פועל" : "כבוי"}
                    </button>
                  ))}
                </div>
                {snapshot.settings.timerEnabled && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>משך:</span>
                    {[60, 90, 120, 180].map((s) => (
                      <button
                        key={s}
                        className={`cn-toggle-btn${snapshot.settings.timerSeconds === s ? " cn-toggle-btn-active" : ""}`}
                        onClick={() => handleUpdateSettings({ timerSeconds: s })}
                      >
                        {s >= 60 ? `${s / 60}ד'` : `${s}ש'`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Start */}
          {isHost && (
            <div>
              {startBlockReason && <div className="cn-start-warn">⚠️ {startBlockReason}</div>}
              <button
                className="button button-full"
                disabled={!canStart || busy === "start"}
                onClick={() => void handleStartGame()}
                style={{ background: canStart ? "linear-gradient(135deg, #10b981, #059669)" : undefined, marginTop: 8 }}
              >
                {busy === "start" ? "מתחיל..." : "🕵️ התחל משחק ›"}
              </button>
            </div>
          )}

          {!isHost && (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, padding: "8px 0" }}>
              ממתין למנהל החדר להתחיל את המשחק...
            </div>
          )}

        </div>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </div>
    );
  }

  // ── Phase: Game Over ──────────────────────────────────────────────────────────
  if (snapshot.phase === "game_over") {
    const winnerColor = snapshot.winner === "red" ? "#ef4444" : "#3b82f6";
    const winnerLabel = snapshot.winner === "red" ? "הצוות האדום" : "הצוות הכחול";
    const byAssassin  = snapshot.winReason === "assassin";

    return (
      <div className="cn-page">
        <div className="cn-inner">

          <div
            className="cn-winner-card"
            style={{
              borderColor: `${winnerColor}44`,
              boxShadow: `0 0 50px ${winnerColor}22`,
              "--winner-glow": `${winnerColor}22`,
            } as CSSProperties}
          >
            <div className="cn-winner-emoji">{byAssassin ? "💀" : "🎉"}</div>
            <div className="cn-winner-title" style={{ color: winnerColor }}>{winnerLabel} ניצח!</div>
            <div className="cn-winner-reason">
              {byAssassin ? "הצוות השני פגע במתנקש" : "כל הסוכנים אותרו בהצלחה"}
            </div>
          </div>

          <CardGrid cards={snapshot.cards} clickable={false} onCardClick={() => {}} busyCard={null} />

          {snapshot.clueHistory.length > 0 && (
            <div className="cn-history">
              <div className="cn-history-title">היסטוריית רמזים</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {snapshot.clueHistory.map((h, i) => {
                  const col = h.team === "red" ? "#ef4444" : "#3b82f6";
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <span style={{ color: col, fontWeight: 700, minWidth: 50 }}>
                        {h.team === "red" ? "🔴" : "🔵"}
                      </span>
                      <span style={{ flex: 1 }}>"{h.clueWord}" — {h.clueNumber}</span>
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>✓ {h.cardsRevealed}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isHost && (
            <button
              className="button button-full"
              style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}
              onClick={handleResetRoom}
            >
              🔄 משחק חדש
            </button>
          )}

        </div>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </div>
    );
  }

  // ── Phase: In Progress ─────────────────────────────────────────────────────────

  const activeTeamColor = turn?.team === "red" ? "#ef4444" : "#3b82f6";
  const activeTeamLabel = turn?.team === "red" ? "אדום" : "כחול";
  const timerPct = snapshot.settings.timerEnabled && countdown !== null && snapshot.settings.timerSeconds > 0
    ? Math.max(0, (countdown / snapshot.settings.timerSeconds) * 100)
    : 0;

  return (
    <div className="cn-page">
      <div className="cn-inner">

        {/* Score bar */}
        <div className="cn-score-bar">
          <div className="cn-score-side">
            <span style={{ fontSize: 16 }}>🔴</span>
            <span className="cn-score-num" style={{ color: "#ef4444" }}>{snapshot.redCardsLeft}</span>
            <span className="cn-score-denom">/{snapshot.firstTeam === "red" ? 9 : 8}</span>
          </div>

          <div className="cn-turn-info">
            {turn?.phase === "giving_clue" && (
              <div className="cn-turn-label" style={{ color: activeTeamColor }}>
                🕵️ תור {activeTeamLabel} — ממתין לרמז
              </div>
            )}
            {turn?.phase === "guessing" && (
              <div className="cn-turn-label" style={{ color: activeTeamColor }}>
                🔍 "{turn.clue?.word}" — {turn.clue?.number} | נותרו: {turn.guessesRemaining}
              </div>
            )}
            {snapshot.settings.timerEnabled && countdown !== null && turn?.phase === "guessing" && (
              <div className="cn-turn-timer" style={{ color: countdown <= 15 ? "#ef4444" : "var(--muted)" }}>
                ⏱ {countdown}ש'
              </div>
            )}
          </div>

          <div className="cn-score-side" style={{ flexDirection: "row-reverse" }}>
            <span style={{ fontSize: 16 }}>🔵</span>
            <span className="cn-score-num" style={{ color: "#3b82f6" }}>{snapshot.blueCardsLeft}</span>
            <span className="cn-score-denom">/{snapshot.firstTeam === "blue" ? 9 : 8}</span>
          </div>
        </div>

        {/* Timer progress bar */}
        {snapshot.settings.timerEnabled && turn?.turnEndsAt && countdown !== null && turn.phase === "guessing" && (
          <div className="cn-timer-bar">
            <div
              className="cn-timer-fill"
              style={{ width: `${timerPct}%`, background: countdown <= 15 ? "#ef4444" : "#10b981" }}
            />
          </div>
        )}

        {/* Card grid */}
        <CardGrid
          cards={snapshot.cards}
          clickable={canGuess}
          onCardClick={handleGuessCard}
          busyCard={busy?.startsWith("guess-") ? parseInt(busy.split("-")[1]) : null}
        />

        {/* Action panel */}
        <div className="cn-action-panel">

          {canGiveClue && (
            <div>
              <div className="cn-action-title">🔍 תן רמז לצוות שלך</div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>מילת הרמז</label>
                  <input
                    className="input"
                    value={clueWord}
                    onChange={(e) => setClueWord(e.target.value)}
                    placeholder="מילה אחת בלבד"
                    onKeyDown={(e) => { if (e.key === "Enter") handleGiveClue(); }}
                    style={{ direction: "rtl" }}
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>כמה קלפים?</label>
                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                      <button
                        key={n}
                        className={`cn-num-btn${clueNumber === n ? " cn-num-btn-active" : ""}`}
                        onClick={() => setClueNum(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  className="button"
                  disabled={!clueWord.trim() || busy === "clue"}
                  onClick={handleGiveClue}
                  style={{ background: "linear-gradient(135deg, #10b981, #059669)", padding: "0 20px", minHeight: 38 }}
                >
                  {busy === "clue" ? "שולח..." : "תן רמז ›"}
                </button>
              </div>
            </div>
          )}

          {turn?.phase === "guessing" && !canGiveClue && (
            <div>
              {turn.clue && (
                <div className="cn-clue-display">
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>רמז: </span>
                  <span style={{ fontWeight: 800, fontSize: 17, color: activeTeamColor }}>"{turn.clue.word}"</span>
                  <span style={{ fontSize: 13, color: "var(--muted)", marginRight: 8 }}>— {turn.clue.number} קלפים</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>| נותרו: {turn.guessesRemaining}</span>
                </div>
              )}
              {canEndTurn && (
                <button
                  className="button-ghost"
                  style={{ borderColor: `${activeTeamColor}44`, color: activeTeamColor }}
                  onClick={handleEndTurn}
                >
                  סיים תור ›
                </button>
              )}
              {!canGuess && (
                <div style={{ color: "var(--muted)", fontSize: 14, textAlign: "center" }}>
                  הצוות ה{activeTeamLabel} מנחש...
                </div>
              )}
            </div>
          )}

          {turn?.phase === "giving_clue" && !canGiveClue && (
            <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 14 }}>
              המרגל הראשי של הצוות ה{activeTeamLabel} נותן רמז...
            </div>
          )}

        </div>

        {/* Clue history */}
        {snapshot.clueHistory.length > 0 && (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)", padding: "4px 0", userSelect: "none" }}>
              היסטוריית רמזים ({snapshot.clueHistory.length})
            </summary>
            <div className="cn-history" style={{ marginTop: 6 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {snapshot.clueHistory.map((h, i) => {
                  const col = h.team === "red" ? "#ef4444" : "#3b82f6";
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                      <span style={{ color: col, fontWeight: 700, minWidth: 50 }}>
                        {h.team === "red" ? "🔴" : "🔵"}
                      </span>
                      <span style={{ flex: 1 }}>"{h.clueWord}" — {h.clueNumber}</span>
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>✓ {h.cardsRevealed}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </details>
        )}

      </div>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

// ─── Card Grid ─────────────────────────────────────────────────────────────────

function CardGrid({
  cards,
  clickable,
  onCardClick,
  busyCard,
}: {
  cards:       CodenamesCardView[];
  clickable:   boolean;
  onCardClick: (id: number) => void;
  busyCard:    number | null;
}) {
  return (
    <div className="cn-card-grid">
      {cards.map((card) => {
        const isClickable = clickable && !card.revealed;
        const isBusy      = busyCard === card.id;

        let colorClass = "";
        if (card.revealed && card.color) {
          colorClass = `cn-card-${card.color} cn-card-revealed`;
        } else if (!card.revealed && card.color) {
          colorClass = `cn-card-hint-${card.color}`;
        }

        return (
          <button
            key={card.id}
            className={`cn-card${isClickable ? " cn-card-clickable" : ""} ${colorClass}`}
            style={{ transform: isBusy ? "scale(0.96)" : undefined }}
            disabled={!isClickable || isBusy}
            onClick={() => isClickable && onCardClick(card.id)}
          >
            {card.revealed && card.color === "assassin" && (
              <span style={{ position: "absolute", top: 3, right: 5, fontSize: 10 }}>💀</span>
            )}
            {card.word}
          </button>
        );
      })}
    </div>
  );
}
