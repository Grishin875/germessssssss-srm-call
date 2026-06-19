"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { toast } from "../../components/ui/Toast";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import { api, ChatChannel, ChatMessage, User } from "../../lib/api";

function initials(name?: string) {
  return (name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}
function fmtTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru", { day: "numeric", month: "long" });
}
const KIND_ICON: Record<string, string> = { group: "#", direct: "@", order: "№" };

export default function ChatPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  const [groupModal, setGroupModal] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<Set<number>>(new Set());
  const [dmModal, setDmModal] = useState(false);

  const lastIdRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);

  const loadChannels = useCallback(async () => {
    try {
      const list = await api.getChatChannels();
      setChannels(list);
      setActiveId(prev => prev ?? (list[0]?.id ?? null));
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadChannels();
    api.getUsers().then(u => setUsers(u.filter(x => x.is_active !== false && x.id !== user.id))).catch(() => {});
    // Открыть канал заказа / конкретный канал из query (?order=ID или ?channel=ID)
    const sp = new URLSearchParams(window.location.search);
    const orderId = sp.get("order");
    const channelId = sp.get("channel");
    if (orderId) {
      api.openOrderChat(Number(orderId)).then(ch => { setActiveId(ch.id); loadChannels(); }).catch(() => {});
    } else if (channelId) {
      setActiveId(Number(channelId));
    }
  }, [user, loadChannels]);

  // Опрос списка каналов (непрочитанные)
  useAutoRefresh(() => { loadChannels(); }, 10000, !!user && !groupModal && !dmModal);

  const active = channels.find(c => c.id === activeId) || null;

  // Загрузка сообщений выбранного канала + пометка прочитанным
  const loadMessages = useCallback(async (channelId: number, initial: boolean) => {
    try {
      if (initial) {
        const msgs = await api.getChatMessages(channelId, { limit: 80 });
        setMessages(msgs);
        lastIdRef.current = msgs.length ? msgs[msgs.length - 1].id : 0;
      } else {
        const fresh = await api.getChatMessages(channelId, { after_id: lastIdRef.current, limit: 100 });
        if (fresh.length) {
          setMessages(prev => [...prev, ...fresh]);
          lastIdRef.current = fresh[fresh.length - 1].id;
        }
      }
      if (lastIdRef.current) {
        await api.markChatRead(channelId, lastIdRef.current).catch(() => {});
      }
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    lastIdRef.current = 0;
    loadMessages(activeId, true);
  }, [activeId, loadMessages]);

  // Опрос новых сообщений активного канала
  useEffect(() => {
    if (!activeId) return;
    const t = setInterval(() => loadMessages(activeId, false), 3500);
    return () => clearInterval(t);
  }, [activeId, loadMessages]);

  // Автоскролл вниз при новых сообщениях
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  async function send() {
    const t = text.trim();
    if (!t || !activeId) return;
    setSending(true);
    try {
      const msg = await api.sendChatMessage(activeId, t);
      setMessages(prev => [...prev, msg]);
      lastIdRef.current = msg.id;
      setText("");
      loadChannels();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось отправить"); }
    setSending(false);
  }

  async function createGroup() {
    const name = groupName.trim();
    if (!name) { toast.warning("Укажите название"); return; }
    try {
      const ch = await api.createChatChannel(name, Array.from(groupMembers));
      setGroupModal(false); setGroupName(""); setGroupMembers(new Set());
      await loadChannels();
      setActiveId(ch.id);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function startDm(uid: number) {
    try {
      const ch = await api.openDirectChat(uid);
      setDmModal(false);
      await loadChannels();
      setActiveId(ch.id);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function removeMessage(id: number) {
    if (!confirm("Удалить сообщение?")) return;
    try {
      await api.deleteChatMessage(id);
      setMessages(prev => prev.map(m => m.id === id ? { ...m, is_deleted: true, text: "" } : m));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  if (loading || !user) return null;

  return (
    <AppLayout>
      <div style={{ display: "flex", gap: 14, height: "calc(100vh - 120px)", minHeight: 480 }}>
        {/* ── Список каналов ─────────────────────────────────────────── */}
        <div className="glass" style={{ width: 290, flexShrink: 0, borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Чат</div>
            <div style={{ display: "flex", gap: 6 }}>
              <Button size="sm" variant="secondary" onClick={() => setDmModal(true)} title="Личная переписка">@</Button>
              <Button size="sm" onClick={() => setGroupModal(true)} title="Новый канал">+</Button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
            {channels.length === 0 && (
              <div style={{ color: "var(--text-secondary)", fontSize: 13, padding: 16, textAlign: "center" }}>Нет каналов</div>
            )}
            {channels.map(ch => {
              const isActive = ch.id === activeId;
              return (
                <button
                  key={ch.id}
                  onClick={() => setActiveId(ch.id)}
                  style={{
                    width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                    padding: "10px 12px", borderRadius: 9, marginBottom: 2,
                    background: isActive ? "var(--primary-light)" : "transparent",
                    display: "flex", gap: 10, alignItems: "center",
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0, color: "#fff", fontWeight: 700, fontSize: 13,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: ch.kind === "order" ? "#d97706" : ch.kind === "direct" ? "#0284c7" : "var(--primary)",
                  }}>{ch.kind === "direct" ? initials(ch.name) : KIND_ICON[ch.kind]}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontWeight: isActive ? 700 : 500, fontSize: 13.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.name || "Без названия"}</span>
                      <span style={{ fontSize: 10.5, color: "var(--text-secondary)", flexShrink: 0 }}>{fmtTime(ch.last_message_at)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ch.last_message ? `${ch.last_message_author ? ch.last_message_author.split(" ")[0] + ": " : ""}${ch.last_message}` : "Нет сообщений"}
                    </div>
                  </div>
                  {ch.unread > 0 && (
                    <span style={{ flexShrink: 0, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 6, background: "var(--primary)", color: "#fff", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{ch.unread}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Лента сообщений ────────────────────────────────────────── */}
        <div className="glass" style={{ flex: 1, borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {!active ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>Выберите канал</div>
          ) : (
            <>
              <div style={{ padding: "13px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{active.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {active.kind === "order" && active.order_id ? <button onClick={() => router.push(`/orders/${active.order_id}`)} style={{ background: "none", border: "none", color: "var(--accent, #6366f1)", cursor: "pointer", padding: 0, fontSize: 12 }}>→ к заказу №{active.order_id}</button> : `${active.member_count} участн.`}
                  </div>
                </div>
              </div>

              <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 2 }}>
                {messages.map((m, i) => {
                  const own = m.user_id === user.id;
                  const prev = messages[i - 1];
                  const showDay = !prev || fmtDay(prev.created_at) !== fmtDay(m.created_at);
                  const grouped = prev && prev.user_id === m.user_id && !showDay;
                  return (
                    <div key={m.id}>
                      {showDay && (
                        <div style={{ textAlign: "center", margin: "12px 0 8px", fontSize: 11, color: "var(--text-secondary)" }}>{fmtDay(m.created_at)}</div>
                      )}
                      <div style={{ display: "flex", flexDirection: own ? "row-reverse" : "row", gap: 9, marginTop: grouped ? 1 : 8, alignItems: "flex-end" }}>
                        <div style={{ width: 30, flexShrink: 0 }}>
                          {!grouped && (
                            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{initials(m.user_name)}</div>
                          )}
                        </div>
                        <div style={{ maxWidth: "70%", display: "flex", flexDirection: "column", alignItems: own ? "flex-end" : "flex-start" }}>
                          {!grouped && !own && <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 2, paddingLeft: 2 }}>{m.user_name}</div>}
                          <div
                            onDoubleClick={() => (own || user.role === "admin" || user.role === "manager") && !m.is_deleted && removeMessage(m.id)}
                            title={fmtTime(m.created_at)}
                            style={{
                              padding: "7px 11px", borderRadius: 13, fontSize: 13.5, lineHeight: 1.4, wordBreak: "break-word", whiteSpace: "pre-wrap",
                              background: m.is_deleted ? "transparent" : own ? "var(--primary)" : "var(--bg-secondary)",
                              boxShadow: m.is_deleted || own ? "none" : "var(--shadow-sm)",
                              color: m.is_deleted ? "var(--text-secondary)" : own ? "#fff" : "var(--text)",
                              fontStyle: m.is_deleted ? "italic" : "normal",
                              border: m.is_deleted ? "1px dashed var(--border)" : "none",
                            }}
                          >
                            {m.is_deleted ? "сообщение удалено" : m.text}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 1, padding: "0 2px" }}>{fmtTime(m.created_at)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 && (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", fontSize: 13 }}>Сообщений пока нет — начните беседу</div>
                )}
                <div ref={bottomRef} />
              </div>

              <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder="Сообщение…  (Enter — отправить, Shift+Enter — перенос)"
                  rows={1}
                  style={{ flex: 1, resize: "none", maxHeight: 120, padding: "9px 12px", borderRadius: 11, border: "1.5px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text)", fontSize: 13.5, fontFamily: "inherit" }}
                />
                <Button onClick={send} loading={sending} disabled={!text.trim()}>Отпр.</Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Модалка: новый групповой канал ─────────────────────────── */}
      <Modal open={groupModal} onClose={() => setGroupModal(false)} title="Новый канал">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Название канала</label>
            <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="напр. Производство" style={{ width: "100%", marginTop: 4, padding: "9px 12px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text)" }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Участники</label>
            <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 6, border: "1px solid var(--border)", borderRadius: 10, padding: 6 }}>
              {users.map(u => (
                <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={groupMembers.has(u.id)} onChange={e => {
                    setGroupMembers(prev => { const n = new Set(prev); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n; });
                  }} />
                  <span style={{ fontSize: 13 }}>{u.full_name || u.username}</span>
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="secondary" onClick={() => setGroupModal(false)}>Отмена</Button>
            <Button onClick={createGroup}>Создать</Button>
          </div>
        </div>
      </Modal>

      {/* ── Модалка: личная переписка ──────────────────────────────── */}
      <Modal open={dmModal} onClose={() => setDmModal(false)} title="Личная переписка">
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {users.map(u => (
            <button key={u.id} onClick={() => startDm(u.id)} style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: "9px 10px", borderRadius: 9, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{initials(u.full_name || u.username)}</div>
              <span style={{ fontSize: 13.5 }}>{u.full_name || u.username}</span>
            </button>
          ))}
        </div>
      </Modal>
    </AppLayout>
  );
}
