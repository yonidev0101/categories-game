"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../lib/socket";
import { getFamilyRoomState } from "../lib/family-api";
import { readSession } from "../lib/storage";
import { getFamilyAudio, readMutePreference, writeMutePreference, type FamilyAudioMode, type FamilySfx } from "../lib/family-audio";
import type { FamilySnapshot, FamilyPlayerInfo, FamilyRoundType } from "@categories-game/shared";

// ── Design ───────────────────────────────────────────────────────────────────
// The game is about notes: you write something in secret, it gets folded up and
// passed around, and everyone guesses whose handwriting it is. So the screen is
// a white note lying on a table in a living room at night — deep aubergine
// around it, warm paper on top. Dark text on paper is also the most readable
// combination there is, which is what the 70+ players in the room need.
//
// The timer is the signature: a bar that retracts along the note's top edge.
// The number only appears in the last ten seconds, so urgency arrives when it
// is real instead of ticking at people the whole round.

const ROUND_LABEL: Record<FamilyRoundType, string> = {
  A: "על מי מדובר",
  D: "מה ענית",
  B: "הפתק",
  C: "המספר",
};

// Warm, saturated hues that read as people rather than teams.
const PLAYER_COLORS = ["#FF5A3C", "#2F7DE1", "#22A06B", "#E8A317", "#9B51E0", "#E0457B", "#0FA3A3", "#F2762E"];

function colorFor(players: FamilyPlayerInfo[], id: string) {
  const i = players.findIndex((p) => p.id === id);
  return PLAYER_COLORS[(i < 0 ? 0 : i) % PLAYER_COLORS.length];
}

