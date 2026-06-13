import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProjectChatMessage } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/auth";
import { Send, MessageSquare, Sparkles } from "lucide-react";

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

export function ProjectChat({ projectId }: { projectId: number }) {
  const auth = useAuth();
  const { toast } = useToast();
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<number>(0);
  const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const myId = auth.status === "authenticated" ? auth.user.id : -1;

  useEffect(() => {
    if (!projectId || auth.status !== "authenticated") return;
    apiFetch(`/api/projects/${projectId}/messages?limit=80`).then((msgs: ProjectChatMessage[]) => {
      setMessages(msgs);
      if (msgs.length) lastIdRef.current = msgs[msgs.length - 1].id;
    });
  }, [projectId, auth.status]);

  useQuery({
    queryKey: ["project-chat-poll", projectId],
    queryFn: async () => {
      const after = lastIdRef.current;
      const newMsgs: ProjectChatMessage[] = await apiFetch(
        `/api/projects/${projectId}/messages?after=${after}&limit=50`,
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
    enabled: !!projectId && auth.status === "authenticated",
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    const content = text.trim();
    setText("");
    setSending(true);
    try {
      const result: { message: ProjectChatMessage; aiReply?: ProjectChatMessage | null } = await apiFetch(
        `/api/projects/${projectId}/messages`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      setMessages((prev) => {
        const next = [...prev];
        if (!next.find((m) => m.id === result.message.id)) {
          next.push(result.message);
          lastIdRef.current = result.message.id;
        }
        if (result.aiReply && !next.find((m) => m.id === result.aiReply!.id)) {
          next.push(result.aiReply);
          lastIdRef.current = result.aiReply.id;
        }
        return next;
      });
    } catch (e: any) {
      setText(content);
      toast({ title: "Failed to send", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-22rem)] min-h-[24rem]">
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageSquare className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              No messages yet. Say hello, or mention <span className="font-mono">@ai</span> for help.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isMine = m.senderId === myId;
            return (
              <div key={m.id} className={`flex flex-col gap-0.5 ${isMine ? "items-end" : "items-start"}`}>
                {!isMine && (
                  <span className="text-[10px] text-muted-foreground px-1 flex items-center gap-1">
                    {m.isAi && <Sparkles className="w-2.5 h-2.5 text-brand-blue" />}
                    {m.isAi ? "AI Assistant" : shortEmail(m.senderEmail ?? "")}
                  </span>
                )}
                <div
                  className={`max-w-[72%] rounded-2xl px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap ${
                    isMine
                      ? "bg-brand-blue text-white rounded-br-sm"
                      : m.isAi
                        ? "bg-brand-blue/10 border border-brand-blue/20 text-foreground rounded-bl-sm"
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

      <div className="flex gap-2 pt-3 shrink-0 border-t border-border mt-3">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the team, or @ai for an assistant..."
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
  );
}
