"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type CSSProperties, type MutableRefObject
} from "react";
import type { RoomSettings, RoomStateSnapshot, ScoreBreakdown, SubmissionPayload, ValidatedAnswer } from "@categories-game/shared";
import { HEBREW_LETTERS } from "@categories-game/shared";
import { getRoomState, rerollRoomLetters, startRoom, updateRoomSettings } from "../lib/api";
import { getSocket } from "../lib/socket";
import { readSession } from "../lib/storage";
import { StatusPill } from "./status-pill";

// ─── Player colors ────────────────────────────────────────────────
const PALETTE = ["#7fa7ff", "#22e0b8", "#ffcf63", "#ff939a", "#a78bfa", "#fb923c", "#34d399", "#f472b6"];
const REACTIONS_LIST = ["👍", "😂", "🔥", "😮", "👏", "❤️", "😱"];

function getPlayerColor(players: { id: string }[], playerId: string) {
  const idx = players.findIndex((p) => p.id === playerId);
  return PALETTE[Math.max(0, idx) % PALETTE.length];
}

function PlayerAvatar({ players, playerId, nickname, size = 34 }: {
  players: { id: string }[]; playerId: string; nickname: string; size?: number;
}) {
  const color = getPlayerColor(players, playerId);
  return (
    <div className="player-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `${color}22`, borderColor: `${color}55`, color } as CSSProperties}>
      {nickname.charAt(0)}
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────
interface ToastItem { id: number; msg: string; type: "error" | "success" | "info"; }

function ToastList({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="toast-list">
      {toasts.map((t) => <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>)}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((msg: string, type: ToastItem["type"] = "error") => {
    const id = Date.now();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);
  return { toasts, push };
}

// ─── Confetti ─────────────────────────────────────────────────────
function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 28 }, (_, i) => ({
    x: `${5 + Math.random() * 90}%`, color: PALETTE[i % PALETTE.length],
    dur: `${1.8 + Math.random() * 1.4}s`, delay: `${Math.random() * 0.8}s`,
    w: `${6 + Math.random() * 6}px`, h: `${8 + Math.random() * 8}px`,
    br: Math.random() > 0.5 ? "50%" : "2px",
  })), []);
  return (
    <div className="confetti-wrap" aria-hidden>
      {pieces.map((p, i) => (
        <div key={i} className="confetti-piece"
          style={{ "--x": p.x, "--color": p.color, "--dur": p.dur, "--delay": p.delay, "--w": p.w, "--h": p.h, "--br": p.br } as CSSProperties}
        />
      ))}
    </div>
  );
}

// ─── Floating reactions ────────────────────────────────────────────
interface FloatingReaction { id: number; emoji: string; nickname: string; x: number; }

