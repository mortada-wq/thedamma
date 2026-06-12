import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/auth";
import {
  Users, ArrowLeft, Send, UserPlus, UserMinus, Copy, Check, ShieldCheck, Clock,
} from "lucide-react";

type Member = { id: number; email: string; role: string; joinedAt: string };
type GroupDetail = { id: number; name: string; createdBy: number; createdAt: string; members: Member[] };
type ChatMessage = { id: number; content: string; createdAt: string; senderId: number; senderEmail: string };
type InviteResult =
  | { found: false; email: string }
  | { found: true; pending: true; email: string; id: number }
  | { found: true; pending: false; added: true; id: number; email: string; role: string };

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json;
}

function shortEmail(email: string) {
  return email.split("@")[0];
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" }) +
        " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function GroupDetail() {
  const params = useParams<{ id: string }>();
  const groupId = Number(params.id);
  const auth = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const lastIdRef = useRef<number>(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const myId = auth.status === "authenticated" ? auth.user.id : -1;

  // ── Group info ──────────────────────────────────────────────────────────────
  const { data: group, refetch: refetchGroup } = useQuery<GroupDetail>({
    queryKey: ["group", groupId],
    queryFn: () => apiFetch(`/api/groups/${groupId}`),
    enabled: !!groupId && auth.status === "authenticated",
  });

  // ── Initial message load ────────────────────────────────────────────────────
  useEffect(() => {
    if (!groupId || auth.status !== "authenticated") return;
    apiFetch(`/api/groups/${groupId}/messages?limit=80`).then((msgs: ChatMessage[]) => {
      setMessages(msgs);
      if (msgs.length) lastIdRef.current = msgs[msgs.length - 1].id;
    });
  }, [groupId, auth.status]);

  // ── Polling for new messages ────────────────────────────────────────────────
  useQuery({
    queryKey: ["group-poll", groupId],
    queryFn: async () => {
      const after = lastIdRef.current;
      const newMsgs: ChatMessage[] = await apiFetch(
        `/api/groups/${groupId}/messages?after=${after}&limit=50`
      );
      if (newMsgs.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const fresh = newMsgs.filter((m) => !existingIds.has(m.id));
          if (!fresh.length) return prev;
          lastIdRef.current = fresh[fresh.length - 1].id;
          return [...prev, ...fresh];
        });
      }
      return null;
    },
    enabled: !!groupId && auth.status === "authenticated",
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── Send message ────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!text.trim() || sending) return;
    const content = text.trim();
    setText("");
    setSending(true);
    try {
      const msg: ChatMessage = await apiFetch(`/api/groups/${groupId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setMessages((prev) => {
        const exists = prev.find((m) => m.id === msg.id);
        if (exists) return prev;
        lastIdRef.current = msg.id;
        return [...prev, msg];
      });
    } catch (e: any) {
      setText(content);
      toast({ title: "Failed to send", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  // ── Invite ──────────────────────────────────────────────────────────────────
  const handleInvite = async () => {
    if (!inviteEmail.trim() || inviting) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const result: InviteResult = await apiFetch(`/api/groups/${groupId}/invite`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      setInviteResult(result);
      if (result.found && !result.pending) {
        setInviteEmail("");
        refetchGroup();
        toast({ title: "Member added", description: result.email });
      }
    } catch (e: any) {
      toast({ title: "Invite failed", description: e.message, variant: "destructive" });
    } finally {
      setInviting(false);
    }
  };

  // ── Remove member ───────────────────────────────────────────────────────────
  const removeMember = useMutation({
    mutationFn: (userId: number) =>
      apiFetch(`/api/groups/${groupId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => { refetchGroup(); toast({ title: "Member removed" }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ── Registration link ───────────────────────────────────────────────────────
  const regLink = `${window.location.origin}/register`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(regLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isCreator = group?.createdBy === myId;

  if (!group) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-brand-blue/30 border-t-brand-blue animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto h-[calc(100vh-10rem)] flex flex-col gap-0">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-border shrink-0">
        <Link href="/groups">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground rounded-full">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>
        <div className="w-8 h-8 rounded-full bg-brand-blue/15 flex items-center justify-center shrink-0">
          <Users className="w-4 h-4 text-brand-blue" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-foreground truncate">{group.name}</h1>
          <p className="text-xs text-muted-foreground">{group.members.length} members</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 gap-4 min-h-0 pt-4">
        {/* ── Message column ── */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Messages scroll area */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Users className="w-8 h-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No messages yet. Say hello!</p>
              </div>
            ) : (
              messages.map((m) => {
                const isMine = m.senderId === myId;
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col gap-0.5 ${isMine ? "items-end" : "items-start"}`}
                  >
                    {!isMine && (
                      <span className="text-[10px] text-muted-foreground px-1">{shortEmail(m.senderEmail)}</span>
                    )}
                    <div
                      className={`max-w-[72%] rounded-2xl px-3 py-2 text-sm leading-relaxed break-words ${
                        isMine
                          ? "bg-brand-blue text-white rounded-br-sm"
                          : "bg-secondary text-foreground rounded-bl-sm"
                      }`}
                    >
                      {m.content}
                    </div>
                    <span className="text-[10px] text-muted-foreground/60 px-1">{formatTime(m.createdAt)}</span>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input bar */}
          <div className="flex gap-2 pt-3 shrink-0 border-t border-border mt-3">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message..."
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              className="flex-1 rounded-full bg-card border-border"
            />
            <Button
              onClick={handleSend}
              disabled={!text.trim() || sending}
              size="sm"
              className="rounded-full bg-brand-blue hover:bg-brand-blue/90 text-white px-4 gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div className="w-60 shrink-0 overflow-y-auto space-y-5">
          {/* Members */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Members ({group.members.length})
            </h3>
            <div className="space-y-1">
              {group.members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-secondary/50 group"
                >
                  <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground uppercase">
                    {m.email[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{shortEmail(m.email)}</p>
                    {m.role === "admin" && (
                      <span className="text-[9px] text-brand-blue font-medium">admin</span>
                    )}
                  </div>
                  {(isCreator || m.id === myId) && m.id !== myId && isCreator && (
                    <button
                      onClick={() => removeMember.mutate(m.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-red-400 transition-all"
                      title="Remove member"
                    >
                      <UserMinus className="w-3 h-3" />
                    </button>
                  )}
                  {m.id === myId && (
                    <button
                      onClick={() => removeMember.mutate(m.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-red-400 transition-all"
                      title="Leave group"
                    >
                      <UserMinus className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Invite */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <UserPlus className="w-3 h-3" />
              Invite
            </h3>
            <div className="space-y-2">
              <Input
                value={inviteEmail}
                onChange={(e) => { setInviteEmail(e.target.value); setInviteResult(null); }}
                placeholder="email@example.com"
                type="email"
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                className="text-xs h-8"
              />
              <Button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim()}
                size="sm"
                className="w-full rounded-full h-7 text-xs gap-1.5 bg-brand-blue hover:bg-brand-blue/90 text-white"
              >
                <UserPlus className="w-3 h-3" />
                {inviting ? "Looking up..." : "Add to group"}
              </Button>

              {/* Invite result feedback */}
              {inviteResult && (
                <div className="rounded-lg border p-2.5 text-xs space-y-1.5">
                  {!inviteResult.found && (
                    <>
                      <div className="flex items-center gap-1.5 text-amber-400">
                        <Clock className="w-3 h-3 shrink-0" />
                        <span className="font-medium">Not registered</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">
                        <span className="text-foreground">{inviteResult.email}</span> does not have an account yet. Share the registration link with them.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCopyLink}
                        className="w-full h-7 rounded-full text-xs gap-1.5"
                      >
                        {copied ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy registration link</>}
                      </Button>
                    </>
                  )}
                  {inviteResult.found && inviteResult.pending && (
                    <>
                      <div className="flex items-center gap-1.5 text-amber-400">
                        <Clock className="w-3 h-3 shrink-0" />
                        <span className="font-medium">Pending approval</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">
                        <span className="text-foreground">{inviteResult.email}</span> is registered but pending admin approval. Ask an admin to activate their account first.
                      </p>
                    </>
                  )}
                  {inviteResult.found && !inviteResult.pending && (
                    <div className="flex items-center gap-1.5 text-green-400">
                      <ShieldCheck className="w-3 h-3 shrink-0" />
                      <span className="font-medium">{inviteResult.email} added to group</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
