"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom, joinRoom } from "../lib/api";
import { createPersonalityRoom, joinPersonalityRoom } from "../lib/personality-api";
import { createTabooRoom, joinTabooRoom } from "../lib/taboo-api";
import { createCodenamesRoom, joinCodenamesRoom } from "../lib/codenames-api";
import { createFamilyRoom, joinFamilyRoom } from "../lib/family-api";
import { listSessions, saveSession, type StoredSession } from "../lib/storage";

// ─── Game definitions ─────────────────────────────────────────────────────────

type GameType = "categories" | "personality" | "taboo" | "codenames" | "family" | "couple";

const GAMES = [
  {
    id:     "categories" as GameType,
    emoji:  "🗺️",
    name:   "ארץ עיר",
    desc:   "קטגוריות ואותיות",
    accent: "#6366f1",
    hasMode: true,
  },
  {
    id:     "personality" as GameType,
    emoji:  "🎭",
    name:   "אישיות",
    desc:   "ניחוש דמויות",
    accent: "#a855f7",
    hasMode: false,
  },
  {
    id:     "taboo" as GameType,
    emoji:  "🎯",
    name:   "טאבו",
    desc:   "מילים אסורות",
    accent: "#f59e0b",
    hasMode: false,
  },
  {
    id:     "codenames" as GameType,
    emoji:  "🕵️",
    name:   "שם קוד",
    desc:   "ריגול וניחוש",
    accent: "#10b981",
    hasMode: false,
  },
  {
    id:     "family" as GameType,
    emoji:  "👨‍👩‍👧",
    name:   "מי מהמשפחה?",
    desc:   "ניחושים על המשפחה · 3+",
    accent: "#ef4444",
    hasMode: false,
  },
  {
    id:     "couple" as GameType,
    emoji:  "💛",
    name:   "מי מאיתנו?",
    desc:   "כמה אתם מכירים · 2",
    accent: "#e0457b",
    hasMode: false,
  },
] as const;

// ─── Nickname validation ──────────────────────────────────────────────────────

function validateNickname(name: string): string | null {
  const t = name.trim();
  if (!t)          return "הכנס שם שחקן";
  if (t.length < 2) return "שם קצר מדי — לפחות 2 תווים";
  if (t.length > 20) return "שם ארוך מדי — עד 20 תווים";
  return null;
}

// ─── Shared device — two people on one phone ("מי מהמשפחה?") ─────────────────

