"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "../lib/socket";
import { getPersonalityRoomState } from "../lib/personality-api";
import { readSession } from "../lib/storage";
import type { PersonalitySnapshot, QuestionAnswer } from "@categories-game/shared";

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

interface Props { roomCode: string }

export function PersonalityClient({ roomCode }: Props) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<PersonalitySnapshot | null>(null);
  const [characterInput, setCharacterInput] = useState("");
  const [characterGender, setCharacterGender] = useState<"male" | "female" | null>(null);
  const [questionInput, setQuestionInput] = useState("");
  const [guessInput, setGuessInput] = useState("");
  const [showGuessModal, setShowGuessModal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const socket = getSocket();
  const room = snapshot?.room;
  const me = snapshot?.me;
  const myPlayer = room?.players.find((p) => p.id === me?.playerId);
  const isPicker = myPlayer?.isPicker ?? false;
  const isHost = myPlayer?.isHost ?? false;
  const isEliminated = myPlayer?.isEliminated ?? false;
  const guessesLeft = myPlayer?.guessesLeft ?? 3;
  const unansweredCount = room?.questions.filter((q) => q.answer === null).length ?? 0;

  useEffect(() => {
    const session = readSession(roomCode);
    if (!session) { router.push("/"); return; }

    void getPersonalityRoomState(roomCode, session.playerId)
      .then(setSnapshot)
      .catch(() => router.push("/"));

    if (!socket.connected) socket.connect();

    socket.on("personality_state", (snap: PersonalitySnapshot) => { setSnapshot(snap); });
    socket.on("error_message", ({ message: msg }: { message: string }) => {
      setMessage(msg);
      setTimeout(() => setMessage(null), 4000);
    });

    socket.emit("p_join_room", { roomCode: roomCode.toUpperCase(), sessionToken: session.sessionToken });

    return () => {
      socket.off("personality_state");
      socket.off("error_message");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [room?.questions.length]);

  function emit(event: string, payload: object) {
    socket.emit(event, { roomCode: roomCode.toUpperCase(), ...payload });
  }

  function submitCharacter() {
    const c = characterInput.trim();
    if (!c) { setMessage("הכנס שם דמות"); return; }
    if (!characterGender) { setMessage("בחר/י מין קודם"); return; }
    emit("p_set_character", { character: c, gender: characterGender });
    setCharacterInput("");
  }

  function submitQuestion() {
    const q = questionInput.trim();
    if (!q) { setMessage("הכנס שאלה"); return; }
    emit("p_ask_question", { question: q });
    setQuestionInput("");
  }

  function answerQuestion(questionId: string, answer: QuestionAnswer) {
    emit("p_answer_question", { questionId, answer });
  }

  function submitGuess() {
    const g = guessInput.trim();
    if (!g) { setMessage("הכנס ניחוש"); return; }
    emit("p_make_guess", { guess: g });
    setGuessInput("");
    setShowGuessModal(false);
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  if (!snapshot || !room) {
    return (
      <div className="p-loading-screen">
        <div className="p-loading-glow" />
        <div className="p-loading-inner">
          <div className="p-loading-icon">🎭</div>
          <div className="p-loading-spinner-ring" />
          <p className="p-loading-text">טוען חדר...</p>
          <div className="p-waiting-dots" style={{ marginTop: 0 }}>
            <span /><span /><span />
          </div>
        </div>
      </div>
    );
  }

  const { phase } = room;
  const picker = room.players.find((p) => p.isPicker);
  const guessers = room.players.filter((p) => !p.isPicker);

  // ── Lobby ────────────────────────────────────────────────────────────────

  if (phase === "lobby") {
    return (
      <div className="room-layout" style={{ "--game-color": "rgba(168,85,247,0.2)" } as React.CSSProperties}>
        <header className="room-header">
          <div className="room-header-inner">
            <button className="back-btn" onClick={() => router.push("/")}>← חזרה</button>
            <span className="room-phase-badge" style={{ color: "#c084fc", borderColor: "rgba(168,85,247,0.3)", background: "rgba(168,85,247,0.08)" }}>
              🎭 אישיות — לובי
            </span>
          </div>
        </header>

        <div className="room-main">
          <div className="p-lobby-wrap">

            <div className="p-invite-card">
              <div className="p-invite-label">🔗 הזמן חברים לחדר</div>
              <div className="p-invite-code-row">
                <span className="p-invite-code">{roomCode}</span>
                <div className="p-invite-actions">
                  <button className="p-invite-btn" onClick={() => void navigator.clipboard.writeText(roomCode)}>
                    📋 העתק קוד
                  </button>
                  <button className="p-invite-btn"
                    onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/personality/${roomCode}`)}>
                    🔗 שתף קישור
                  </button>
                </div>
              </div>
            </div>

            <div className="p-players-card">
              <div className="p-players-header">
                <span className="p-players-title">שחקנים</span>
                <span className="p-players-count">{room.players.length} מחוברים</span>
              </div>

              {room.players.map((p, i) => (
                <div key={p.id} className={`p-player-row${p.isPicker ? " p-player-row-picker" : ""}`}>
                  <Avatar nickname={p.nickname} index={i} />
                  <span className="p-player-name">{p.nickname}</span>
                  <div className="p-player-badges">
                    {p.isPicker && <span className="p-badge p-badge-picker">🎭 מנחה</span>}
                    {p.isHost && <span className="p-badge p-badge-host">👑 מארח</span>}
                    {!p.isOnline && <span className="p-badge p-badge-offline">⚫ אופליין</span>}
                    {isHost && !p.isPicker && (
                      <button className="p-set-picker-btn" onClick={() => emit("p_set_picker", { pickerId: p.id })}>
                        הפוך למנחה
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <div className="p-start-section">
                {isHost ? (
                  <button className="p-start-btn" disabled={room.players.length < 2}
                    onClick={() => emit("p_start_room", {})}>
                    {room.players.length < 2 ? "⏳ ממתין לשחקן נוסף..." : "התחל משחק 🎭"}
                  </button>
                ) : (
                  <p className="p-wait-text">⏳ ממתין שהמארח יתחיל את המשחק...</p>
                )}
              </div>
            </div>

            <div className="p-rules-card">
              <div className="p-rules-title">איך משחקים?</div>
              <ul className="p-rules-list">
                {[
                  "המנחה בוחר דמות בסתר — אדם אמיתי, מפורסם, שכן, כל אחד",
                  "המנחשים שואלים שאלות עם תשובת כן / לא / לא יודע",
                  <>לכל מנחש יש <strong style={{ color: "#c084fc" }}>3 ניחושי שם בלבד</strong> — שימו לב!</>,
                  "ניחוש נכון = ניצחון. כולם נפסלים = המנחה ניצח",
                ].map((rule, i) => (
                  <li key={i} className="p-rule-item">
                    <span className="p-rule-num">{i + 1}</span>
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

  // ── Character Selection ──────────────────────────────────────────────────

  if (phase === "character_selection") {
    if (isPicker) {
      return (
        <div className="room-layout" style={{ "--game-color": "rgba(168,85,247,0.2)" } as React.CSSProperties}>
          <div className="p-centered-screen">
            <div className="p-char-card">
              <div className="p-char-card-glow" />

              {/* Step 1: pick gender */}
              {characterGender === null ? (
                <>
                  <div className="p-char-step-badge">שלב 1 מתוך 2</div>
                  <h2 className="p-char-title">מה מין הדמות?</h2>
                  <p className="p-char-desc">המנחשים יראו דמות של בן או בת — זה הרמז הראשון שלהם!</p>
                  <div className="p-gender-row">
                    <button className="p-gender-btn p-gender-male" onClick={() => setCharacterGender("male")}>
                      <span className="p-gender-icon">👨</span>
                      <span className="p-gender-label">בן / גבר</span>
                    </button>
                    <button className="p-gender-btn p-gender-female" onClick={() => setCharacterGender("female")}>
                      <span className="p-gender-icon">👩</span>
                      <span className="p-gender-label">בת / אישה</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-char-step-badge">שלב 2 מתוך 2</div>
                  <div className="p-char-gender-chosen">
                    <span className="p-char-gender-icon">{characterGender === "male" ? "👨" : "👩"}</span>
                    <span className="p-char-gender-text">{characterGender === "male" ? "גבר / בן" : "אישה / בת"}</span>
                    <button className="p-char-gender-change" onClick={() => setCharacterGender(null)}>שנה</button>
                  </div>
                  <h2 className="p-char-title">מי הדמות הנסתרת?</h2>
                  <p className="p-char-desc">
                    חשוב/י על דמות — מפורסם, שכן, דמות מסרט...<br />
                    רק אתה/את תדע/י, האחרים ינסו לנחש!
                  </p>
                  <div className="field" style={{ marginBottom: 14 }}>
                    <input className="input p-char-input"
                      placeholder="שם הדמות..."
                      value={characterInput}
                      onChange={(e) => setCharacterInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitCharacter(); }}
                      autoFocus
                    />
                  </div>
                  <button className="p-start-btn" onClick={submitCharacter} disabled={!characterInput.trim()}>
                    התחל משחק ›
                  </button>
                  {message && <p style={{ color: "#f87171", marginTop: 12, fontSize: 14, textAlign: "center" }}>{message}</p>}
                </>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Guesser waiting screen — show gender silhouette if known
    const knownGender = room.characterGender;
    return (
      <div className="room-layout" style={{ "--game-color": "rgba(168,85,247,0.2)" } as React.CSSProperties}>
        <div className="p-centered-screen">
          <div className="p-waiting-card">
            <div className="p-waiting-silhouette">
              {knownGender === "male"
                ? <><span className="p-sil-icon">👨</span><span className="p-sil-qmark">?</span></>
                : knownGender === "female"
                ? <><span className="p-sil-icon">👩</span><span className="p-sil-qmark">?</span></>
                : <span className="p-sil-icon p-sil-unknown">❓</span>
              }
            </div>
            {knownGender && (
              <div className="p-waiting-gender-hint">
                {knownGender === "male" ? "🧔 הדמות היא גבר" : "👩 הדמות היא אישה"}
              </div>
            )}
            <h2 className="p-waiting-title">ממתין לדמות</h2>
            <p className="p-waiting-sub">
              <strong style={{ color: "#c084fc" }}>{picker?.nickname}</strong> בוחר/ת את הדמות הנסתרת...
            </p>
            <div className="p-waiting-dots">
              <span /><span /><span />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Questioning ──────────────────────────────────────────────────────────

  if (phase === "questioning") {
    return (
      <div className="room-layout" style={{ "--game-color": "rgba(168,85,247,0.2)" } as React.CSSProperties}>
        {/* Header */}
        <header className="room-header">
          <div className="room-header-inner">
            <span className="p-role-badge">
              {isPicker ? "🎭 מנחה" : "🕵️ מנחש"}
            </span>
            <div className="p-lives-strip">
              {guessers.map((p, i) => (
                <div key={p.id} title={`${p.nickname} — ${p.isEliminated ? "נפסל" : `${p.guessesLeft} ניחושים`}`}
                  className={`p-life-player${p.isEliminated ? " p-life-player-out" : ""}`}>
                  <Avatar nickname={p.nickname} index={i} size={24} />
                  <span className="p-life-pips">
                    {p.isEliminated
                      ? <span style={{ color: "#f87171", fontSize: 13 }}>✕</span>
                      : Array.from({ length: 3 }, (_, j) => (
                          <span key={j} className={`p-life-pip${j < p.guessesLeft ? " p-life-pip-on" : ""}`} />
                        ))
                    }
                  </span>
                </div>
              ))}
            </div>
          </div>
        </header>

        <div className="room-main">
          {/* Picker: styled character reminder */}
          {isPicker && room.character && (
            <div className="p-picker-banner">
              <div className="p-picker-banner-inner">
                <div className="p-picker-banner-left">
                  <span className="p-picker-banner-icon">
                    {room.characterGender === "male" ? "👨" : room.characterGender === "female" ? "👩" : "🎭"}
                  </span>
                  <div>
                    <div className="p-picker-banner-label">הדמות שבחרת</div>
                    <div className="p-picker-banner-name">{room.character}</div>
                  </div>
                </div>
                <div className="p-picker-banner-right">
                  <span className="p-picker-lock">🔐</span>
                  <span className="p-picker-secret-text">רק אתה רואה</span>
                </div>
              </div>
              {unansweredCount > 0 && (
                <div className="p-picker-alert">
                  ✋ {unansweredCount} שאלה{unansweredCount > 1 ? "ות" : ""} ממתינה לתשובה שלך
                </div>
              )}
            </div>
          )}

          {/* Gender hint for guessers */}
          {!isPicker && room.characterGender && (
            <div className="p-gender-hint-bar">
              <span>{room.characterGender === "male" ? "👨 הדמות היא גבר" : "👩 הדמות היא אישה"}</span>
            </div>
          )}

          {/* Q&A chat */}
          <div className="p-chat-card">
            <div className="p-chat-header">
              <span className="p-chat-title">שאלות ותשובות</span>
              <span className="p-chat-count">{room.questions.length}</span>
            </div>

            <div ref={chatRef} className="p-chat-list">
              {room.questions.length === 0 && (
                <div className="p-chat-empty">
                  {isPicker ? "⏳ ממתין לשאלה הראשונה..." : "💬 שאל/י שאלה כדי להתחיל!"}
                </div>
              )}

              {room.questions.map((q) => {
                const gIdx = guessers.findIndex((g) => g.id === q.askerId);
                const answered = q.answer !== null;
                return (
                  <div key={q.id} className={`p-chat-row${answered ? " p-chat-row-answered" : ""}`}>
                    <div className="p-chat-left">
                      <Avatar nickname={q.askerNickname} index={gIdx >= 0 ? gIdx : 0} size={28} />
                      <div className="p-chat-body">
                        <span className="p-chat-who">{q.askerNickname}</span>
                        <span className="p-chat-q">{q.question}</span>
                      </div>
                    </div>

                    <div className="p-chat-right">
                      {q.answer === null ? (
                        isPicker ? (
                          <div className="p-answer-btns">
                            <button className="p-ans-btn p-ans-yes" onClick={() => answerQuestion(q.id, "yes")}>כן</button>
                            <button className="p-ans-btn p-ans-no"  onClick={() => answerQuestion(q.id, "no")}>לא</button>
                            <button className="p-ans-btn p-ans-maybe" onClick={() => answerQuestion(q.id, "maybe")}>לא יודע</button>
                          </div>
                        ) : (
                          <span className="p-pending-dot">⏳</span>
                        )
                      ) : (
                        <span className={`p-answer-pill p-answer-${q.answer}`}>
                          {q.answer === "yes" ? "✅ כן" : q.answer === "no" ? "❌ לא" : "🤷 לא יודע"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Guesser controls */}
          {!isPicker && !isEliminated && (
            <div className="p-guesser-bar">
              <div className="p-question-row">
                <input className="input p-question-input"
                  placeholder="שאל שאלה (תשובה: כן / לא)..."
                  value={questionInput}
                  onChange={(e) => setQuestionInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitQuestion(); }}
                />
                <button className="p-send-btn" onClick={submitQuestion} disabled={!questionInput.trim()}>
                  שאל
                </button>
              </div>
              <button className="p-guess-btn" onClick={() => setShowGuessModal(true)}>
                <span className="p-guess-icon">💡</span>
                <span className="p-guess-text">ניחוש שם</span>
                <span className="p-guess-lives">
                  {Array.from({ length: 3 }, (_, j) => (
                    <span key={j} className={`p-life-pip${j < guessesLeft ? " p-life-pip-on" : ""}`} />
                  ))}
                </span>
              </button>
            </div>
          )}

          {!isPicker && isEliminated && (
            <div className="p-eliminated-bar">
              <span>❌ נפסלת — השתמשת בכל הניחושים שלך</span>
              <span className="p-eliminated-sub">אפשר להמשיך לצפות</span>
            </div>
          )}

          {message && <div className="message-banner">{message}</div>}
        </div>

        {/* Guess Modal */}
        {showGuessModal && (
          <div className="p-modal-overlay">
            <div className="p-modal-card">
              <div className="p-modal-header">
                <span className="p-modal-emoji">💡</span>
                <h3 className="p-modal-title">ניחוש שם</h3>
              </div>
              {room.characterGender && (
                <div className="p-modal-hint">
                  {room.characterGender === "male" ? "👨 הדמות היא גבר" : "👩 הדמות היא אישה"}
                </div>
              )}
              <p className="p-modal-desc">
                נותרו לך{" "}
                <strong style={{ color: "#c084fc" }}>{guessesLeft}</strong>{" "}
                ניחוש{guessesLeft !== 1 ? "ים" : ""}. מה שם הדמות?
              </p>
              <div className="field">
                <input className="input" placeholder="שם הדמות..."
                  value={guessInput}
                  onChange={(e) => setGuessInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitGuess(); }}
                  autoFocus
                />
              </div>
              {message && <p style={{ color: "#f87171", fontSize: 13, marginBottom: 8 }}>{message}</p>}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="p-start-btn" style={{ flex: 1, padding: "11px" }} onClick={submitGuess}>
                  ניחש ›
                </button>
                <button className="p-cancel-btn" onClick={() => { setShowGuessModal(false); setGuessInput(""); }}>
                  ביטול
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Game Over ────────────────────────────────────────────────────────────

  if (phase === "game_over") {
    return (
      <div className="room-layout" style={{ "--game-color": "rgba(168,85,247,0.2)" } as React.CSSProperties}>
        <div className="room-main">

          {/* Winner banner */}
          <div className="p-result-card">
            <div className="p-result-emoji">{room.pickerWon ? "🏆" : "🎉"}</div>
            <h2 className="p-result-title">
              {room.pickerWon ? `${picker?.nickname ?? "המנחה"} ניצח/ה!` : `${room.winnerNickname} ניחש/ה נכון!`}
            </h2>
            {room.pickerWon && (
              <p className="p-result-sub">כל המנחשים נפסלו — הדמות נשמרה בסוד</p>
            )}
            <div className="p-reveal-box">
              <span className="p-reveal-label">הדמות הנסתרת הייתה</span>
              <div className="p-reveal-inner">
                {room.characterGender && (
                  <span className="p-reveal-gender">{room.characterGender === "male" ? "👨" : "👩"}</span>
                )}
                <span className="p-reveal-name">{room.character}</span>
              </div>
            </div>
          </div>

          {/* Guesses */}
          {room.guesses.length > 0 && (
            <div className="p-section-card">
              <div className="p-section-header">ניחושים שנעשו</div>
              <div className="p-section-list">
                {room.guesses.map((g, i) => {
                  const gIdx = guessers.findIndex((p) => p.id === g.guesserId);
                  return (
                    <div key={g.id} className={`p-guess-row${g.correct ? " p-guess-row-correct" : ""}`}>
                      <Avatar nickname={g.guesserNickname} index={gIdx >= 0 ? gIdx : i} size={26} />
                      <span className="p-guess-row-name">{g.guesserNickname}:</span>
                      <span className="p-guess-row-val">{g.guess}</span>
                      <span className="p-guess-row-icon">{g.correct ? "✅" : "❌"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Q&A recap */}
          {room.questions.length > 0 && (
            <div className="p-section-card">
              <div className="p-section-header">
                שאלות ותשובות
                <span className="p-section-badge">{room.questions.length}</span>
              </div>
              <div className="p-section-list p-qa-recap" style={{ maxHeight: 280, overflowY: "auto" }}>
                {room.questions.map((q) => (
                  <div key={q.id} className="p-qa-row">
                    <span className="p-qa-who">{q.askerNickname}:</span>
                    <span className="p-qa-q">{q.question}</span>
                    <span className={`p-qa-a p-qa-a-${q.answer ?? "none"}`}>
                      {q.answer === "yes" ? "✅ כן" : q.answer === "no" ? "❌ לא" : q.answer === "maybe" ? "🤷" : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isHost ? (
            <button className="p-start-btn" style={{ marginTop: 4 }} onClick={() => emit("p_reset_room", {})}>
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