function initials(nickname: string) {
  // "דנה + אבי" → "ד+א", otherwise the first letter
  const parts = nickname.split("+").map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}+${parts[1][0]}` : nickname[0];
}

// ─── Phase timer, driven entirely by the server's phaseEndsAt ────────────────

function usePhaseTimer(phaseEndsAt: string | null) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [fraction, setFraction] = useState(1);
  const totalRef = useRef<number | null>(null);

  useEffect(() => {
    totalRef.current = null;
    if (!phaseEndsAt) { setSecondsLeft(null); setFraction(1); return; }

    const target = new Date(phaseEndsAt).getTime();
    const tick = () => {
      const msLeft = Math.max(0, target - Date.now());
      if (totalRef.current === null) totalRef.current = msLeft;
      setSecondsLeft(Math.ceil(msLeft / 1000));
      setFraction(totalRef.current > 0 ? msLeft / totalRef.current : 0);
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [phaseEndsAt]);

  return { secondsLeft, fraction };
}

// ─── Soundtrack ──────────────────────────────────────────────────────────────

function useSoundtrack() {
  const audio = getFamilyAudio();
  const [muted, setMuted] = useState(true); // stays silent until the browser lets us in

  useEffect(() => {
    const stored = readMutePreference();
    setMuted(stored);
    audio.setMuted(stored);

    // Autoplay is blocked until a real gesture, so the first tap anywhere starts it.
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });

    const onVisibility = () => (document.hidden ? audio.suspend() : audio.resume());
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("pointerdown", unlock);
      document.removeEventListener("visibilitychange", onVisibility);
      audio.setMode("off");
    };
  }, [audio]);

  const toggle = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      audio.setMuted(next);
      writeMutePreference(next);
      if (!next) audio.unlock();
      return next;
    });
  }, [audio]);

  const setMode = useCallback((mode: FamilyAudioMode) => audio.setMode(mode), [audio]);
  const setUrgency = useCallback((u: number, final: boolean) => audio.setUrgency(u, final), [audio]);
  const sfx = useCallback((kind: FamilySfx) => audio.sfx(kind), [audio]);

  return { muted, toggle, setMode, setUrgency, sfx };
}

function SoundToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="fm-sound"
      onClick={onToggle}
      aria-pressed={!muted}
      aria-label={muted ? "הפעילו מוזיקה" : "השתיקו מוזיקה"}
      title={muted ? "מוזיקה כבויה" : "מוזיקה דלוקה"}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}

// ─── How to play ─────────────────────────────────────────────────────────────

const SEEN_RULES_KEY = "categories-game:family-rules-seen";

function RulesSheet({ isCouple, onClose }: { isCouple: boolean; onClose: () => void }) {
  return (
    <div className="fm-sheet" role="dialog" aria-modal="true" aria-label="איך משחקים">
      <div className="fm-sheet-card">
        <h2 className="fm-sheet-title">איך משחקים</h2>

        {isCouple ? (
          <>
            <p className="fm-sheet-foot">
              משחק לשניים. בכל סבב שאלה אחת ויש טיימר — מי שלא הספיק, מפסיד את הסבב.
            </p>
            <h3 className="fm-sheet-sub">שלושה סוגי סבבים</h3>
            <ul className="fm-rules fm-rules-plain">
              <li>
                <span className="fm-rule-head">מה ענית</span>
                כל אחד בוחר תשובה על עצמו, ואז מנחש מה השני בחר.
                <span className="fm-rule-points">100 נקודות על כל ניחוש נכון</span>
              </li>
              <li>
                <span className="fm-rule-head">מי מאיתנו</span>
                מוצג משפט, ושניכם בוחרים מי משניכם.
                <span className="fm-rule-points">100 לשניכם — רק אם הסכמתם</span>
              </li>
              <li>
                <span className="fm-rule-head">מה המספר</span>
                אחד מכם מקבל שאלה סודית ועונה במספר. השני מנחש.
                <span className="fm-rule-points">100 לניחוש הכי קרוב · 150 על פגיעה מדויקת</span>
              </li>
            </ul>
            <p className="fm-sheet-foot">בסוף — כמה אתם מכירים אחד את השני. בהצלחה.</p>
          </>
        ) : (
          <>
            <ol className="fm-rules">
              <li>
                <span className="fm-rule-head">קודם ממלאים פתקים</span>
                כל אחד עונה על שלוש שאלות על עצמו. אף אחד לא רואה מה כתבתם.
              </li>
              <li>
                <span className="fm-rule-head">אחר כך משחקים סבבים</span>
                בכל סבב יש שאלה אחת. יש טיימר — מי שלא הספיק, מפסיד את הסבב.
              </li>
            </ol>

            <h3 className="fm-sheet-sub">שלושה סוגי סבבים</h3>
            <ul className="fm-rules fm-rules-plain">
              <li>
                <span className="fm-rule-head">מי הכי סביר</span>
                מוצג משפט, ובוחרים מי במשפחה הכי מתאים לו.
                <span className="fm-rule-points">100 נקודות למי שבוחר/ת כמו הרוב</span>
              </li>
              <li>
                <span className="fm-rule-head">מי כתב את זה</span>
                מוצג פתק שמישהו כתב, בלי שם. מנחשים מי.
                <span className="fm-rule-points">100 למי שניחש/ה · 25 לכותב/ת על כל אחד שלא זיהה</span>
              </li>
              <li>
                <span className="fm-rule-head">מה המספר</span>
                שחקן אחד מקבל שאלה סודית ועונה במספר. כולם מנחשים כמה.
                <span className="fm-rule-points">100 לניחוש הכי קרוב · 150 על פגיעה מדויקת</span>
              </li>
            </ul>

            <p className="fm-sheet-foot">בסוף — טבלה ותארים. בהצלחה.</p>
          </>
        )}

        <button type="button" className="fm-action" onClick={onClose}>הבנתי</button>
      </div>
    </div>
  );
}

// ─── Layout primitives ───────────────────────────────────────────────────────

/** The paper note. Everything the player reads or touches lives on one. */
function Note({
  children, fraction, secondsLeft, tone = "paper",
}: {
  children: React.ReactNode;
  fraction?: number;
  secondsLeft?: number | null;
  tone?: "paper" | "quiet";
}) {
  const urgent = secondsLeft !== null && secondsLeft !== undefined && secondsLeft <= 10;
  return (
    <div className={`fm-note${tone === "quiet" ? " fm-note-quiet" : ""}`}>
      {fraction !== undefined && (
        <div className="fm-edge" aria-hidden>
          <div
            className={`fm-edge-fill${urgent ? " fm-edge-urgent" : ""}`}
            style={{ transform: `scaleX(${Math.max(0, Math.min(1, fraction))})` }}
          />
        </div>
      )}
      {secondsLeft !== null && secondsLeft !== undefined && (
        <div className={`fm-clock${urgent ? " fm-clock-urgent" : ""}`} role="timer">
          <span className="fm-clock-num">{secondsLeft}</span>
          <span className="fm-clock-label">שניות</span>
        </div>
      )}
      {children}
    </div>
  );
}

/** The family, along the bottom. Names light up as people answer. */
function Roster({
  players, participantIds, answeredIds, caption,
}: {
  players: FamilyPlayerInfo[];
  participantIds: string[];
  answeredIds: string[];
  caption: string;
}) {
  const answered = new Set(answeredIds);
  const shown = participantIds.map((id) => players.find((p) => p.id === id)).filter(Boolean) as FamilyPlayerInfo[];
  if (shown.length === 0) return null;

  return (
    <div className="fm-roster">
      <ul className="fm-roster-list">
        {shown.map((p) => {
          const done = answered.has(p.id);
          return (
            <li
              key={p.id}
              className={`fm-chip${done ? " fm-chip-done" : ""}`}
              style={done ? { background: colorFor(players, p.id), borderColor: colorFor(players, p.id) } : undefined}
            >
              <span className="fm-chip-name">{p.nickname}</span>
              {done && <span className="fm-chip-tick" aria-hidden>✓</span>}
            </li>
          );
        })}
      </ul>
      <p className="fm-roster-caption">
        {caption} · {answeredIds.length}/{participantIds.length}
      </p>
    </div>
  );
}

/** My score and my place, always visible — the question everyone keeps asking. */
function ScoreTag({
  players, myId, open, onToggle,
}: {
  players: FamilyPlayerInfo[];
  myId: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  const me = ranked.find((p) => p.id === myId);
  if (!me) return null;
  const place = ranked.findIndex((p) => p.id === myId) + 1;

  return (
    <button type="button" className="fm-scoretag" onClick={onToggle} aria-expanded={open}>
      <span className="fm-scoretag-num">{me.score}</span>
      <span className="fm-scoretag-place">מקום {place}</span>
    </button>
  );
}

/**
 * Host-only escape hatch. One tap drops whatever is on screen — no scoring, no
 * waiting for the timer. Deliberately not behind a confirmation: if a question
 * needs to go, it needs to go now.
 */
function SkipButton({ onSkip, label = "דלגו על השאלה" }: { onSkip: () => void; label?: string }) {
  return (
    <button type="button" className="fm-skip" onClick={onSkip}>
      ⤳ {label}
    </button>
  );
}

function Standings({ players, myId }: { players: FamilyPlayerInfo[]; myId: string | null }) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  return (
    <ul className="fm-standings">
      {ranked.map((p, i) => (
        <li key={p.id} className={`fm-standing${p.id === myId ? " fm-standing-me" : ""}`}>
          <span className="fm-place">{i + 1}</span>
          <span className="fm-person-name">{p.nickname}</span>
          <span className="fm-result-value">{p.score}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Round B must NOT list names. The author is not a participant, so a name
 * roster shows everyone else and the one missing name is the answer — it hands
 * the round away before anyone guesses. A bare count says the same useful thing
 * ("are we still waiting?") without naming anyone.
 */
function ProgressCount({ done, total }: { done: number; total: number }) {
  return (
    <div className="fm-roster">
      <div className="fm-progress-bar">
        <div className="fm-progress-fill" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
      </div>
      <p className="fm-roster-caption">ניחשו {done} מתוך {total}</p>
    </div>
  );
}

function Avatar({ players, id, nickname, size = 44 }: { players: FamilyPlayerInfo[]; id: string; nickname: string; size?: number }) {
  return (
    <span
      className="fm-avatar"
      style={{ background: colorFor(players, id), width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials(nickname)}
    </span>
  );
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

function PersonButton({
  player, players, selected, onClick,
}: {
  player: FamilyPlayerInfo;
  players: FamilyPlayerInfo[];
  selected: boolean;
  onClick: () => void;
}) {
  const color = colorFor(players, player.id);
  return (
    <button
      type="button"
      className={`fm-person${selected ? " fm-person-on" : ""}`}
      onClick={onClick}
      aria-pressed={selected}
      style={selected ? { borderColor: color, background: `${color}1f` } : undefined}
    >
      <Avatar players={players} id={player.id} nickname={player.nickname} />
      <span className="fm-person-name">{player.nickname}</span>
      <span className="fm-person-mark" style={{ borderColor: selected ? color : undefined, background: selected ? color : undefined }}>
        {selected ? "✓" : ""}
      </span>
    </button>
  );
}

/** Round D — the same four options, first for yourself and then for your partner. */
function ChoiceList({
  options, selected, onPick,
}: {
  options: string[];
  selected: number | null;
  onPick: (index: number) => void;
}) {
  return (
    <div className="fm-choices">
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          className={`fm-option${selected === index ? " fm-option-on" : ""}`}
          onClick={() => onPick(index)}
          aria-pressed={selected === index}
        >
          <span className="fm-option-text">{option}</span>
          {selected === index && <span className="fm-option-tick" aria-hidden>✓</span>}
        </button>
      ))}
    </div>
  );
}

function NumberField({
  value, onChange, onSubmit, submitted, label,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitted: boolean;
  label: string;
}) {
  const current = Number(value);
  const step = (d: number) => onChange(String(Math.max(0, (Number.isFinite(current) ? current : 0) + d)));

  return (
    <div className="fm-number">
      <div className="fm-number-row">
        <button type="button" className="fm-step" onClick={() => step(-1)} aria-label="הורידו אחד">−</button>
        <input
          className="fm-number-input"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
          placeholder="0"
          aria-label={label}
        />
        <button type="button" className="fm-step" onClick={() => step(1)} aria-label="הוסיפו אחד">+</button>
      </div>
      <button type="button" className="fm-action" onClick={onSubmit} disabled={value === ""}>
        {submitted ? "עדכנו" : "שלחו"}
      </button>
      {submitted && <p className="fm-hint">נשלח. אפשר לשנות עד סוף הזמן.</p>}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props { roomCode: string }

export function FamilyClient({ roomCode }: Props) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<FamilySnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [surveyIndex, setSurveyIndex] = useState(0);
  const [surveyDraft, setSurveyDraft] = useState("");
  const [editingSurvey, setEditingSurvey] = useState(false);
  const [numberDraft, setNumberDraft] = useState("");
  const [revealed, setRevealed] = useState(0);
  const [copied, setCopied] = useState(false);
  const [familyDraft, setFamilyDraft] = useState("");
  const familyDraftLoaded = useRef(false);
  const [showRules, setShowRules] = useState(false);
  const [showStandings, setShowStandings] = useState(false);

  const socket = getSocket();
  const room = snapshot?.room;
  const me = snapshot?.me;
  const myId = me?.playerId ?? null;
  const isHost = room?.hostPlayerId === myId;
  const isCouple = room?.setup.mode === "couple";
  const gameTitle = isCouple ? "מי מאיתנו?" : "מי מהמשפחה?";
  const { secondsLeft, fraction } = usePhaseTimer(room?.phaseEndsAt ?? null);
  const { muted, toggle: toggleSound, setMode, setUrgency, sfx } = useSoundtrack();

  // ── Connect, and re-announce after every drop (locking the phone lands here)
  useEffect(() => {
    const session = readSession(roomCode);
    if (!session) { router.push("/"); return; }

    void getFamilyRoomState(roomCode, session.playerId).then(setSnapshot).catch(() => router.push("/"));
    if (!socket.connected) socket.connect();

    const onState = (snap: FamilySnapshot) => setSnapshot(snap);
    const onError = ({ message: msg }: { message: string }) => {
      setMessage(msg);
      setTimeout(() => setMessage(null), 4000);
    };
    const onConnect = () => socket.emit("f_join_room", { roomCode: roomCode.toUpperCase(), sessionToken: session.sessionToken });

    socket.on("family_state", onState);
    socket.on("error_message", onError);
    socket.on("connect", onConnect);
    onConnect();

    return () => {
      socket.off("family_state", onState);
      socket.off("error_message", onError);
      socket.off("connect", onConnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  const emit = useCallback(
    (event: string, payload: object = {}) => socket.emit(event, { roomCode: roomCode.toUpperCase(), ...payload }),
    [socket, roomCode],
  );

  // ── Survey: land on the first unanswered question after a reconnect ────────
  const survey = room?.survey ?? null;
  useEffect(() => {
    if (!survey) return;
    const first = survey.myAnswers.findIndex((a) => !a.trim());
    const idx = first === -1 ? Math.max(0, survey.questions.length - 1) : first;
    setSurveyIndex(idx);
    setSurveyDraft(survey.myAnswers[idx] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.phase, survey?.questions.length]);

  // ── Restore my number after a reconnect ───────────────────────────────────
  const question = room?.question ?? null;
  const roundKey = `${room?.roundNumber}:${question?.stage ?? ""}`;
  useEffect(() => {
    setNumberDraft(question?.myNumber !== null && question?.myNumber !== undefined ? String(question.myNumber) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundKey]);

  // ── Reveal, one row at a time, lowest first ───────────────────────────────
  const reveal = room?.reveal ?? null;
  const revealCount = (reveal?.votes.length ?? 0) + (reveal?.numbers.length ?? 0) + (reveal?.predictions.length ?? 0);
  useEffect(() => {
    if (!reveal) { setRevealed(0); return; }
    setRevealed(0);
    const id = setInterval(() => {
      setRevealed((n) => (n >= revealCount ? (clearInterval(id), n) : n + 1));
    }, 1200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.roundNumber, revealCount]);

  // ── Soundtrack follows the phase, and the beat follows the clock ──────────
  const phase = room?.phase;
  useEffect(() => {
    if (!phase) return;
    const mode: FamilyAudioMode =
      phase === "lobby" ? "lobby" :
      phase === "reveal" ? "reveal" :
      phase === "final" ? "final" :
      "play";
    setMode(mode);
  }, [phase, setMode]);

  useEffect(() => {
    setUrgency(1 - fraction, secondsLeft !== null && secondsLeft <= 10);
  }, [fraction, secondsLeft, setUrgency]);

  // ── One-shot sounds for the things that actually happen ───────────────────
  const prevRound = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "question" || !room) return;
    if (prevRound.current !== room.roundNumber) {
      prevRound.current = room.roundNumber;
      sfx("start");
    }
  }, [phase, room, sfx]);

  const prevVote = useRef<string | null>(null);
  useEffect(() => {
    const vote = room?.question?.myVote ?? null;
    if (vote && vote !== prevVote.current) sfx("select");
    prevVote.current = vote;
  }, [room?.question?.myVote, sfx]);

  const prevRevealed = useRef(0);
  useEffect(() => {
    if (revealed > prevRevealed.current && revealed > 0) sfx("reveal");
    prevRevealed.current = revealed;
  }, [revealed, sfx]);

  const scoredThisReveal = useRef<number | null>(null);
  useEffect(() => {
    const rv = room?.reveal;
    if (!rv || phase !== "reveal") return;
    const total = rv.votes.length + rv.numbers.length + rv.predictions.length;
    if (revealed < total || scoredThisReveal.current === rv.roundNumber) return;
    scoredThisReveal.current = rv.roundNumber;
    const mine = rv.pointsAwarded.find((p) => p.playerId === myId)?.points ?? 0;
    if (mine > 0) sfx("points");
  }, [revealed, room?.reveal, phase, myId, sfx]);

  const playedWin = useRef(false);
  useEffect(() => {
    if (phase === "final" && !playedWin.current) {
      playedWin.current = true;
      sfx("win");
    }
    if (phase !== "final") playedWin.current = false;
  }, [phase, sfx]);

  const playersById = useMemo(() => {
    const map = new Map<string, FamilyPlayerInfo>();
    for (const p of room?.players ?? []) map.set(p.id, p);
    return map;
  }, [room?.players]);

  // Seed my own note box once, then let me type freely without the server
  // echoing my own keystrokes back at me.
  const storedNote = room?.setup.myNote;
  useEffect(() => {
    if (familyDraftLoaded.current || storedNote === undefined) return;
    familyDraftLoaded.current = true;
    setFamilyDraft(storedNote);
  }, [storedNote]);

  // Show the rules once, unprompted, the first time someone lands in a lobby.
  useEffect(() => {
    if (room?.phase !== "lobby") return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(SEEN_RULES_KEY)) return;
    window.localStorage.setItem(SEEN_RULES_KEY, "1");
    setShowRules(true);
  }, [room?.phase]);

  const copyCode = () => {
    if (!room) return;
    void navigator.clipboard?.writeText(room.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!snapshot || !room) {
    return (
      <div className="fm-app fm-app-center">
        <Styles />
        <div className="fm-boot">
          <span className="fm-boot-note" />
          <p className="fm-boot-text">רגע</p>
        </div>
      </div>
    );
  }

  const shell = (children: React.ReactNode, rail?: React.ReactNode, dock?: React.ReactNode) => (
    <div className="fm-app">
      <Styles />
      <Toast message={message} />
      {showRules && <RulesSheet isCouple={isCouple} onClose={() => setShowRules(false)} />}
      <div className="fm-frame">
        {rail}
        {showStandings && room.phase !== "lobby" && <Standings players={room.players} myId={myId} />}
        <main className="fm-main">{children}</main>
        {dock}
      </div>
    </div>
  );

  const rail = (eyebrow: string, right?: string) => (
    <header className="fm-rail">
      <span className="fm-eyebrow">{eyebrow}</span>
      <span className="fm-rail-end">
        {right && <span className="fm-rail-right">{right}</span>}
        {room.phase !== "lobby" && room.phase !== "final" && (
          <ScoreTag
            players={room.players}
            myId={myId}
            open={showStandings}
            onToggle={() => setShowStandings((v) => !v)}
          />
        )}
        <button
          type="button"
          className="fm-help"
          onClick={() => setShowRules(true)}
          aria-label="איך משחקים"
        >
          ?
        </button>
        <SoundToggle muted={muted} onToggle={toggleSound} />
      </span>
    </header>
  );

  // ── Lobby ─────────────────────────────────────────────────────────────────
  if (room.phase === "lobby") {
    const missing = room.config.minPlayers - room.players.length;
    const setup = room.setup;
    const usingAi = setup.source === "ai";

    const pickSource = (source: "file" | "ai") => emit("f_update_setup", { source });
    const saveNote = () => emit("f_set_note", { text: familyDraft });
    const writtenCount = setup.notes.filter((n) => n.hasWritten).length;

    return shell(
      <>
        <Note tone="quiet">
          <p className="fm-kicker">קוד החדר</p>
          <button type="button" className="fm-code" onClick={copyCode}>
            {room.code}
          </button>
          <p className="fm-hint">{copied ? "הקוד הועתק" : "הקישו כדי להעתיק, ושלחו למשפחה"}</p>
        </Note>

        {isHost && setup.aiAvailable && (
          <section className="fm-block">
            <h2 className="fm-block-title">מאיפה השאלות</h2>
            <div className="fm-source">
              <button
                type="button"
                className={`fm-source-opt${!usingAi ? " fm-source-on" : ""}`}
                onClick={() => pickSource("file")}
                aria-pressed={!usingAi}
              >
                <span className="fm-source-name">השאלות שלי</span>
                <span className="fm-source-desc">הרשימה הקבועה מהקובץ</span>
              </button>
              <button
                type="button"
                className={`fm-source-opt${usingAi ? " fm-source-on" : ""}`}
                onClick={() => pickSource("ai")}
                aria-pressed={usingAi}
              >
                <span className="fm-source-name">מותאם למשפחה</span>
                <span className="fm-source-desc">שאלות שנכתבות עליכם</span>
              </button>
            </div>
            {setup.aiFailed && (
              <p className="fm-family-fallback">
                לא הצלחנו לכתוב שאלות מותאמות הפעם, אז שיחקנו עם הרשימה הקבועה.
              </p>
            )}
          </section>
        )}

        {/* Everyone contributes, not just the host — more points of view make
            sharper questions, and the teenagers know things grandma does not. */}
        {usingAi && (
          <section className="fm-block">
            <h2 className="fm-block-title">ספרו על המשפחה</h2>
            <div className="fm-family-box">
              <p className="fm-family-help">
                כתבו מה שבא לכם על המשפחה — מי תמיד מאחר, מי לא מרים טלפון, בדיחות פנימיות, ריבים קבועים.
                כל אחד כותב בנפרד, ומכל מה שתכתבו ייכתבו השאלות של המשחק.
              </p>
              <textarea
                id="fm-family"
                className="fm-family-input"
                value={familyDraft}
                onChange={(e) => setFamilyDraft(e.target.value.slice(0, room.config.noteMaxChars))}
                onBlur={saveNote}
                rows={4}
                placeholder="סבתא תמיד מאחרת ומביאה יותר מדי אוכל, אבא מתווכח על הכל, אח שלי לא מרים ראש מהטלפון…"
                aria-label="מה שאתם רוצים לספר על המשפחה"
              />
              <div className="fm-family-foot">
                <span className="fm-count">{familyDraft.length}/{room.config.noteMaxChars}</span>
                <button type="button" className="fm-family-save" onClick={saveNote}>
                  שמרו
                </button>
              </div>
            </div>

            <ul className="fm-roster-list fm-notes-roster">
              {setup.notes.map((n) => (
                <li
                  key={n.playerId}
                  className={`fm-chip${n.hasWritten ? " fm-chip-done" : ""}`}
                  style={n.hasWritten ? { background: colorFor(room.players, n.playerId), borderColor: colorFor(room.players, n.playerId) } : undefined}
                >
                  <span className="fm-chip-name">{n.nickname}</span>
                  {n.hasWritten && <span className="fm-chip-tick" aria-hidden>✓</span>}
                </li>
              ))}
            </ul>
            <p className="fm-roster-caption">
              כתבו {writtenCount} מתוך {setup.notes.length} · אפשר להתחיל גם בלי כולם
            </p>
          </section>
        )}

        {isHost && (
          <section className="fm-block">
            <h2 className="fm-block-title">אורך המשחק</h2>
            <div className="fm-rounds">
              <button
                type="button"
                className="fm-round-step"
                onClick={() => emit("f_update_setup", { roundCount: setup.roundCount - 5 })}
                disabled={setup.roundCount <= room.config.minRounds}
                aria-label="פחות סבבים"
              >
                −
              </button>
              <div className="fm-round-value">
                <span className="fm-round-num">{setup.roundCount}</span>
                <span className="fm-round-label">סבבים</span>
              </div>
              <button
                type="button"
                className="fm-round-step"
                onClick={() => emit("f_update_setup", { roundCount: setup.roundCount + 5 })}
                disabled={setup.roundCount >= room.config.maxRounds}
                aria-label="עוד סבבים"
              >
                +
              </button>
            </div>
            <p className="fm-note-line">
              בערך {Math.round((setup.roundCount * 40) / 60)} דקות משחק. סוגי הסבבים מעורבבים אקראית בכל משחק.
            </p>
          </section>
        )}

        <section className="fm-block">
          <h2 className="fm-block-title">בחדר · {room.players.length}</h2>
          <ul className="fm-people">
            {room.players.map((p) => (
              <li key={p.id} className="fm-people-row">
                <Avatar players={room.players} id={p.id} nickname={p.nickname} />
                <span className="fm-person-name">{p.nickname}</span>
                {p.isShared && <span className="fm-badge">מכשיר משותף</span>}
                {p.isHost && <span className="fm-badge">מנהל</span>}
                {!p.isOnline && <span className="fm-badge fm-badge-off">מנותק</span>}
              </li>
            ))}
          </ul>
          <p className="fm-note-line">
            משחקים שניים מטלפון אחד? בחרו &ldquo;שני אנשים על מכשיר אחד&rdquo; במסך ההצטרפות ותופיעו כשחקן אחד.
          </p>
          <p className="fm-note-line">
            🔊 המוזיקה נשמעת הכי טוב מטלפון אחד. השאירו אותה דלוקה אצל מי שקרוב לרמקול, והשאר יכולים לכבות למעלה.
          </p>
        </section>
      </>,
      rail(gameTitle),
      <footer className="fm-dock">
        {isHost ? (
          <button
            type="button"
            className="fm-action"
            disabled={missing > 0 || setup.isPreparing}
            onClick={() => emit("f_start_game")}
          >
            {setup.isPreparing ? "כותבים שאלות עליכם…" : missing > 0 ? `צריך עוד ${missing} שחקנים` : "התחילו לשחק"}
          </button>
        ) : (
          <p className="fm-dock-wait">{setup.isPreparing ? "מכינים שאלות…" : "ממתינים שהמנהל יתחיל"}</p>
        )}
      </footer>,
    );
  }

  // ── Survey ────────────────────────────────────────────────────────────────
  if (room.phase === "survey" && room.setup.isPreparing) {
    return shell(
      <Note tone="quiet">
        <p className="fm-kicker">רגע לפני שמתחילים</p>
        <h1 className="fm-headline">כותבים את הסבבים עליכם</h1>
        <p className="fm-body">קראנו מה כתבתם, ועכשיו בונים מזה את השאלות.</p>
        <span className="fm-prep-dots" aria-hidden><i /><i /><i /></span>
      </Note>,
      rail("מכינים"),
    );
  }

  if (room.phase === "survey" && survey) {
    const total = survey.questions.length;
    const done = editingSurvey ? surveyIndex >= total : surveyIndex >= total || survey.iAmFinished;

    const saveAndNext = () => {
      sfx("send");
      emit("f_survey_answer", { index: surveyIndex, text: surveyDraft });
      const next = surveyIndex + 1;
      setSurveyIndex(next);
      setSurveyDraft(survey.myAnswers[next] ?? "");
      if (next >= total) setEditingSurvey(false);
    };

    const dock = (
      <footer className="fm-dock">
        <Roster
          players={room.players}
          participantIds={room.players.map((p) => p.id)}
          answeredIds={survey.finishedIds}
          caption="סיימו"
        />
        {isHost && (
          <button type="button" className="fm-action" onClick={() => emit("f_finish_survey")}>
            {survey.finishedCount === survey.totalCount ? "כולם סיימו — התחילו" : "סיימו ותתחילו"}
          </button>
        )}
      </footer>
    );

    if (done) {
      return shell(
        <>
          <Note tone="quiet" fraction={fraction} secondsLeft={secondsLeft}>
            <p className="fm-kicker">הפתקים שלך מוכנים</p>
            <h1 className="fm-headline">עכשיו מחכים לשאר</h1>
            <p className="fm-body">התשובות שלך יופיעו בהמשך המשחק בלי השם שלך.</p>
            <button
              type="button"
              className="fm-secondary"
              onClick={() => { setEditingSurvey(true); setSurveyIndex(0); setSurveyDraft(survey.myAnswers[0] ?? ""); }}
            >
              לתקן תשובה
            </button>
          </Note>
        </>,
        rail("שאלון פתיחה"),
        dock,
      );
    }

    return shell(
      <Note fraction={fraction} secondsLeft={secondsLeft}>
        <p className="fm-kicker">פתק {surveyIndex + 1} מתוך {total}</p>
        <h1 className="fm-question">{survey.questions[surveyIndex]}</h1>
        <textarea
          className="fm-write"
          value={surveyDraft}
          onChange={(e) => setSurveyDraft(e.target.value.slice(0, room.config.surveyAnswerMaxChars))}
          placeholder="כתבו כאן…"
          rows={3}
          aria-label="התשובה שלך"
        />
        <div className="fm-write-foot">
          <span className="fm-count">{surveyDraft.length}/{room.config.surveyAnswerMaxChars}</span>
          <span className="fm-hint">אף אחד לא רואה שזה אתה או את</span>
        </div>
        <button type="button" className="fm-action" onClick={saveAndNext} disabled={!surveyDraft.trim()}>
          {surveyIndex + 1 === total ? "סיימתי" : "הפתק הבא"}
        </button>
      </Note>,
      rail("שאלון פתיחה"),
      dock,
    );
  }

  // ── Question ──────────────────────────────────────────────────────────────
  if (room.phase === "question" && question) {
    const votable = question.votableIds.map((id) => playersById.get(id)).filter(Boolean) as FamilyPlayerInfo[];
    const railNode = rail(ROUND_LABEL[question.type], `${question.roundNumber}/${question.totalRounds}`);
    const dock = (
      <footer className="fm-dock">
        {question.type === "B" ? (
          <ProgressCount done={question.answeredCount} total={question.expectedCount} />
        ) : (
          <Roster
            players={room.players}
            participantIds={question.participantIds}
            answeredIds={question.answeredIds}
            caption="ענו"
          />
        )}
        {isHost && <SkipButton onSkip={() => emit("f_skip_round")} />}
      </footer>
    );

    // D — answer for yourself, then guess what your partner answered
    if (question.type === "D") {
      const answeringForSelf = question.stage === "self_answer";
      return shell(
        <>
          <Note fraction={fraction} secondsLeft={secondsLeft}>
            <p className="fm-kicker">
              {answeringForSelf ? "ענו על עצמכם" : `מה ${question.partnerNickname} ענה/תה?`}
            </p>
            <h1 className="fm-question">{question.prompt}</h1>
            <p className="fm-do">
              {answeringForSelf
                ? "בחרו את התשובה שלכם. אף אחד לא רואה אותה עדיין."
                : "100 נקודות אם תקלעו"}
            </p>
          </Note>
          <ChoiceList
            options={question.choices}
            selected={answeringForSelf ? question.myChoice : question.myPrediction}
            onPick={(index) => emit("f_choice", { optionIndex: index })}
          />
        </>,
        railNode,
        dock,
      );
    }

    // A — vote for a person
    if (question.type === "A") {
      return shell(
        <>
          <Note fraction={fraction} secondsLeft={secondsLeft}>
            <h1 className="fm-question">{question.prompt}</h1>
            <p className="fm-do">בחרו מי במשפחה · 100 נקודות למי שבוחר/ת כמו הרוב</p>
          </Note>
          <div className="fm-choices">
            {votable.map((p) => (
              <PersonButton
                key={p.id}
                player={p}
                players={room.players}
                selected={question.myVote === p.id}
                onClick={() => emit("f_vote", { targetPlayerId: p.id })}
              />
            ))}
          </div>
          {question.myVote && <p className="fm-hint fm-hint-center">אפשר לשנות עד סוף הזמן</p>}
        </>,
        railNode,
        dock,
      );
    }

    // B — whose note is this
    if (question.type === "B") {
      if (question.iAmAuthor) {
        return shell(
          <Note fraction={fraction} secondsLeft={secondsLeft} tone="quiet">
            <p className="fm-kicker">הפתק הזה שלך</p>
            <p className="fm-asked">{question.prompt}</p>
            <blockquote className="fm-quote">{question.answerText}</blockquote>
            <p className="fm-body">כולם מנסים לנחש מי כתב את זה. בלי לגלות!</p>
          </Note>,
          railNode,
          dock,
        );
      }
      return shell(
        <>
          <Note fraction={fraction} secondsLeft={secondsLeft}>
            <p className="fm-kicker">השאלה שנשאלה</p>
            <p className="fm-asked">{question.prompt}</p>
            <blockquote className="fm-quote">{question.answerText}</blockquote>
            <p className="fm-kicker fm-asked-cta">מי כתב את זה?</p>
            <p className="fm-do">נחשו מי מהמשפחה · 100 נקודות למי שמנחש/ת נכון</p>
          </Note>
          <div className="fm-choices">
            {votable.map((p) => (
              <PersonButton
                key={p.id}
                player={p}
                players={room.players}
                selected={question.myVote === p.id}
                onClick={() => emit("f_vote", { targetPlayerId: p.id })}
              />
            ))}
          </div>
          {question.myVote && <p className="fm-hint fm-hint-center">אפשר לשנות עד סוף הזמן</p>}
        </>,
        railNode,
        dock,
      );
    }

    // C — the number
    if (question.stage === "subject_input") {
      if (question.iAmSubject) {
        return shell(
          <Note fraction={fraction} secondsLeft={secondsLeft}>
            <p className="fm-kicker">רק אצלך על המסך</p>
            <h1 className="fm-question">{question.prompt}</h1>
            <NumberField
              value={numberDraft}
              onChange={setNumberDraft}
              onSubmit={() => { sfx("send"); emit("f_number", { value: Number(numberDraft) }); }}
              submitted={question.myNumber !== null}
              label="המספר שלך"
            />
          </Note>,
          railNode,
          dock,
        );
      }
      return shell(
        <Note fraction={fraction} secondsLeft={secondsLeft} tone="quiet">
          <p className="fm-kicker">רגע אחד</p>
          <h1 className="fm-headline">{question.subjectNickname} מקבל/ת שאלה סודית</h1>
          <p className="fm-body">עוד רגע תנחשו איזה מספר נכתב שם.</p>
        </Note>,
        railNode,
        dock,
      );
    }

    if (question.iAmSubject) {
      return shell(
        <Note fraction={fraction} secondsLeft={secondsLeft} tone="quiet">
          <p className="fm-kicker">התשובה שלך</p>
          <p className="fm-bignum">{question.myNumber}</p>
          <p className="fm-body">כל השאר מנחשים עכשיו. שקט.</p>
        </Note>,
        railNode,
        dock,
      );
    }

    return shell(
      <Note fraction={fraction} secondsLeft={secondsLeft}>
        <p className="fm-kicker">{question.subjectNickname} נשאל/ה</p>
        <h1 className="fm-question">{question.prompt}</h1>
        <NumberField
          value={numberDraft}
          onChange={setNumberDraft}
          onSubmit={() => emit("f_number", { value: Number(numberDraft) })}
          submitted={question.myNumber !== null}
          label="הניחוש שלך"
        />
        <p className="fm-do">הניחוש הכי קרוב מקבל 100 · פגיעה מדויקת 150</p>
      </Note>,
      railNode,
      dock,
    );
  }

  // ── Reveal ────────────────────────────────────────────────────────────────
  if (room.phase === "reveal" && reveal) {
    const finished = revealed >= revealCount;
    const myAward = reveal.pointsAwarded.find((p) => p.playerId === myId);
    const myPoints = myAward?.points ?? 0;
    const myReason = myAward?.reason ?? "נקודות בסבב";

    return shell(
      <>
        <Note tone="quiet">
          <p className="fm-kicker">{ROUND_LABEL[reveal.type]}</p>
          {reveal.type === "B" ? (
            <>
              <p className="fm-asked">{reveal.prompt}</p>
              <blockquote className="fm-quote fm-quote-sm">{reveal.answerText}</blockquote>
            </>
          ) : (
            <h1 className="fm-recap">
              {reveal.prompt}
            </h1>
          )}
          {finished && <p className="fm-verdict">{reveal.summary}</p>}
        </Note>

        <ul className="fm-results">
          {reveal.predictions.slice(0, revealed).map((row) => (
            <li key={row.playerId} className={`fm-result${row.correct ? " fm-result-hit" : ""}`}>
              <Avatar players={room.players} id={row.playerId} nickname={row.nickname} size={38} />
              <span className="fm-predict">
                <span className="fm-predict-name">{row.nickname} ענה/תה</span>
                <span className="fm-predict-choice">{row.choice}</span>
                <span className="fm-predict-guess">
                  {row.predictedByPartner ? `ניחשו: ${row.predictedByPartner}` : "לא ניחשו"}
                </span>
              </span>
              <span className="fm-result-value">{row.correct ? "✓" : "✗"}</span>
            </li>
          ))}
          {reveal.votes.slice(0, revealed).map((row) => (
            <li key={row.playerId} className={`fm-result${row.isAuthor ? " fm-result-hit" : ""}`}>
              <Avatar players={room.players} id={row.playerId} nickname={row.nickname} size={38} />
              <span className="fm-person-name">{row.nickname}</span>
              {row.isAuthor && <span className="fm-badge fm-badge-hit">הכותב</span>}
              <span className="fm-result-value">{row.votes}</span>
            </li>
          ))}
          {reveal.numbers.slice(0, revealed).map((row) => (
            <li key={row.playerId} className={`fm-result${row.isClosest ? " fm-result-hit" : ""}`}>
              <Avatar players={room.players} id={row.playerId} nickname={row.nickname} size={38} />
              <span className="fm-person-name">{row.nickname}</span>
              {row.isExact && <span className="fm-badge fm-badge-hit">בול</span>}
              {row.isClosest && !row.isExact && <span className="fm-badge fm-badge-hit">הכי קרוב</span>}
              <span className="fm-result-value">{row.guess}</span>
            </li>
          ))}
        </ul>
      </>,
      rail("תוצאות", `${reveal.roundNumber}/${room.totalRounds}`),
      <footer className="fm-dock">
        {finished ? (
          <p className={`fm-score-flash${myPoints > 0 ? " fm-score-win" : ""}`}>
            {myPoints > 0 ? `+${myPoints}` : "0"}
            <span>{myPoints > 0 ? myReason : "לא קיבלת נקודות בסבב הזה"}</span>
          </p>
        ) : (
          <p className="fm-dock-wait">חושפים…</p>
        )}
        {isHost && <SkipButton onSkip={() => emit("f_skip_round")} label="לסבב הבא" />}
      </footer>,
    );
  }

  // ── Final ─────────────────────────────────────────────────────────────────
  if (room.phase === "final" && room.final) {
    const [first, ...rest] = room.final.standings;

    return shell(
      <>
        {first && (
          <Note tone="quiet">
            <p className="fm-kicker">המנצח</p>
            <div className="fm-winner">
              <Avatar players={room.players} id={first.id} nickname={first.nickname} size={72} />
              <h1 className="fm-headline">{first.nickname}</h1>
              <p className="fm-winner-score">{first.score}</p>
            </div>
          </Note>
        )}

        {room.final.titles.length > 0 && (
          <section className="fm-block">
            <h2 className="fm-block-title">התארים של הערב</h2>
            <ul className="fm-awards">
              {room.final.titles.map((t) => (
                <li key={t.key} className="fm-award">
                  <span className="fm-award-label">{t.label}</span>
                  <span className="fm-award-name">{t.nickname}</span>
                  <span className="fm-award-detail">{t.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="fm-block">
          <h2 className="fm-block-title">הטבלה</h2>
          <ul className="fm-people">
            {rest.map((p, i) => (
              <li key={p.id} className={`fm-people-row${p.id === myId ? " fm-people-me" : ""}`}>
                <span className="fm-place">{i + 2}</span>
                <span className="fm-person-name">{p.nickname}</span>
                <span className="fm-result-value">{p.score}</span>
              </li>
            ))}
          </ul>
        </section>
      </>,
      rail("סוף המשחק"),
      <footer className="fm-dock">
        {isHost && (
          <button type="button" className="fm-action" onClick={() => emit("f_reset_room")}>
            שחקו שוב
          </button>
        )}
        <button type="button" className="fm-secondary" onClick={() => router.push("/")}>
          לדף הבית
        </button>
      </footer>,
    );
  }

  return (
    <div className="fm-app fm-app-center">
      <Styles />
      <div className="fm-boot"><span className="fm-boot-note" /></div>
    </div>
  );
}

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="fm-toast" role="status">{message}</div>;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function Styles() {
  return (
    <style>{`
      .fm-app {
        --ink:        #241033;
        --ink-deep:   #170920;
        --paper:      #FFFDF7;
        --text:       #1B0B26;
        --muted:      #6E5C7A;
        --line:       #E8DFE4;
        --persimmon:  #FF5A3C;
        --mint:       #0E7A50;
        --gold:       #C98A0B;

        min-height: 100dvh;
        background:
          radial-gradient(ellipse 90% 50% at 50% 0%, #3A1A4F 0%, transparent 60%),
          var(--ink-deep);
        color: var(--paper);
        direction: rtl;
        font-family: var(--font-heebo), system-ui, -apple-system, "Segoe UI", sans-serif;
        display: flex;
        justify-content: center;
        -webkit-tap-highlight-color: transparent;
      }
      .fm-app-center { align-items: center; }

      .fm-frame {
        width: 100%;
        max-width: 540px;
        min-height: 100dvh;
        display: flex;
        flex-direction: column;
        padding: max(14px, env(safe-area-inset-top)) 16px calc(14px + env(safe-area-inset-bottom));
        gap: 16px;
      }

      /* ── Rail ─────────────────────────────────────────────────────────── */
      .fm-rail {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; flex-shrink: 0;
      }
      .fm-eyebrow {
        font-size: 15px; font-weight: 700; letter-spacing: 0.08em;
        color: #C9A9DC; text-transform: none;
      }
      .fm-rail-right {
        font-size: 15px; font-weight: 700; color: #8E77A0;
        font-variant-numeric: tabular-nums;
      }
      .fm-rail-end { display: flex; align-items: center; gap: 8px; }

      /* ── Score, rules, standings ──────────────────────────────────────── */
      .fm-scoretag {
        display: flex; flex-direction: column; align-items: center; gap: 0;
        min-height: 44px; padding: 4px 14px; border-radius: 999px;
        border: 2px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06);
        color: var(--paper); font-family: inherit; cursor: pointer; line-height: 1.1;
      }
      .fm-scoretag-num { font-size: 20px; font-weight: 900; font-variant-numeric: tabular-nums; }
      .fm-scoretag-place { font-size: 11px; font-weight: 700; color: #A98FBA; }

      .fm-help {
        width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06);
        color: var(--paper); font-family: inherit; font-size: 21px; font-weight: 900;
        cursor: pointer; line-height: 1;
      }

      .fm-standings {
        list-style: none; margin: 0; padding: 10px; border-radius: 16px;
        background: rgba(0,0,0,0.35); border: 2px solid rgba(255,255,255,0.12);
        display: flex; flex-direction: column; gap: 6px;
      }
      .fm-standing {
        display: flex; align-items: center; gap: 10px;
        padding: 9px 12px; border-radius: 12px;
        font-size: 18px; font-weight: 700;
      }
      .fm-standing-me { background: rgba(255,90,60,0.2); }

      /* ── How to play ──────────────────────────────────────────────────── */
      .fm-sheet {
        position: fixed; inset: 0; z-index: 60;
        background: rgba(10,5,16,0.8);
        display: flex; align-items: flex-end; justify-content: center;
        padding: 16px; overflow-y: auto;
      }
      .fm-sheet-card {
        width: 100%; max-width: 520px;
        background: var(--paper); color: var(--text);
        border-radius: 22px; padding: 24px 20px calc(20px + env(safe-area-inset-bottom));
        display: flex; flex-direction: column; gap: 14px;
        margin-block: auto;
        animation: fm-rise 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .fm-sheet-title { margin: 0; font-size: 28px; font-weight: 900; letter-spacing: -0.02em; }
      .fm-sheet-sub {
        margin: 6px 0 0; font-size: 15px; font-weight: 700;
        letter-spacing: 0.06em; color: var(--muted);
      }
      .fm-rules { margin: 0; padding-inline-start: 22px; display: flex; flex-direction: column; gap: 14px; }
      .fm-rules-plain { list-style: none; padding-inline-start: 0; }
      .fm-rules li { font-size: 17px; line-height: 1.5; color: var(--muted); }
      .fm-rule-head { display: block; font-size: 19px; font-weight: 800; color: var(--text); }
      .fm-rule-points {
        display: block; margin-top: 4px; font-size: 15px; font-weight: 700;
        color: var(--persimmon);
      }
      .fm-sheet-foot { margin: 0; font-size: 16px; color: var(--muted); }
      .fm-sound {
        width: 44px; height: 44px; flex-shrink: 0;
        border-radius: 50%; border: 2px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.06);
        font-size: 19px; line-height: 1; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
      }
      .fm-sound[aria-pressed="true"] {
        border-color: var(--persimmon);
        background: rgba(255,90,60,0.18);
      }

      .fm-main {
        flex: 1; display: flex; flex-direction: column; gap: 14px;
        min-height: 0;
      }

      /* ── The note ─────────────────────────────────────────────────────── */
      .fm-note {
        position: relative;
        background: var(--paper);
        color: var(--text);
        border-radius: 22px;
        padding: 26px 22px 24px;
        box-shadow: 0 18px 40px -18px rgba(0,0,0,0.75), 0 2px 0 rgba(255,255,255,0.35) inset;
        display: flex; flex-direction: column; gap: 14px;
        overflow: hidden;
      }
      .fm-note-quiet { text-align: center; align-items: center; }

      .fm-edge {
        position: absolute; inset-block-start: 0; inset-inline: 0;
        height: 6px; background: var(--line);
      }
      .fm-edge-fill {
        height: 100%; width: 100%;
        background: var(--persimmon);
        transform-origin: right center;
        transition: transform 0.12s linear, background 0.3s;
      }
      .fm-edge-urgent { background: #D91E36; }

      .fm-clock {
        position: absolute; inset-block-start: 12px; inset-inline-start: 16px;
        display: flex; align-items: baseline; gap: 4px;
        color: var(--muted);
      }
      .fm-clock-num { font-size: 22px; font-weight: 900; font-variant-numeric: tabular-nums; }
      .fm-clock-label { font-size: 13px; font-weight: 700; }
      .fm-clock-urgent { color: #D91E36; animation: fm-beat 1s ease-in-out infinite; }
      .fm-clock-urgent .fm-clock-num { font-size: 34px; }
      @keyframes fm-beat { 50% { transform: scale(1.1); } }

      /* what to do, and what it is worth */
      .fm-do {
        margin: 0; font-size: 16px; font-weight: 700; color: var(--muted);
        padding-top: 2px;
      }

      /* ── Type ─────────────────────────────────────────────────────────── */
      .fm-kicker {
        margin: 0; font-size: 15px; font-weight: 700;
        letter-spacing: 0.06em; color: var(--muted);
      }
      .fm-question {
        margin: 0; font-size: 31px; font-weight: 900;
        line-height: 1.22; letter-spacing: -0.02em;
      }
      .fm-headline {
        margin: 0; font-size: 28px; font-weight: 900;
        line-height: 1.25; letter-spacing: -0.02em;
      }
      .fm-recap { margin: 0; font-size: 22px; font-weight: 800; line-height: 1.3; }
      .fm-body { margin: 0; font-size: 18px; line-height: 1.55; color: var(--muted); }
      .fm-hint { margin: 0; font-size: 15px; color: var(--muted); }
      .fm-hint-center { text-align: center; color: #A98FBA; }
      .fm-count { font-size: 15px; color: var(--muted); font-variant-numeric: tabular-nums; }

      .fm-quote {
        margin: 0; padding: 18px 18px 18px 16px;
        border-inline-start: 5px solid var(--persimmon);
        background: #FFF4EF; border-radius: 12px;
        font-size: 25px; font-weight: 800; line-height: 1.35;
      }
      .fm-quote-sm { font-size: 20px; }
      /* the survey question the anonymous answer replies to */
      .fm-asked {
        margin: 0; font-size: 19px; font-weight: 700;
        line-height: 1.4; color: var(--muted);
      }
      .fm-asked-cta { color: var(--text); font-size: 17px; }

      .fm-bignum {
        margin: 0; font-size: 68px; font-weight: 900; line-height: 1;
        letter-spacing: -0.04em; font-variant-numeric: tabular-nums;
      }

      .fm-code {
        font-family: inherit; border: none; background: none; cursor: pointer;
        font-size: 46px; font-weight: 900; letter-spacing: 0.16em;
        color: var(--text); padding: 0; line-height: 1.1;
      }

      /* ── Choices ──────────────────────────────────────────────────────── */
      .fm-choices { display: flex; flex-direction: column; gap: 10px; }
      .fm-person {
        display: flex; align-items: center; gap: 14px;
        width: 100%; min-height: 76px; padding: 12px 16px;
        border-radius: 18px; border: 2px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06); color: var(--paper);
        font-family: inherit; font-size: 22px; font-weight: 700;
        text-align: start; cursor: pointer;
        transition: transform 0.12s, background 0.15s, border-color 0.15s;
      }
      .fm-person:active { transform: scale(0.985); }
      .fm-person-on { border-width: 2px; }
      .fm-person-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .fm-person-mark {
        width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.3);
        display: flex; align-items: center; justify-content: center;
        font-size: 17px; font-weight: 900; color: #fff;
      }

      .fm-avatar {
        border-radius: 50%; flex-shrink: 0; color: #fff;
        display: inline-flex; align-items: center; justify-content: center;
        font-weight: 800; letter-spacing: -0.02em;
      }

      /* ── Round D options ──────────────────────────────────────────────── */
      .fm-option {
        display: flex; align-items: center; gap: 12px; width: 100%;
        min-height: 72px; padding: 14px 18px;
        border-radius: 18px; border: 2px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.05); color: var(--paper);
        font-family: inherit; font-size: 21px; font-weight: 700;
        text-align: start; cursor: pointer;
      }
      .fm-option:active { transform: scale(0.985); }
      .fm-option-on { border-color: var(--persimmon); background: rgba(255,90,60,0.18); }
      .fm-option-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .fm-option-tick { font-size: 25px; font-weight: 900; color: var(--persimmon); }

      .fm-predict { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
      .fm-predict-name { font-size: 15px; color: #A98FBA; font-weight: 700; }
      .fm-predict-choice { font-size: 20px; font-weight: 800; overflow-wrap: anywhere; }
      .fm-predict-guess { font-size: 15px; color: #A98FBA; }

      /* ── Number ───────────────────────────────────────────────────────── */
      .fm-number { display: flex; flex-direction: column; gap: 12px; }
      .fm-number-row { display: flex; align-items: center; gap: 10px; }
      .fm-step {
        width: 70px; height: 70px; flex-shrink: 0;
        border-radius: 18px; border: 2px solid var(--line);
        background: #FAF6F0; color: var(--text);
        font-family: inherit; font-size: 34px; font-weight: 900;
        cursor: pointer;
      }
      .fm-step:active { background: var(--line); }
      .fm-number-input {
        flex: 1; min-width: 0; height: 70px; text-align: center;
        border-radius: 18px; border: 2px solid var(--line); background: #fff;
        color: var(--text); font-family: inherit;
        font-size: 38px; font-weight: 900; font-variant-numeric: tabular-nums;
      }
      .fm-number-input:focus-visible { outline: 3px solid var(--persimmon); outline-offset: 2px; }

      /* ── Writing ──────────────────────────────────────────────────────── */
      .fm-write {
        width: 100%; box-sizing: border-box; padding: 16px;
        border-radius: 16px; border: 2px solid var(--line); background: #fff;
        color: var(--text); font-family: inherit; font-size: 22px; line-height: 1.45;
        resize: none;
      }
      .fm-write:focus-visible { outline: 3px solid var(--persimmon); outline-offset: 2px; }
      .fm-write-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }

      /* ── Actions ──────────────────────────────────────────────────────── */
      .fm-action {
        width: 100%; min-height: 68px; padding: 16px 20px;
        border: none; border-radius: 18px;
        background: var(--persimmon); color: #fff;
        font-family: inherit; font-size: 23px; font-weight: 800;
        cursor: pointer; box-shadow: 0 6px 0 #C63A21;
        transition: transform 0.1s, box-shadow 0.1s;
      }
      .fm-action:active { transform: translateY(4px); box-shadow: 0 2px 0 #C63A21; }
      .fm-action:disabled { background: #B9A8C4; box-shadow: 0 6px 0 #8E7C99; cursor: default; }
      .fm-secondary {
        width: 100%; min-height: 60px; padding: 14px;
        border-radius: 16px; border: 2px solid rgba(255,255,255,0.22);
        background: transparent; color: var(--paper);
        font-family: inherit; font-size: 19px; font-weight: 700; cursor: pointer;
      }
      .fm-note .fm-secondary { border-color: var(--line); color: var(--muted); }

      /* ── Blocks and lists ─────────────────────────────────────────────── */
      .fm-block { display: flex; flex-direction: column; gap: 10px; }
      .fm-block-title {
        margin: 0; font-size: 15px; font-weight: 700;
        letter-spacing: 0.08em; color: #C9A9DC;
      }
      .fm-people, .fm-awards, .fm-results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .fm-people-row {
        display: flex; align-items: center; gap: 12px;
        padding: 12px 16px; border-radius: 16px;
        background: rgba(255,255,255,0.06);
        font-size: 20px; font-weight: 700;
      }
      .fm-people-me { border: 2px solid var(--persimmon); }
      .fm-place { font-size: 17px; font-weight: 800; color: #8E77A0; min-width: 24px; font-variant-numeric: tabular-nums; }
      .fm-note-line { margin: 6px 0 0; font-size: 16px; line-height: 1.6; color: #A98FBA; }

      /* ── Game length ──────────────────────────────────────────────────── */
      .fm-rounds { display: flex; align-items: center; gap: 12px; }
      .fm-round-step {
        width: 64px; height: 64px; flex-shrink: 0;
        border-radius: 16px; border: 2px solid rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.06); color: var(--paper);
        font-family: inherit; font-size: 32px; font-weight: 900; cursor: pointer;
      }
      .fm-round-step:disabled { opacity: 0.3; cursor: default; }
      .fm-round-value {
        flex: 1; display: flex; flex-direction: column; align-items: center;
        padding: 8px; border-radius: 16px; background: rgba(255,255,255,0.05);
      }
      .fm-round-num { font-size: 34px; font-weight: 900; font-variant-numeric: tabular-nums; line-height: 1.1; }
      .fm-round-label { font-size: 14px; color: #A98FBA; font-weight: 700; }

      /* ── Question source ──────────────────────────────────────────────── */
      .fm-source { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .fm-source-opt {
        display: flex; flex-direction: column; gap: 3px;
        padding: 14px 12px; min-height: 76px;
        border-radius: 16px; border: 2px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.05); color: var(--paper);
        font-family: inherit; text-align: start; cursor: pointer;
      }
      .fm-source-on { border-color: var(--persimmon); background: rgba(255,90,60,0.16); }
      .fm-source-name { font-size: 18px; font-weight: 800; }
      .fm-source-desc { font-size: 14px; color: #A98FBA; line-height: 1.35; }

      .fm-family-box {
        margin-top: 10px; padding: 16px; border-radius: 18px;
        background: rgba(255,255,255,0.05);
        border: 2px solid rgba(255,255,255,0.1);
        display: flex; flex-direction: column; gap: 8px;
      }
      .fm-family-label { font-size: 18px; font-weight: 800; }
      .fm-family-help { margin: 0; font-size: 15px; line-height: 1.5; color: #A98FBA; }
      .fm-family-input {
        width: 100%; box-sizing: border-box; padding: 14px;
        border-radius: 14px; border: 2px solid rgba(255,255,255,0.16);
        background: rgba(0,0,0,0.25); color: var(--paper);
        font-family: inherit; font-size: 18px; line-height: 1.5; resize: vertical;
      }
      .fm-family-input::placeholder { color: #7C6689; }
      .fm-family-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .fm-family-foot .fm-count { color: #8E77A0; }
      .fm-family-save {
        padding: 10px 20px; min-height: 44px;
        border-radius: 12px; border: 2px solid var(--persimmon);
        background: transparent; color: var(--persimmon);
        font-family: inherit; font-size: 16px; font-weight: 800; cursor: pointer;
      }
      .fm-notes-roster { margin-top: 12px; }
      .fm-family-fallback {
        margin: 10px 0 0; font-size: 15px; line-height: 1.5; color: #FFC53D;
      }

      .fm-badge {
        font-size: 13px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
        background: rgba(255,255,255,0.14); color: #E4D6EC; white-space: nowrap;
      }
      .fm-badge-off { background: rgba(217,30,54,0.22); color: #FFB3BE; }
      .fm-badge-hit { background: var(--mint); color: #fff; }

      /* ── Results ──────────────────────────────────────────────────────── */
      .fm-result {
        display: flex; align-items: center; gap: 12px;
        padding: 13px 16px; border-radius: 16px;
        background: rgba(255,255,255,0.07); border: 2px solid transparent;
        font-size: 20px; font-weight: 700;
        animation: fm-rise 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .fm-result-hit { border-color: var(--mint); background: rgba(34,197,127,0.14); }
      .fm-result-value {
        margin-inline-start: auto; font-size: 27px; font-weight: 900;
        font-variant-numeric: tabular-nums;
      }
      @keyframes fm-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

      .fm-verdict { margin: 0; font-size: 21px; font-weight: 700; animation: fm-rise 0.4s ease; }
      .fm-verdict strong { font-weight: 900; }

      /* ── Winner ───────────────────────────────────────────────────────── */
      .fm-winner { display: flex; flex-direction: column; align-items: center; gap: 8px; }
      .fm-winner-score {
        margin: 0; font-size: 52px; font-weight: 900; line-height: 1;
        color: var(--gold); font-variant-numeric: tabular-nums; letter-spacing: -0.03em;
      }
      .fm-award {
        display: flex; flex-direction: column; gap: 3px;
        padding: 14px 16px; border-radius: 16px;
        background: rgba(255,255,255,0.06);
        border-inline-start: 5px solid var(--persimmon);
      }
      .fm-award-label { font-size: 14px; font-weight: 700; letter-spacing: 0.06em; color: #C9A9DC; }
      .fm-award-name { font-size: 22px; font-weight: 900; }
      .fm-award-detail { font-size: 16px; color: #A98FBA; }

      /* ── Dock ─────────────────────────────────────────────────────────── */
      .fm-dock {
        flex-shrink: 0; display: flex; flex-direction: column; gap: 10px;
        padding-top: 4px;
      }
      .fm-dock-wait { margin: 0; text-align: center; font-size: 18px; color: #A98FBA; }
      .fm-skip {
        width: 100%; min-height: 52px; padding: 12px;
        border-radius: 14px; border: 2px solid rgba(255,255,255,0.2);
        background: transparent; color: #C9A9DC;
        font-family: inherit; font-size: 17px; font-weight: 700; cursor: pointer;
      }
      .fm-skip:active { background: rgba(255,255,255,0.08); }

      .fm-roster { display: flex; flex-direction: column; gap: 8px; }
      .fm-roster-list {
        list-style: none; margin: 0; padding: 0;
        display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
      }
      .fm-chip {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 7px 13px; border-radius: 999px;
        border: 2px solid rgba(255,255,255,0.18);
        font-size: 16px; font-weight: 700; color: #A98FBA;
        transition: background 0.25s, color 0.25s, border-color 0.25s;
      }
      .fm-chip-done { color: #fff; }
      .fm-chip-tick { font-size: 14px; font-weight: 900; }
      .fm-roster-caption {
        margin: 0; text-align: center; font-size: 15px; color: #8E77A0;
        font-variant-numeric: tabular-nums;
      }

      .fm-score-flash {
        margin: 0; text-align: center;
        font-size: 40px; font-weight: 900; line-height: 1.1;
        color: #8E77A0; font-variant-numeric: tabular-nums;
        animation: fm-rise 0.4s ease;
      }
      .fm-score-flash span { display: block; font-size: 16px; font-weight: 700; color: #8E77A0; }
      .fm-score-win { color: #34D399; }

      .fm-prep-dots { display: flex; gap: 8px; }
      .fm-prep-dots i {
        width: 11px; height: 11px; border-radius: 50%;
        background: var(--persimmon); opacity: 0.35;
        animation: fm-blink 1.2s ease-in-out infinite;
      }
      .fm-prep-dots i:nth-child(2) { animation-delay: 0.2s; }
      .fm-prep-dots i:nth-child(3) { animation-delay: 0.4s; }
      @keyframes fm-blink { 50% { opacity: 1; } }

      /* ── Boot + toast ─────────────────────────────────────────────────── */
      .fm-boot { display: flex; flex-direction: column; align-items: center; gap: 16px; }
      .fm-boot-note {
        width: 62px; height: 78px; border-radius: 8px; background: var(--paper);
        box-shadow: 0 14px 30px -14px rgba(0,0,0,0.8);
        animation: fm-tilt 1.6s ease-in-out infinite;
      }
      @keyframes fm-tilt { 0%,100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
      .fm-boot-text { margin: 0; font-size: 18px; color: #A98FBA; }

      .fm-toast {
        position: fixed; inset-inline: 16px; top: max(16px, env(safe-area-inset-top));
        z-index: 50; padding: 15px 18px; border-radius: 14px; text-align: center;
        background: #D91E36; color: #fff; font-size: 18px; font-weight: 700;
        box-shadow: 0 10px 30px -10px rgba(0,0,0,0.6);
      }

      /* ── Quality floor ────────────────────────────────────────────────── */
      .fm-app :focus-visible { outline: 3px solid #FFC53D; outline-offset: 3px; }

      @media (max-width: 360px) {
        .fm-question { font-size: 27px; }
        .fm-code { font-size: 38px; }
        .fm-person { font-size: 20px; min-height: 70px; }
      }

      @media (prefers-reduced-motion: reduce) {
        .fm-app *, .fm-app *::before, .fm-app *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: 0.01ms !important;
        }
      }
    `}</style>
  );
}
