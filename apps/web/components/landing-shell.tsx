"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom, joinRoom } from "../lib/api";
import { listSessions, saveSession, type StoredSession } from "../lib/storage";

// Deterministic tiles — computed at module level to avoid SSR/hydration mismatch
const LETTERS = ["א","ב","ג","ד","ה","ו","ז","ח","ט","י","כ","ל","מ","נ","ס","ע","פ","צ","ק","ר","ש","ת"];
const TILES = Array.from({ length: 24 }, (_, i) => ({
  letter: LETTERS[i % LETTERS.length],
  x:    (i * 41 + 7)  % 96,
  del:  (i * 0.55)    % 9,
  dur:  16 + (i * 1.9) % 14,
  size: 18 + (i * 13)  % 44,
  op:   0.008 + (i % 7) * 0.003,
  rot:  (i % 2 === 0 ? 1 : -1) * (4 + (i * 3) % 14),
}));

const FEATURES = [
  { icon: "⚡", label: "בזמן אמת" },
  { icon: "🤖", label: "AI Validation" },
  { icon: "👥", label: "עד 8 שחקנים" },
  { icon: "📱", label: "Mobile Friendly" },
];

const STEPS = [
  { n: 1, icon: "🎯", title: "מקבלים אות", desc: "כולם מקבלים את אותה אות בו-זמנית לאותו סיבוב" },
  { n: 2, icon: "✍️", title: "ממלאים תשובות", desc: "כל שחקן ממלא תשובה לכל קטגוריה לפי האות" },
  { n: 3, icon: "🏆", title: "AI שופט", desc: "בינה מלאכותית בודקת כל תשובה ומחלקת ניקוד חכם" },
];

function validateNickname(name: string): string | null {
  const t = name.trim();
  if (!t) return "הכנס שם שחקן";
  if (t.length < 2) return "שם קצר מדי — לפחות 2 תווים";
  if (t.length > 20) return "שם ארוך מדי — עד 20 תווים";
  return null;
}

