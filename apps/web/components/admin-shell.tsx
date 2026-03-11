"use client";

import { useCallback, useEffect, useState } from "react";
import { getClientConfig } from "../lib/config";

// ─── Types ────────────────────────────────────────────────────────
interface AdminPlayer {
  nickname: string;
  isHost: boolean;
  isOnline: boolean;
  score: number;
}

interface AdminRoom {
  code: string;
  phase: string;
  mode: string;
  currentRoundNumber: number;
  roundsCount: number;
  playerCount: number;
  onlineCount: number;
  createdAt: string;
  players: AdminPlayer[];
}

interface AdminStats {
  totalRooms: number;
  activeRooms: number;
  totalPlayers: number;
  onlinePlayers: number;
  generatedAt: string;
  rooms: AdminRoom[];
}

// ─── Helpers ──────────────────────────────────────────────────────
const PHASE_MAP: Record<string, { label: string; tone: "accent" | "success" | "warning" | "danger" | "" }> = {
  lobby:         { label: "Lobby",          tone: "accent"   },
  in_round:      { label: "סיבוב פעיל",     tone: "success"  },
  countdown:     { label: "ספירה לאחור",    tone: "warning"  },
  validating:    { label: "AI בודק",        tone: "warning"  },
  round_results: { label: "תוצאות סיבוב",   tone: "accent"   },
  game_over:     { label: "הסתיים",         tone: ""         },
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("he-IL", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function PhasePill({ phase }: { phase: string }) {
  const info = PHASE_MAP[phase] ?? { label: phase, tone: "" as const };
  return (
    <span className="pill" data-tone={info.tone || undefined}>
      {info.label}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────
export function AdminShell() {
  const [secret, setSecret]     = useState("");
  const [inputVal, setInputVal] = useState("");
  const [stats, setStats]       = useState<AdminStats | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [lastRefresh, setLast]  = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Restore secret from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem("admin_secret");
    if (saved) setSecret(saved);
  }, []);

  const fetchStats = useCallback(async (s: string) => {
    if (!s) return;
    setLoading(true);
    setError(null);
    try {
      const { apiUrl } = getClientConfig();
      const res = await fetch(`${apiUrl}/admin/stats`, {
        headers: { Authorization: `Bearer ${s}` },
        cache: "no-store",
      });
      if (res.status === 401) {
        setError("סיסמה שגויה");
        setSecret("");
        sessionStorage.removeItem("admin_secret");
        return;
      }
      if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
      setStats(await res.json() as AdminStats);
      setLast(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-refresh every 10s
  useEffect(() => {
    if (!secret) return;
    void fetchStats(secret);
    const id = setInterval(() => void fetchStats(secret), 10_000);
    return () => clearInterval(id);
  }, [secret, fetchStats]);

  function handleLogin() {
    if (!inputVal.trim()) return;
    sessionStorage.setItem("admin_secret", inputVal.trim());
    setSecret(inputVal.trim());
  }

  function handleLogout() {
    setSecret("");
    setStats(null);
    sessionStorage.removeItem("admin_secret");
  }

  function toggleRoom(code: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  // ── Login screen ─────────────────────────────────────────────────
  if (!secret) {
    return (
      <div className="admin-login-wrap">
        <div className="panel admin-login-card">
          <div className="admin-login-icon">🔐</div>
          <h1 className="admin-login-title">Admin Dashboard</h1>
          <p className="admin-login-sub">הכנס את מפתח הניהול</p>
          <input
            className="input"
            type="password"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="ADMIN_SECRET"
            onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
            autoFocus
          />
          <button className="button button-full" type="button" onClick={handleLogin}>
            כניסה ›
          </button>
          {error ? <div className="message-banner">{error}</div> : null}
        </div>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────
  return (
    <div className="admin-shell">

      {/* Header */}
      <header className="admin-header">
        <div>
          <h1 className="admin-title">Admin Dashboard</h1>
          {lastRefresh ? (
            <p className="admin-refresh-time">
              {loading ? "מרענן..." : `עדכון: ${lastRefresh.toLocaleTimeString("he-IL")} • מתרענן כל 10ש׳`}
            </p>
          ) : null}
        </div>
        <div className="admin-header-right">
          <button className="button-ghost" type="button" onClick={() => void fetchStats(secret)}>
            רענן עכשיו
          </button>
          <button className="button-ghost" type="button" onClick={handleLogout}>
            יציאה
          </button>
        </div>
      </header>

      {error ? <div className="message-banner" style={{ maxWidth: 600 }}>{error}</div> : null}

      {stats ? (
        <>
          {/* ── Overview cards ── */}
          <div className="admin-overview">
            <div className="admin-stat panel">
              <span className="admin-stat-num">{stats.totalRooms}</span>
              <span className="admin-stat-lbl">סה"כ חדרים</span>
            </div>
            <div className="admin-stat panel">
              <span className="admin-stat-num" style={{ color: "var(--accent-2)" }}>{stats.activeRooms}</span>
              <span className="admin-stat-lbl">חדרים פעילים</span>
            </div>
            <div className="admin-stat panel">
              <span className="admin-stat-num">{stats.totalPlayers}</span>
              <span className="admin-stat-lbl">סה"כ שחקנים</span>
            </div>
            <div className="admin-stat panel">
              <span className="admin-stat-num" style={{ color: "var(--accent)" }}>{stats.onlinePlayers}</span>
              <span className="admin-stat-lbl">מחוברים עכשיו</span>
            </div>
          </div>

          {/* ── Rooms list ── */}
          <section className="panel admin-rooms-panel">
            <h2 className="admin-section-title">
              חדרים
              <span className="admin-section-count">{stats.rooms.length}</span>
            </h2>

            {stats.rooms.length === 0 ? (
              <p className="admin-empty">אין חדרים פתוחים כרגע</p>
            ) : (
              <div className="admin-rooms-list">
                {stats.rooms.map((room) => (
                  <div
                    key={room.code}
                    className={`admin-room${room.phase === "game_over" ? " admin-room-done" : ""}`}
                  >
                    {/* Room summary row */}
                    <button
                      type="button"
                      className="admin-room-summary"
                      onClick={() => toggleRoom(room.code)}
                    >
                      <span className="admin-room-code">{room.code}</span>
                      <PhasePill phase={room.phase} />
                      <span className="admin-room-mode">
                        {room.mode === "classic" ? "🔤 Classic" : "🔀 Advanced"}
                      </span>
                      <span className="admin-room-rounds">
                        סיבוב {room.currentRoundNumber}/{room.roundsCount}
                      </span>
                      <span className="admin-room-players-count">
                        <span className="admin-online-dot" style={{ background: room.onlineCount > 0 ? "var(--accent-2)" : "var(--muted)" }} />
                        {room.onlineCount}/{room.playerCount} מחוברים
                      </span>
                      <span className="admin-room-time">{formatDate(room.createdAt)}</span>
                      <span className="admin-room-chevron">{expanded.has(room.code) ? "▲" : "▼"}</span>
                    </button>

                    {/* Expanded player list */}
                    {expanded.has(room.code) ? (
                      <div className="admin-room-detail">
                        <div className="admin-player-list">
                          {room.players.map((p) => (
                            <div
                              key={p.nickname}
                              className={`admin-player-row${p.isOnline ? " admin-player-online" : " admin-player-offline"}`}
                            >
                              <span className="admin-player-status-dot" />
                              <span className="admin-player-name">
                                {p.isHost ? "👑 " : ""}{p.nickname}
                              </span>
                              <span className="admin-player-score">{p.score} נק'</span>
                              <span className="admin-player-connection">
                                {p.isOnline ? "מחובר" : "מנותק"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <p className="admin-generated">
            נוצר ב-{formatDate(stats.generatedAt)}
          </p>
        </>
      ) : !error ? (
        <div className="admin-empty">טוען...</div>
      ) : null}
    </div>
  );
}