function FloatingReactions({ reactions }: { reactions: FloatingReaction[] }) {
  return (
    <div className="floating-reactions-wrap" aria-hidden>
      {reactions.map((r) => (
        <div key={r.id} className="floating-reaction" style={{ left: `${r.x}%` } as CSSProperties}>
          <span className="floating-reaction-emoji">{r.emoji}</span>
          <span className="floating-reaction-name">{r.nickname}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Countdown overlay ─────────────────────────────────────────────
function CountdownOverlay({ value }: { value: number | null }) {
  if (value === null || value <= 0) return null;
  const whole = Math.ceil(value);
  return (
    <div className="countdown-overlay" aria-hidden>
      <div className="countdown-bg-number" key={whole}>{whole}</div>
    </div>
  );
}

// ─── Settings editor ───────────────────────────────────────────────
function SettingsEditor({ settings, onUpdate, disabled }: {
  settings: RoomSettings;
  onUpdate: (p: Partial<RoomSettings>) => void;
  disabled: boolean;
}) {
  return (
    <div className="settings-grid">
      <div className="setting-row">
        <span className="setting-label">מספר סיבובים</span>
        <div className="setting-opts">
          {[3, 5, 7, 10].map((n) => (
            <button key={n} type="button" disabled={disabled}
              className={`setting-opt${settings.roundsCount === n ? " setting-opt-active" : ""}`}
              onClick={() => onUpdate({ roundsCount: n })}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <span className="setting-label">ספירה לאחור</span>
        <div className="setting-opts">
          {[10, 15, 20, 30].map((n) => (
            <button key={n} type="button" disabled={disabled}
              className={`setting-opt${settings.countdownSeconds === n ? " setting-opt-active" : ""}`}
              onClick={() => onUpdate({ countdownSeconds: n })}>
              {n}ש׳
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <span className="setting-label">מצב</span>
        <div className="setting-opts">
          {(["classic", "advanced"] as const).map((m) => (
            <button key={m} type="button" disabled={disabled}
              className={`setting-opt${settings.mode === m ? " setting-opt-active" : ""}`}
              onClick={() => onUpdate({ mode: m })}>
              {m === "classic" ? "Classic" : "Advanced"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────
function useCountdown(endsAt: string | null) {
  const [s, setS] = useState<number | null>(null);
  useEffect(() => {
    if (!endsAt) { setS(null); return; }
    const tick = () => setS(Number(Math.max(0, (new Date(endsAt).getTime() - Date.now()) / 1000).toFixed(1)));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [endsAt]);
  return s;
}

function useElapsed(startsAt: string | null | undefined) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startsAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(startsAt).getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startsAt]);
  return elapsed;
}

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

// ─── Audio ────────────────────────────────────────────────────────
function playTick(ref: MutableRefObject<AudioContext | null>, freq: number, type: OscillatorType, dur: number, gain: number, muted: boolean) {
  if (muted || typeof window === "undefined") return;
  const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  const ctx = ref.current ?? new Ctor();
  ref.current = ctx;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = freq; osc.type = type; g.gain.value = gain;
  osc.connect(g); g.connect(ctx.destination);
  osc.start(); osc.stop(ctx.currentTime + dur);
}

// ─── Data helpers ─────────────────────────────────────────────────
interface CompareRow {
  categoryId: string; categoryLabel: string;
  cells: { playerId: string; nickname: string; answer: string; score: number; isValid: boolean; isDuplicate: boolean; isHostOverride: boolean }[];
}

function buildCompareRows(snapshot: RoomStateSnapshot): CompareRow[] {
  const scoreMap = new Map<string, Map<string, ValidatedAnswer>>();
  for (const e of snapshot.scoreboard) scoreMap.set(e.playerId, new Map(e.answers.map((a) => [a.categoryId, a])));
  return snapshot.room.settings.categories.map((cat) => ({
    categoryId: cat.id, categoryLabel: cat.label,
    cells: snapshot.room.players.map((p) => {
      const a = scoreMap.get(p.id)?.get(cat.id);
      return { playerId: p.id, nickname: p.nickname, answer: a?.answer ?? "", score: a?.score ?? 0, isValid: a?.isValid ?? false, isDuplicate: a?.isDuplicate ?? false, isHostOverride: a?.isHostOverride ?? false };
    }),
  }));
}

function draftKey(roomCode: string, round: number) { return `draft-${roomCode}-${round}`; }

// ═════════════════════════════════════════════════════════════════
// Main component
// ═════════════════════════════════════════════════════════════════
export function RoomClient({ roomCode }: { roomCode: string }) {
  const socketRef = useRef(getSocket());
  const audioRef = useRef<AudioContext | null>(null);
  const cdStepRef = useRef<number | null>(null);
  const phaseRef = useRef<string | null>(null);

  const [snapshot, setSnapshot] = useState<RoomStateSnapshot | null>(null);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [countdownEndsAt, setCountdownEndsAt] = useState<string | null>(null);
  const [categoryEditor, setCategoryEditor] = useState("");
  const [session] = useState(() => readSession(roomCode));
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState<"start" | "finish" | "next" | "save" | "reroll" | null>(null);
  const [rollingLetter, setRollingLetter] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [muted, setMuted] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [roundHistory, setRoundHistory] = useState<Map<number, ScoreBreakdown[]>>(new Map());

  const { toasts, push: toast } = useToast();

  // ── Derived ──────────────────────────────────────────────────────
  const me = useMemo(() => snapshot?.room.players.find((p) => p.id === session?.playerId) ?? null, [session?.playerId, snapshot?.room.players]);
  const isHost = Boolean(me?.isHost);
  const countdownValue = useCountdown(countdownEndsAt);
  const countdownDisplay = countdownValue !== null ? Math.max(0, countdownValue).toFixed(1) : null;
  const countdownProgress = useMemo(() => {
    if (!countdownValue || !snapshot?.room.settings.countdownSeconds) return 0;
    return Math.max(0, Math.min(100, (countdownValue / snapshot.room.settings.countdownSeconds) * 100));
  }, [countdownValue, snapshot?.room.settings.countdownSeconds]);
  const leaderboard = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.room.players].sort((a, b) => b.score !== a.score ? b.score - a.score : b.progressCount - a.progressCount);
  }, [snapshot]);
  const elapsed = useElapsed(snapshot?.round?.startsAt);

  // Letter roulette effect on new round letters
  useEffect(() => {
    const active = snapshot?.room.activeLetter;
    if (!active) {
      setRollingLetter(null);
      return;
    }

    const mode = snapshot?.room.settings.mode ?? "classic";
    const start = Date.now();
    const durationMs = 1200;
    const intervalMs = 60;

    const pickPair = () => {
      const first = HEBREW_LETTERS[Math.floor(Math.random() * HEBREW_LETTERS.length)];
      let second = HEBREW_LETTERS[Math.floor(Math.random() * HEBREW_LETTERS.length)];
      while (second === first) {
        second = HEBREW_LETTERS[Math.floor(Math.random() * HEBREW_LETTERS.length)];
      }
      return `${first} + ${second}`;
    };

    const id = setInterval(() => {
      if (Date.now() - start >= durationMs) {
        clearInterval(id);
        setRollingLetter(null);
        return;
      }
      setRollingLetter(mode === "advanced" ? pickPair() : HEBREW_LETTERS[Math.floor(Math.random() * HEBREW_LETTERS.length)]);
    }, intervalMs);

    return () => clearInterval(id);
  }, [snapshot?.room.activeLetter, snapshot?.room.settings.mode]);

  // ── Effects ──────────────────────────────────────────────────────
  useEffect(() => { setHydrated(true); }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const sock = socketRef.current;

    void getRoomState(roomCode, session.playerId)
      .then((r) => { if (active) { setSnapshot(r.room); setCountdownEndsAt(r.room.room.countdownEndsAt); } })
      .catch((e) => { if (active) toast(e instanceof Error ? e.message : "לא ניתן לטעון את החדר"); });

    sock.connect();
    sock.emit("join_room", { roomCode, sessionToken: session.sessionToken });

    const onRoomState = (next: RoomStateSnapshot) => {
      setSnapshot((cur) => { if (cur?.round?.roundNumber !== next.round?.roundNumber) setDraftAnswers({}); return next; });
      setCountdownEndsAt(next.room.countdownEndsAt);
    };
    const onCountdown = ({ endsAt }: { endsAt: string }) => {
      setCountdownEndsAt(endsAt);
      playTick(audioRef, 540, "triangle", 0.08, 0.04, muted);
      setTimeout(() => playTick(audioRef, 680, "triangle", 0.1, 0.03, muted), 110);
    };
    const onResults = ({ scoreboard }: { scoreboard: ScoreBreakdown[] }) => {
      setSnapshot((cur) => cur ? { ...cur, scoreboard } : cur);
      playTick(audioRef, 740, "sine", 0.2, 0.04, muted);
      setTimeout(() => playTick(audioRef, 920, "sine", 0.16, 0.035, muted), 110);
    };
    const onReaction = ({ playerId, emoji }: { playerId: string; emoji: string }) => {
      setFloatingReactions((prev) => {
        const player = snapshot?.room.players.find((p) => p.id === playerId);
        const item: FloatingReaction = { id: Date.now() + Math.random(), emoji, nickname: player?.nickname ?? "", x: 10 + Math.random() * 80 };
        setTimeout(() => setFloatingReactions((p) => p.filter((r) => r.id !== item.id)), 2600);
        return [...prev, item];
      });
    };

    sock.on("room_state", onRoomState);
    sock.on("countdown_started", onCountdown);
    sock.on("round_results", onResults);
    sock.on("game_results", onResults);
    sock.on("error_message", ({ message }: { message: string }) => toast(message));
    sock.on("player_reaction", onReaction);

    return () => {
      active = false;
      sock.off("room_state", onRoomState);
      sock.off("countdown_started", onCountdown);
      sock.off("round_results", onResults);
      sock.off("game_results", onResults);
      sock.off("error_message");
      sock.off("player_reaction", onReaction);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, session]);

  // Sync category editor
  useEffect(() => {
    if (!snapshot) return;
    setCategoryEditor(snapshot.room.settings.categories.map((c) => c.label).join("\n"));
  }, [snapshot?.room.settings.categories]);

  // Phase audio
  useEffect(() => {
    const phase = snapshot?.room.phase ?? null;
    const prev = phaseRef.current;
    if (phase && prev && prev !== phase && phase === "countdown") {
      playTick(audioRef, 540, "triangle", 0.08, 0.04, muted);
      setTimeout(() => playTick(audioRef, 680, "triangle", 0.1, 0.03, muted), 110);
    }
    phaseRef.current = phase;
  }, [snapshot?.room.phase, muted]);

  // Countdown ticks
  useEffect(() => {
    if (countdownValue === null) { cdStepRef.current = null; return; }
    const step = Math.ceil(countdownValue * 10);
    if (cdStepRef.current !== step) {
      cdStepRef.current = step;
      if (countdownValue <= 3.1) playTick(audioRef, 950, "triangle", 0.05, 0.035, muted);
      else if (Number.isInteger(Math.ceil(countdownValue))) playTick(audioRef, 720, "triangle", 0.045, 0.028, muted);
    }
  }, [countdownValue, muted]);

  // Accumulate round history
  useEffect(() => {
    if (!snapshot?.scoreboard?.length) return;
    const roundNum = snapshot.scoreboard[0]?.roundNumber;
    if (roundNum && roundNum > 0) setRoundHistory((prev) => new Map(prev).set(roundNum, snapshot.scoreboard));
  }, [snapshot?.scoreboard]);

  // Restore draft answers on round change
  useEffect(() => {
    if (!hydrated || !snapshot?.round?.roundNumber || !session) return;
    const key = draftKey(roomCode, snapshot.round.roundNumber);
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const draft = JSON.parse(saved) as Record<string, string>;
        if (Object.keys(draft).length > 0) {
          setDraftAnswers(draft);
          socketRef.current.emit("update_answers", { roomCode, roundNumber: snapshot.round.roundNumber, answers: draft });
        }
      }
    } catch { /* ignore */ }
  // run once per round number
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, snapshot?.round?.roundNumber]);

  // ── Handlers ─────────────────────────────────────────────────────
  async function handleCopyCode() {
    try { await navigator.clipboard.writeText(roomCode); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  }
  async function handleShareLink() {
    const url = `${window.location.origin}/rooms/${roomCode}`;
    if (navigator.share) { await navigator.share({ title: "ארץ עיר אונליין", text: `קוד: ${roomCode}`, url }).catch(() => undefined); }
    else { await navigator.clipboard.writeText(url).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }

  function handleAnswerChange(categoryId: string, e: ChangeEvent<HTMLInputElement>) {
    const next = { ...draftAnswers, [categoryId]: e.target.value };
    setDraftAnswers(next);
    if (snapshot?.round) localStorage.setItem(draftKey(roomCode, snapshot.round.roundNumber), JSON.stringify(next));
    if (!snapshot?.round || !session) return;
    socketRef.current.emit("update_answers", { roomCode, roundNumber: snapshot.round.roundNumber, answers: next } satisfies SubmissionPayload);
  }

  async function handleStart() {
    if (!session) return;
    try { setBusy("start"); const r = await startRoom(roomCode, session.playerId); setSnapshot(r.room); setDraftAnswers({}); }
    catch (e) { toast(e instanceof Error ? e.message : "לא ניתן להתחיל"); }
    finally { setBusy(null); }
  }

  async function handleUpdateSettings(partial: Partial<RoomSettings>) {
    if (!session || !snapshot) return;
    try {
      const r = await updateRoomSettings(roomCode, { playerId: session.playerId, settings: { ...snapshot.room.settings, ...partial } });
      setSnapshot(r.room);
    } catch (e) { toast(e instanceof Error ? e.message : "שגיאה בשמירת הגדרות"); }
  }

  async function handleSaveCategories() {
    if (!session || !snapshot) return;
    const labels = categoryEditor.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!labels.length) { toast("צריך לפחות קטגוריה אחת"); return; }
    try {
      setBusy("save");
      const r = await updateRoomSettings(roomCode, {
        playerId: session.playerId,
        settings: { categories: labels.map((label, i) => ({ id: `${label}-${i}`.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, "-"), label, description: `תשובה בקטגוריית ${label}` })) }
      });
      setSnapshot(r.room);
      toast("קטגוריות נשמרו ✓", "success");
    } catch (e) { toast(e instanceof Error ? e.message : "לא ניתן לשמור"); }
    finally { setBusy(null); }
  }

  function handleReadyToggle() { socketRef.current.emit("set_ready", { roomCode, isReady: !me?.isReady }); }
  function handleFinishRound() { setBusy("finish"); socketRef.current.emit("finish_round", { roomCode }); setTimeout(() => setBusy(null), 400); }
  function handleNextRound() { setBusy("next"); socketRef.current.emit("start_next_round", { roomCode }); setTimeout(() => setBusy(null), 400); }
  async function handleRerollLetters() {
    if (!session) return;
    try { setBusy("reroll"); const r = await rerollRoomLetters(roomCode, session.playerId); setSnapshot(r.room); setDraftAnswers({}); }
    catch (e) { toast(e instanceof Error ? e.message : "לא ניתן לרענן"); }
    finally { setBusy(null); }
  }
  function handleSendReaction(emoji: string) {
    socketRef.current.emit("send_reaction", { roomCode, emoji });
  }

  // ── Guards ───────────────────────────────────────────────────────
  if (!hydrated) return null;

  if (!session) {
    return (
      <main className="room-shell">
        <div className="room-center-msg">
          <p style={{ color: "var(--muted)" }}>לא נמצא סשן לחדר זה.</p>
          <a href="/" className="button" style={{ display: "inline-flex", marginTop: 16 }}>חזרה לעמוד הראשי</a>
        </div>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="room-shell">
        <div className="room-center-msg">
          <div className="loading-dots"><span /><span /><span /></div>
          <p style={{ color: "var(--muted)" }}>טוען את החדר...</p>
        </div>
      </main>
    );
  }

  const room = snapshot.room;
  const phase = room.phase;

  // ══════════════════════════════════════════════════════════════════
  // LOBBY
  // ══════════════════════════════════════════════════════════════════
  if (phase === "lobby") {
    const readyCount = room.players.filter((p) => p.isReady).length;
    return (
      <main className="room-shell">
        <ToastList toasts={toasts} />
        <div className="room-top-bar">
          <div className="room-top-code">חדר <strong>{roomCode}</strong></div>
          <StatusPill tone="accent">Lobby</StatusPill>
        </div>

        <div className="lobby-sections">
          {/* Invite */}
          <section className="panel lobby-card">
            <div className="lobby-card-head"><span className="lobby-card-icon">📤</span><h2 className="lobby-card-title">הזמנת חברים</h2></div>
            <div className="invite-box">
              <div className="invite-code">{roomCode}</div>
              <div className="invite-actions">
                <button className="button-ghost invite-btn" type="button" onClick={() => void handleCopyCode()}>{copied ? "✓ הועתק!" : "העתק קוד"}</button>
                <button className="button-ghost invite-btn" type="button" onClick={() => void handleShareLink()}>שתף קישור 🔗</button>
              </div>
            </div>
          </section>

          {/* Settings */}
          <section className="panel lobby-card">
            <div className="lobby-card-head">
              <span className="lobby-card-icon">⚙️</span>
              <h2 className="lobby-card-title">הגדרות משחק</h2>
              {!isHost ? <span className="lobby-card-sub">רק המארח יכול לשנות</span> : null}
            </div>
            {isHost ? (
              <SettingsEditor settings={room.settings} onUpdate={(p) => void handleUpdateSettings(p)} disabled={busy !== null} />
            ) : (
              <div className="settings-display">
                <span className="setting-tag">{room.settings.roundsCount} סיבובים</span>
                <span className="setting-tag">{room.settings.countdownSeconds}ש׳ ספירה</span>
                <span className="setting-tag">{room.settings.mode === "classic" ? "🔤 Classic" : "🔀 Advanced"}</span>
              </div>
            )}
          </section>

          {/* Categories */}
          {isHost ? (
            <section className="panel lobby-card">
              <div className="lobby-card-head"><span className="lobby-card-icon">🗂️</span><h2 className="lobby-card-title">קטגוריות</h2><span className="lobby-card-sub">כל שורה = קטגוריה</span></div>
              <textarea className="textarea" rows={6} value={categoryEditor} onChange={(e) => setCategoryEditor(e.target.value)} placeholder={"חי\nצומח\nדומם\nארץ\nעיר\nמקצוע"} />
              <button className="button-ghost" type="button" onClick={() => void handleSaveCategories()} disabled={busy !== null}>{busy === "save" ? "שומר..." : "שמור קטגוריות ✓"}</button>
            </section>
          ) : (
            <section className="panel lobby-card">
              <div className="lobby-card-head"><span className="lobby-card-icon">🗂️</span><h2 className="lobby-card-title">קטגוריות</h2><span className="lobby-card-badge">{room.settings.categories.length}</span></div>
              <div className="categories-preview">{room.settings.categories.map((c) => <span className="cat-tag" key={c.id}>{c.label}</span>)}</div>
            </section>
          )}

          {/* Players */}
          <section className="panel lobby-card">
            <div className="lobby-card-head"><span className="lobby-card-icon">👥</span><h2 className="lobby-card-title">שחקנים</h2><span className="lobby-card-badge">{readyCount}/{room.players.length} מוכנים</span></div>
            <div className="lobby-players">
              {room.players.map((player) => (
                <div className={`lobby-player${player.id === me?.id ? " lobby-player-me" : ""}`} key={player.id}>
                  <PlayerAvatar players={room.players} playerId={player.id} nickname={player.nickname} />
                  <div className="lobby-player-info">
                    <span className="lobby-player-name">{player.nickname}</span>
                    {player.isHost ? <StatusPill tone="accent">Host</StatusPill> : null}
                  </div>
                  <StatusPill tone={player.isReady ? "success" : "warning"}>{player.isReady ? "✓ מוכן" : "ממתין..."}</StatusPill>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="lobby-bar">
          <button className={`button-ghost lobby-ready-btn${me?.isReady ? " lobby-ready-btn-active" : ""}`} type="button" onClick={handleReadyToggle}>
            {me?.isReady ? "✓ מוכן — בטל" : "אני מוכן ✓"}
          </button>
          {isHost ? (
            <button className="button lobby-start-btn" type="button" onClick={() => void handleStart()} disabled={busy !== null}>
              {busy === "start" ? "מתחיל..." : "התחל משחק ›"}
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // IN ROUND / COUNTDOWN
  // ══════════════════════════════════════════════════════════════════
  if (phase === "in_round" || phase === "countdown") {
    const isCountdown = phase === "countdown";
    const finishedCount = room.players.filter((p) => p.hasFinishedRound).length;
    const iDone = me?.hasFinishedRound ?? false;
    const displayLetter = rollingLetter ?? room.activeLetter ?? "–";

    return (
      <main className="room-shell">
        <ToastList toasts={toasts} />
        <FloatingReactions reactions={floatingReactions} />
        {isCountdown ? <CountdownOverlay value={countdownValue} /> : null}

        <div className="round-header">
          <div className="round-header-left">
            <div>
              <div className="round-number">סיבוב {room.currentRoundNumber} / {room.settings.roundsCount}</div>
              <div className="round-finished">{finishedCount}/{room.players.length} סיימו</div>
            </div>
            <div className="elapsed-badge"><span className="elapsed-dot" />{formatTime(elapsed)}</div>
          </div>
          <div className="round-header-right">
            {isCountdown ? (
              <div className="countdown-hud">
                <span className="countdown-hud-label">נגמר בעוד</span>
                <strong className="countdown-hud-value">{countdownDisplay ?? "–"}</strong>
                <div className="hud-timer-track"><div className="hud-timer-fill" style={{ width: `${countdownProgress}%` }} /></div>
              </div>
            ) : null}
            <button className={`mute-btn${muted ? " mute-btn-active" : ""}`} type="button" onClick={() => setMuted((m) => !m)} title={muted ? "הפעל סאונד" : "השתק"}>
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
        </div>

        {/* Letter */}
        <div className="panel letter-stage">
          <span className="letter-stage-label">{room.settings.mode === "classic" ? "האות של הסיבוב" : "שתי האותיות"}</span>
          <div className="letter-stage-value" key={displayLetter}>{displayLetter}</div>
          <span className="letter-stage-rule">{room.settings.mode === "classic" ? "כל תשובה חייבת להתחיל באות זו" : "כל תשובה חייבת להכיל את שתי האותיות"}</span>
          {isHost && phase === "in_round" ? (
            <button className="button-ghost reroll-btn" type="button" onClick={() => void handleRerollLetters()} disabled={busy !== null}>{busy === "reroll" ? "מרענן..." : "🔄 רענן אותיות"}</button>
          ) : null}
        </div>

        {/* Answers */}
        {snapshot.round ? (
          <div className="answers-grid">
            {snapshot.round.categories.map((cat) => {
              const pressure = room.categoryPressure[cat.id] ?? 0;
              const pct = room.players.length > 0 ? (pressure / room.players.length) * 100 : 0;
              return (
                <label className={`arena-answer-card${pressure > 0 ? " arena-answer-card-hot" : ""}`} key={cat.id}>
                  <div className="answer-card-top">
                    <span className="answer-title">{cat.label}</span>
                    {pressure > 0 ? <span className="pressure-count">{pressure}/{room.players.length}</span> : null}
                  </div>
                  <div className="pressure-bar-track"><div className="pressure-bar-fill" style={{ width: `${pct}%` }} /></div>
                  <input className="input arena-input" value={draftAnswers[cat.id] ?? ""} onChange={(e) => handleAnswerChange(cat.id, e)} placeholder={`כתוב ${cat.label}...`} disabled={iDone} />
                </label>
              );
            })}
          </div>
        ) : null}

        {/* Reactions */}
        <div className="reaction-bar">
          {REACTIONS_LIST.map((emoji) => (
            <button key={emoji} type="button" className="reaction-btn" onClick={() => handleSendReaction(emoji)}>{emoji}</button>
          ))}
        </div>

        {/* Players strip */}
        <div className="players-strip">
          {room.players.map((player) => (
            <div key={player.id} className={`player-strip-item${player.hasFinishedRound ? " player-strip-item-done" : ""}${player.id === me?.id ? " player-strip-item-me" : ""}`}>
              <PlayerAvatar players={room.players} playerId={player.id} nickname={player.nickname} size={24} />
              <span className="player-strip-name">{player.nickname}</span>
              {player.hasFinishedRound ? <span className="player-strip-check">✓</span> : <span className="player-strip-progress">{player.progressCount}/{room.settings.categories.length}</span>}
            </div>
          ))}
        </div>

        <div className="round-action-bar">
          <button className="button-secondary round-finish-btn" type="button" onClick={handleFinishRound} disabled={!snapshot.round || busy !== null || iDone}>
            {iDone ? "✓ סיימת — ממתין לשאר" : busy === "finish" ? "שולח..." : "סיימתי את הסיבוב ✓"}
          </button>
        </div>
      </main>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // VALIDATING
  // ══════════════════════════════════════════════════════════════════
  if (phase === "validating") {
    return (
      <main className="room-shell">
        <div className="room-center-msg">
          <div className="loading-dots"><span /><span /><span /></div>
          <h2 className="validating-title">בודקים תשובות...</h2>
          <p className="validating-sub">AI מנתח ומחשב ניקוד לכולם</p>
        </div>
      </main>
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // RESULTS / GAME OVER
  // ══════════════════════════════════════════════════════════════════
  if (phase === "round_results" || phase === "game_over") {
    const isGameOver = phase === "game_over";
    const winner = leaderboard[0];
    const compareRows = buildCompareRows(snapshot);

    return (
      <main className="room-shell">
        <ToastList toasts={toasts} />
        {isGameOver ? <Confetti /> : null}

        <div className="results-header">
          <div className="results-header-text">
            <span className="results-eyebrow">{isGameOver ? "🏆 סיום המשחק" : `סיבוב ${room.currentRoundNumber} / ${room.settings.roundsCount}`}</span>
            <h1 className="results-title">{isGameOver ? "תוצאות סופיות" : "תוצאות הסיבוב"}</h1>
          </div>
          {isHost && !isGameOver ? (
            <button className="button results-next-btn" type="button" onClick={handleNextRound} disabled={busy !== null}>
              {busy === "next" ? "ממשיך..." : "סיבוב הבא ›"}
            </button>
          ) : null}
        </div>

        {isGameOver && winner ? (
          <div className="panel winner-banner">
            <div className="winner-crown">🏆</div>
            <div className="winner-name">{winner.nickname}</div>
            <div className="winner-score">{winner.score} נקודות</div>
          </div>
        ) : null}

        {/* Leaderboard with per-round score */}
        <section className="panel results-card">
          <h2 className="results-card-title">דירוג</h2>
          <div className="leaderboard-list">
            {leaderboard.map((player, i) => {
              const roundScore = snapshot.scoreboard.find((s) => s.playerId === player.id)?.totalScore;
              return (
                <article className={`lb-row${player.id === me?.id ? " lb-row-me" : ""}${i === 0 ? " lb-row-first" : ""}`} key={player.id}>
                  <div className="lb-rank">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}</div>
                  <PlayerAvatar players={room.players} playerId={player.id} nickname={player.nickname} />
                  <div className="lb-info">
                    <span className="lb-name">{player.nickname}</span>
                    {player.id === me?.id ? <span className="lb-you">(אתה)</span> : null}
                  </div>
                  <div className="lb-scores">
                    {roundScore !== undefined && !isGameOver ? <span className="lb-round-score">+{roundScore}</span> : null}
                    <span className="lb-score">{player.score} נק'</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Answer comparison */}
        {compareRows.length > 0 ? (
          <section className="panel results-card">
            <h2 className="results-card-title">השוואת תשובות</h2>
            <div className="compare-cards">
              {compareRows.map((row) => (
                <div className="compare-card" key={row.categoryId}>
                  <div className="compare-card-title">{row.categoryLabel}</div>
                  {row.cells.map((cell) => (
                    <div className={`compare-row${cell.isValid ? " compare-row-valid" : " compare-row-invalid"}`} key={cell.playerId}>
                      <PlayerAvatar players={room.players} playerId={cell.playerId} nickname={cell.nickname} size={22} />
                      <span className="compare-player-name">{cell.nickname}</span>
                      <span className="compare-answer-text">{cell.answer || "—"}</span>
                      <div className="compare-row-badges">
                        <StatusPill tone={cell.isValid ? "success" : "danger"}>{cell.score} נק'</StatusPill>
                        {cell.score === 15 && cell.isValid ? <StatusPill tone="accent">⭐ ייחודי</StatusPill> : null}
                        {cell.isDuplicate ? <StatusPill tone="warning">כפול</StatusPill> : null}
                        {cell.isHostOverride ? <StatusPill tone="warning">✓ מארח</StatusPill> : null}
                        {isHost && cell.answer ? (
                          <div className="host-control-group">
                            <button
                              type="button"
                              className={`host-control-btn host-control-valid${cell.isValid && cell.score === 10 && !cell.isDuplicate ? " host-control-active" : ""}`}
                              onClick={() => socketRef.current.emit("host_update_answer", { roomCode, targetPlayerId: cell.playerId, categoryId: row.categoryId, outcome: "valid_normal" })}
                            >
                              נכון
                            </button>
                            <button
                              type="button"
                              className={`host-control-btn host-control-duplicate${cell.isValid && cell.score === 5 ? " host-control-active" : ""}`}
                              onClick={() => socketRef.current.emit("host_update_answer", { roomCode, targetPlayerId: cell.playerId, categoryId: row.categoryId, outcome: "valid_duplicate" })}
                            >
                              כפול
                            </button>
                            <button
                              type="button"
                              className={`host-control-btn host-control-unique${cell.isValid && cell.score === 15 ? " host-control-active" : ""}`}
                              onClick={() => socketRef.current.emit("host_update_answer", { roomCode, targetPlayerId: cell.playerId, categoryId: row.categoryId, outcome: "valid_unique" })}
                            >
                              ⭐ ייחודי
                            </button>
                            <button
                              type="button"
                              className={`host-control-btn host-control-invalid${!cell.isValid ? " host-control-active" : ""}`}
                              onClick={() => socketRef.current.emit("host_update_answer", { roomCode, targetPlayerId: cell.playerId, categoryId: row.categoryId, outcome: "invalid" })}
                            >
                              לא נכון
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Round history (game over) */}
        {isGameOver && roundHistory.size > 1 ? (
          <section className="panel results-card">
            <h2 className="results-card-title">היסטוריית סיבובים</h2>
            <div className="history-table">
              <div className="history-header">
                <span className="history-cell-label">סיבוב</span>
                {room.players.map((p) => (
                  <div className="history-player-head" key={p.id}>
                    <PlayerAvatar players={room.players} playerId={p.id} nickname={p.nickname} size={22} />
                    <span>{p.nickname}</span>
                  </div>
                ))}
              </div>
              {Array.from(roundHistory.entries()).sort((a, b) => a[0] - b[0]).map(([roundNum, scores]) => (
                <div className="history-row" key={roundNum}>
                  <span className="history-cell-label">#{roundNum}</span>
                  {room.players.map((p) => {
                    const s = scores.find((sc) => sc.playerId === p.id);
                    return <span className="history-cell-score" key={p.id}>+{s?.totalScore ?? 0}</span>;
                  })}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {isHost && !isGameOver ? (
          <div className="results-bottom-bar">
            <button className="button button-full" type="button" onClick={handleNextRound} disabled={busy !== null}>
              {busy === "next" ? "ממשיך..." : "לסיבוב הבא ›"}
            </button>
          </div>
        ) : null}
      </main>
    );
  }

  return null;
}