export function LandingShell() {
  const router = useRouter();
  const [tab, setTab]                   = useState<"create" | "join">("create");
  const [createNickname, setCreateNick] = useState("");
  const [joinNickname,   setJoinNick]   = useState("");
  const [joinCode,       setJoinCode]   = useState("");
  const [mode, setMode]                 = useState<"classic" | "advanced">("classic");
  const [message, setMessage]           = useState<string | null>(null);
  const [busy, setBusy]                 = useState<"create" | "join" | null>(null);
  const [sessions, setSessions]         = useState<StoredSession[]>([]);
  const [showSessions, setShowSessions] = useState(false);

  useEffect(() => { setSessions(listSessions()); }, []);

  async function handleCreate() {
    const err = validateNickname(createNickname);
    if (err) { setMessage(err); return; }
    try {
      setBusy("create"); setMessage(null);
      const r = await createRoom({ nickname: createNickname.trim(), settings: { mode } });
      saveSession({ roomCode: r.room.room.code, playerId: r.playerId, sessionToken: r.sessionToken });
      router.push(`/rooms/${r.room.room.code}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "לא ניתן ליצור חדר כרגע"); }
    finally { setBusy(null); }
  }

  async function handleJoin() {
    const err = validateNickname(joinNickname);
    if (err) { setMessage(err); return; }
    if (!joinCode.trim()) { setMessage("הכנס קוד חדר"); return; }
    try {
      setBusy("join"); setMessage(null);
      const code = joinCode.toUpperCase().trim();
      const r = await joinRoom(code, { nickname: joinNickname.trim() });
      saveSession({ roomCode: code, playerId: r.playerId, sessionToken: r.sessionToken });
      router.push(`/rooms/${code}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "לא ניתן להצטרף לחדר כרגע"); }
    finally { setBusy(null); }
  }

  return (
    <div className="landing-page">

      {/* ── Floating Hebrew letters background ── */}
      <div className="hero-letters" aria-hidden>
        {TILES.map((t, i) => (
          <span key={i} className="hero-letter" style={{
            left: `${t.x}%`,
            animationDuration: `${t.dur}s`,
            animationDelay: `-${t.del}s`,
            fontSize: `${t.size}px`,
            opacity: t.op,
            "--rot": `${t.rot}deg`,
          } as React.CSSProperties}>
            {t.letter}
          </span>
        ))}
      </div>

      <div className="landing-content">

        {/* ════ HERO ════ */}
        <section className="hero-section">
          <div className="hero-logo-wrap">
            <span className="hero-logo" aria-hidden>🗺️</span>
            <div className="hero-logo-glow" aria-hidden />
          </div>

          <h1 className="hero-title">ארץ עיר</h1>
          <p className="hero-tagline">משחק קטגוריות מולטיפלייר • בזמן אמת</p>

          <div className="hero-features">
            {FEATURES.map((f) => (
              <span key={f.label} className="hero-feature-pill">
                <span aria-hidden>{f.icon}</span>
                <span>{f.label}</span>
              </span>
            ))}
          </div>

          {/* Live demo widget */}
          <div className="hero-demo" aria-label="דוגמה למשחק">
            <div className="hero-demo-letter-wrap">
              <span className="hero-demo-letter-label">אות הסיבוב</span>
              <span className="hero-demo-letter">כ</span>
            </div>
            <div className="hero-demo-divider" />
            <div className="hero-demo-rows">
              <div className="hero-demo-row">
                <span className="hero-demo-cat">ארץ</span>
                <span className="hero-demo-ans">כנען</span>
                <span className="hero-demo-badge hero-demo-badge-unique">⭐ 15</span>
              </div>
              <div className="hero-demo-row">
                <span className="hero-demo-cat">עיר</span>
                <span className="hero-demo-ans">כפר סבא</span>
                <span className="hero-demo-badge hero-demo-badge-valid">✓ 10</span>
              </div>
              <div className="hero-demo-row">
                <span className="hero-demo-cat">חיה</span>
                <span className="hero-demo-ans">כלב</span>
                <span className="hero-demo-badge hero-demo-badge-unique">⭐ 15</span>
              </div>
            </div>
          </div>
        </section>

        {/* ════ HOW TO PLAY ════ */}
        <section className="how-section" aria-labelledby="how-title">
          <p id="how-title" className="how-eyebrow">איך משחקים?</p>
          <div className="how-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="how-step">
                <span className="how-step-num">{s.n}</span>
                <span className="how-step-icon" aria-hidden>{s.icon}</span>
                <strong className="how-step-title">{s.title}</strong>
                <p className="how-step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ════ REJOIN ════ */}
        {sessions.length > 0 ? (
          <div style={{ width: "100%", maxWidth: 440 }}>
            <button
              type="button"
              className="sessions-toggle"
              onClick={() => setShowSessions((v) => !v)}
            >
              <span className={`sessions-toggle-arrow${showSessions ? " sessions-toggle-arrow-open" : ""}`}>›</span>
              חדרים שהיית בהם ({sessions.length})
            </button>
            {showSessions ? (
              <div className="existing-rooms" style={{ marginTop: 10 }}>
                <div className="existing-rooms-list">
                  {sessions.map((s) => (
                    <a key={s.roomCode} href={`/rooms/${s.roomCode}`} className="existing-room-btn">
                      <span className="existing-room-code">{s.roomCode}</span>
                      <span className="existing-room-cta">המשך ›</span>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ════ PLAY CARD ════ */}
        <div className="landing-form-wrap">
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
                  <label htmlFor="createNick">השם שלך במשחק</label>
                  <input
                    id="createNick"
                    className="input"
                    value={createNickname}
                    onChange={(e) => setCreateNick(e.target.value)}
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
                <button className="button button-full" disabled={busy !== null} onClick={() => void handleCreate()} type="button">
                  {busy === "create" ? "יוצר חדר..." : "צור חדר ›"}
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
                  <label htmlFor="joinNick">השם שלך במשחק</label>
                  <input
                    id="joinNick"
                    className="input"
                    value={joinNickname}
                    onChange={(e) => setJoinNick(e.target.value)}
                    placeholder="מי נכנס?"
                    maxLength={20}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleJoin(); }}
                  />
                </div>
                <button className="button-secondary button-full" disabled={busy !== null} onClick={() => void handleJoin()} type="button">
                  {busy === "join" ? "מצטרף..." : "הצטרף לחדר ›"}
                </button>
              </div>
            )}

            {message ? <div className="message-banner">{message}</div> : null}
          </div>
        </div>

        <footer className="landing-footer">
          ארץ עיר אונליין • משחק קטגוריות עם AI • {new Date().getFullYear()}
        </footer>

      </div>
    </div>
  );
}