function SharedDeviceField({
  checked, onToggle, partner, onPartner,
}: {
  checked: boolean;
  onToggle: (v: boolean) => void;
  partner: string;
  onPartner: (v: string) => void;
}) {
  return (
    <div className="ln-field">
      <button
        type="button"
        className={`ln-check${checked ? " ln-check-on" : ""}`}
        onClick={() => onToggle(!checked)}
        aria-pressed={checked}
      >
        <span className="ln-check-box" aria-hidden>{checked ? "✓" : ""}</span>
        <span>👥 שני אנשים על מכשיר אחד</span>
      </button>

      {checked && (
        <input
          className="ln-input"
          value={partner}
          onChange={(e) => onPartner(e.target.value)}
          placeholder="השם של מי שאיתך"
          maxLength={20}
          style={{ marginTop: 10 }}
        />
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LandingShell() {
  const router = useRouter();

  const [gameType,       setGameType]   = useState<GameType>("categories");
  const [tab,            setTab]        = useState<"create" | "join">("create");
  const [createNickname, setCreateNick] = useState("");
  const [joinNickname,   setJoinNick]   = useState("");
  const [joinCode,       setJoinCode]   = useState("");
  const [mode,           setMode]       = useState<"classic" | "advanced">("classic");
  const [message,        setMessage]    = useState<string | null>(null);
  const [busy,           setBusy]       = useState<"create" | "join" | null>(null);
  const [sharedDevice,   setShared]     = useState(false);
  const [partnerName,    setPartner]    = useState("");
  const [sessions,       setSessions]   = useState<StoredSession[]>([]);

  useEffect(() => {
    setSessions(listSessions());
  }, []);

  const game = GAMES.find((g) => g.id === gameType)!;

  function switchGame(id: GameType) {
    setGameType(id);
    setMessage(null);
  }

  async function handleCreate() {
    const err = validateNickname(createNickname);
    if (err) { setMessage(err); return; }
    try {
      setBusy("create"); setMessage(null);
      if (gameType === "personality") {
        const r = await createPersonalityRoom(createNickname.trim());
        saveSession({ roomCode: r.room.room.code, playerId: r.playerId, sessionToken: r.sessionToken, gameType: "personality" });
        router.push(`/personality/${r.room.room.code}`);
      } else if (gameType === "taboo") {
        const r = await createTabooRoom(createNickname.trim());
        saveSession({ roomCode: r.room.room.code, playerId: r.playerId, sessionToken: r.sessionToken, gameType: "taboo" });
        router.push(`/taboo/${r.room.room.code}`);
      } else if (gameType === "codenames") {
        const r = await createCodenamesRoom(createNickname.trim());
        saveSession({ roomCode: r.room.code, playerId: r.playerId, sessionToken: r.sessionToken, gameType: "codenames" });
        router.push(`/codenames/${r.room.code}`);
      } else if (gameType === "family" || gameType === "couple") {
        const r = await createFamilyRoom(
          createNickname.trim(),
          gameType === "family" && sharedDevice ? partnerName.trim() : undefined,
          gameType === "couple" ? "couple" : "family",
        );
        saveSession({ roomCode: r.room.room.code, playerId: r.playerId, sessionToken: r.sessionToken, gameType: "family" });
        router.push(`/family/${r.room.room.code}`);
      } else {
        const r = await createRoom({ nickname: createNickname.trim(), settings: { mode } });
        saveSession({ roomCode: r.room.room.code, playerId: r.playerId, sessionToken: r.sessionToken, gameType: "categories" });
        router.push(`/rooms/${r.room.room.code}`);
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : "לא ניתן ליצור חדר"); }
    finally { setBusy(null); }
  }

  async function handleJoin() {
    const err = validateNickname(joinNickname);
    if (err) { setMessage(err); return; }
    if (!joinCode.trim()) { setMessage("הכנס קוד חדר"); return; }
    try {
      setBusy("join"); setMessage(null);
      const code = joinCode.toUpperCase().trim();
      if (gameType === "personality") {
        const r = await joinPersonalityRoom(code, joinNickname.trim());
        saveSession({ roomCode: code, playerId: r.playerId, sessionToken: r.sessionToken, gameType: "personality" });
        router.push(`/personality/${code}`);
      } else if (gameType === "taboo") {
        const r = await joinTabooRoom(code, joinNickname.trim());
        saveSession({ roomCode: code, playerId: r.playerId, sessionToken: r.sessionToken, gameType: "taboo" });
        router.push(`/taboo/${code}`);
      } else if (gameType === "codenames") {
        const r = await joinCodenamesRoom(code, joinNickname.trim());
        saveSession({ roomCode: code, playerId: r.playerId, sessionToken: r.sessionToken, gameType: "codenames" });
        router.push(`/codenames/${code}`);
      } else if (gameType === "family" || gameType === "couple") {
        const r = await joinFamilyRoom(code, joinNickname.trim(), gameType === "family" && sharedDevice ? partnerName.trim() : undefined);
        saveSession({ roomCode: code, playerId: r.playerId, sessionToken: r.sessionToken, gameType: "family" });
        router.push(`/family/${code}`);
      } else {
        const r = await joinRoom(code, { nickname: joinNickname.trim() });
        saveSession({ roomCode: code, playerId: r.playerId, sessionToken: r.sessionToken, gameType: "categories" });
        router.push(`/rooms/${code}`);
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : "לא ניתן להצטרף"); }
    finally { setBusy(null); }
  }

  const hrefFor = (s: StoredSession) =>
    s.gameType === "personality" ? `/personality/${s.roomCode}` :
    s.gameType === "taboo"       ? `/taboo/${s.roomCode}`       :
    s.gameType === "codenames"   ? `/codenames/${s.roomCode}`   :
    s.gameType === "family"      ? `/family/${s.roomCode}`      :
    `/rooms/${s.roomCode}`;

  return (
    <div className="ln-app" style={{ ["--accent" as string]: game.accent }}>
      <Styles />

      <div className="ln-frame">
        <header className="ln-head">
          <h1 className="ln-wordmark">ערב משחקים</h1>
          <p className="ln-sub">חמישה משחקים, טלפון אחד לכל אחד</p>
        </header>

        {/* ── Pick a game ─────────────────────────────────────────── */}
        <section className="ln-block">
          <h2 className="ln-block-title">בחרו משחק</h2>
          <div className="ln-games">
            {GAMES.map((g) => {
              const active = gameType === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`ln-game${active ? " ln-game-on" : ""}`}
                  onClick={() => switchGame(g.id)}
                  aria-pressed={active}
                  style={active ? { borderColor: g.accent, background: `${g.accent}22` } : undefined}
                >
                  <span className="ln-game-emoji" aria-hidden>{g.emoji}</span>
                  <span className="ln-game-text">
                    <span className="ln-game-name">{g.name}</span>
                    <span className="ln-game-desc">{g.desc}</span>
                  </span>
                  <span className="ln-game-edge" style={{ background: g.accent }} aria-hidden />
                </button>
              );
            })}
          </div>
        </section>

        {/* ── The form, on paper ──────────────────────────────────── */}
        <section className="ln-note">
          <div className="ln-note-edge" style={{ background: game.accent }} aria-hidden />

          <div className="ln-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "create"}
              className={`ln-tab${tab === "create" ? " ln-tab-on" : ""}`}
              onClick={() => { setTab("create"); setMessage(null); }}
            >
              חדר חדש
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "join"}
              className={`ln-tab${tab === "join" ? " ln-tab-on" : ""}`}
              onClick={() => { setTab("join"); setMessage(null); }}
            >
              הצטרפות
            </button>
          </div>

          {tab === "create" ? (
            <>
              <div className="ln-field">
                <label htmlFor="ln-create-nick">השם שלך</label>
                <input
                  id="ln-create-nick"
                  className="ln-input"
                  value={createNickname}
                  onChange={(e) => setCreateNick(e.target.value)}
                  placeholder="לדוגמה: יוני"
                  maxLength={20}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleCreate(); }}
                />
              </div>

              {gameType === "family" && (
                <SharedDeviceField
                  checked={sharedDevice}
                  onToggle={setShared}
                  partner={partnerName}
                  onPartner={setPartner}
                />
              )}

              {game.hasMode && (
                <div className="ln-field">
                  <label>מצב משחק</label>
                  <div className="ln-modes">
                    <button
                      type="button"
                      className={`ln-mode${mode === "classic" ? " ln-mode-on" : ""}`}
                      onClick={() => setMode("classic")}
                      aria-pressed={mode === "classic"}
                    >
                      <span className="ln-mode-name">אות אחת</span>
                      <span className="ln-mode-desc">התשובה מתחילה באות</span>
                    </button>
                    <button
                      type="button"
                      className={`ln-mode${mode === "advanced" ? " ln-mode-on" : ""}`}
                      onClick={() => setMode("advanced")}
                      aria-pressed={mode === "advanced"}
                    >
                      <span className="ln-mode-name">שתי אותיות</span>
                      <span className="ln-mode-desc">שתיהן בתוך המילה</span>
                    </button>
                  </div>
                </div>
              )}

              <button type="button" className="ln-action" disabled={busy !== null} onClick={() => void handleCreate()}>
                {busy === "create" ? "פותחים חדר…" : "פתחו חדר"}
              </button>
            </>
          ) : (
            <>
              <div className="ln-field">
                <label htmlFor="ln-join-code">קוד החדר</label>
                <input
                  id="ln-join-code"
                  className="ln-input ln-input-code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  maxLength={8}
                  autoCapitalize="characters"
                  inputMode="text"
                />
              </div>
              <div className="ln-field">
                <label htmlFor="ln-join-nick">השם שלך</label>
                <input
                  id="ln-join-nick"
                  className="ln-input"
                  value={joinNickname}
                  onChange={(e) => setJoinNick(e.target.value)}
                  placeholder="מי נכנס?"
                  maxLength={20}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleJoin(); }}
                />
              </div>

              {gameType === "family" && (
                <SharedDeviceField
                  checked={sharedDevice}
                  onToggle={setShared}
                  partner={partnerName}
                  onPartner={setPartner}
                />
              )}

              <button type="button" className="ln-action" disabled={busy !== null} onClick={() => void handleJoin()}>
                {busy === "join" ? "מצטרפים…" : "הצטרפו לחדר"}
              </button>
            </>
          )}

          {message && <p className="ln-message" role="alert">{message}</p>}
        </section>

        {/* ── Come back to a room ─────────────────────────────────── */}
        {sessions.length > 0 && (
          <section className="ln-block">
            <h2 className="ln-block-title">חדרים שהיית בהם</h2>
            <div className="ln-recent">
              {sessions.slice(0, 6).map((s) => {
                const g2 = GAMES.find((g) => g.id === s.gameType);
                return (
                  <a key={s.roomCode} href={hrefFor(s)} className="ln-recent-pill">
                    <span aria-hidden>{g2?.emoji ?? "🗺️"}</span>
                    <span className="ln-recent-code">{s.roomCode}</span>
                  </a>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
// Same design language as "מי מהמשפחה?": a deep aubergine room, white paper for
// anything you read or touch, and one accent that follows the chosen game.

function Styles() {
  return (
    <style>{`
      .ln-app {
        --ink-deep: #170920;
        --paper:    #FFFDF7;
        --text:     #1B0B26;
        --muted:    #6E5C7A;
        --line:     #E8DFE4;

        min-height: 100dvh;
        /* Plain fallback first: older phones drop the color-mix line entirely,
           and without this the page would render with no background at all. */
        background: var(--ink-deep);
        background:
          radial-gradient(ellipse 90% 45% at 50% 0%, color-mix(in srgb, var(--accent) 28%, #3A1A4F) 0%, transparent 62%),
          var(--ink-deep);
        color: var(--paper);
        direction: rtl;
        font-family: var(--font-heebo), system-ui, -apple-system, "Segoe UI", sans-serif;
        display: flex;
        justify-content: center;
        -webkit-tap-highlight-color: transparent;
        transition: background 500ms ease;
      }

      .ln-frame {
        width: 100%;
        max-width: 540px;
        display: flex;
        flex-direction: column;
        gap: 22px;
        padding: max(24px, env(safe-area-inset-top)) 16px calc(32px + env(safe-area-inset-bottom));
      }

      /* ── Head ─────────────────────────────────────────────────────── */
      .ln-head { text-align: center; display: flex; flex-direction: column; gap: 6px; }
      .ln-wordmark {
        margin: 0; font-size: 34px; font-weight: 900;
        letter-spacing: -0.03em; line-height: 1.1;
      }
      .ln-sub { margin: 0; font-size: 17px; color: #A98FBA; }

      /* ── Blocks ───────────────────────────────────────────────────── */
      .ln-block { display: flex; flex-direction: column; gap: 10px; }
      .ln-block-title {
        margin: 0; font-size: 15px; font-weight: 700;
        letter-spacing: 0.08em; color: #C9A9DC;
      }

      /* ── Game picker ──────────────────────────────────────────────── */
      .ln-games { display: flex; flex-direction: column; gap: 8px; }
      .ln-game {
        position: relative; overflow: hidden;
        display: flex; align-items: center; gap: 14px;
        width: 100%; min-height: 72px; padding: 12px 18px 12px 16px;
        border-radius: 18px; border: 2px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.05); color: var(--paper);
        font-family: inherit; text-align: start; cursor: pointer;
        transition: transform 0.12s, background 0.2s, border-color 0.2s;
      }
      .ln-game:active { transform: scale(0.99); }
      .ln-game-edge {
        position: absolute; inset-inline-start: 0; inset-block: 0;
        width: 5px; opacity: 0.5;
      }
      .ln-game-on .ln-game-edge { opacity: 1; width: 7px; }
      .ln-game-emoji { font-size: 30px; line-height: 1; flex-shrink: 0; }
      .ln-game-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .ln-game-name { font-size: 21px; font-weight: 800; }
      .ln-game-desc { font-size: 15px; color: #A98FBA; }
      .ln-game-on .ln-game-desc { color: #D6C3E2; }

      /* ── The paper form ───────────────────────────────────────────── */
      .ln-note {
        position: relative; overflow: hidden;
        background: var(--paper); color: var(--text);
        border-radius: 22px; padding: 24px 20px 22px;
        box-shadow: 0 20px 44px -20px rgba(0,0,0,0.8);
        display: flex; flex-direction: column; gap: 16px;
      }
      .ln-note-edge {
        position: absolute; inset-block-start: 0; inset-inline: 0; height: 6px;
        transition: background 400ms ease;
      }

      .ln-tabs {
        display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
        background: #F1EAE4; border-radius: 14px; padding: 5px;
      }
      .ln-tab {
        min-height: 52px; border: none; border-radius: 10px;
        background: transparent; color: var(--muted);
        font-family: inherit; font-size: 18px; font-weight: 800; cursor: pointer;
      }
      .ln-tab-on { background: #fff; color: var(--text); box-shadow: 0 2px 6px rgba(0,0,0,0.1); }

      .ln-field { display: flex; flex-direction: column; gap: 8px; }
      .ln-field label { font-size: 17px; font-weight: 700; color: var(--muted); }
      .ln-input {
        width: 100%; box-sizing: border-box; min-height: 64px; padding: 14px 16px;
        border-radius: 16px; border: 2px solid var(--line); background: #fff;
        color: var(--text); font-family: inherit; font-size: 21px; font-weight: 600;
      }
      .ln-input::placeholder { color: #B4A5BE; font-weight: 400; }
      .ln-input:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-color: var(--accent); }
      .ln-input-code {
        text-align: center; letter-spacing: 0.18em;
        font-size: 30px; font-weight: 900;
      }

      .ln-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .ln-mode {
        display: flex; flex-direction: column; gap: 3px;
        min-height: 72px; padding: 12px;
        border-radius: 14px; border: 2px solid var(--line);
        background: #fff; color: var(--text);
        font-family: inherit; text-align: start; cursor: pointer;
      }
      .ln-mode-on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, #fff); }
      .ln-mode-name { font-size: 17px; font-weight: 800; }
      .ln-mode-desc { font-size: 14px; color: var(--muted); line-height: 1.35; }

      .ln-check {
        display: flex; align-items: center; gap: 12px; width: 100%;
        min-height: 64px; padding: 12px 16px;
        border-radius: 16px; border: 2px solid var(--line);
        background: #fff; color: var(--text);
        font-family: inherit; font-size: 18px; font-weight: 700;
        text-align: start; cursor: pointer;
      }
      .ln-check-on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, #fff); }
      .ln-check-box {
        width: 28px; height: 28px; flex-shrink: 0; border-radius: 8px;
        border: 2px solid var(--line);
        display: flex; align-items: center; justify-content: center;
        font-size: 17px; font-weight: 900; color: #fff;
      }
      .ln-check-on .ln-check-box { background: var(--accent); border-color: var(--accent); }

      .ln-action {
        width: 100%; min-height: 68px; padding: 16px;
        border: none; border-radius: 18px;
        background: var(--accent); color: #fff;
        font-family: inherit; font-size: 23px; font-weight: 800; cursor: pointer;
        box-shadow: 0 6px 0 rgba(0,0,0,0.35);
        box-shadow: 0 6px 0 color-mix(in srgb, var(--accent) 65%, #000);
        transition: transform 0.1s, box-shadow 0.1s, background 400ms ease;
      }
      .ln-action:active {
        transform: translateY(4px);
        box-shadow: 0 2px 0 rgba(0,0,0,0.35);
        box-shadow: 0 2px 0 color-mix(in srgb, var(--accent) 65%, #000);
      }
      .ln-action:disabled { background: #B9A8C4; box-shadow: 0 6px 0 #8E7C99; cursor: default; }

      .ln-message {
        margin: 0; padding: 14px 16px; border-radius: 14px;
        background: #FFECE8; color: #A32014;
        font-size: 17px; font-weight: 700; text-align: center;
      }

      /* ── Recent rooms ─────────────────────────────────────────────── */
      .ln-recent { display: flex; flex-wrap: wrap; gap: 8px; }
      .ln-recent-pill {
        display: inline-flex; align-items: center; gap: 8px;
        min-height: 52px; padding: 10px 16px;
        border-radius: 999px; border: 2px solid rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.05);
        color: var(--paper); text-decoration: none;
        font-size: 17px; font-weight: 700;
      }
      .ln-recent-code { letter-spacing: 0.1em; font-variant-numeric: tabular-nums; }

      /* ── Quality floor ────────────────────────────────────────────── */
      .ln-app :focus-visible { outline: 3px solid #FFC53D; outline-offset: 3px; }

      @media (max-width: 360px) {
        .ln-wordmark { font-size: 29px; }
        .ln-game-name { font-size: 19px; }
        .ln-input-code { font-size: 26px; }
      }

      @media (prefers-reduced-motion: reduce) {
        .ln-app *, .ln-app *::before, .ln-app *::after {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      }
    `}</style>
  );
}
