import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/auth";
import { Users, Plus, MessageSquare, ChevronRight } from "lucide-react";

type GroupRow = {
  id: number;
  name: string;
  createdBy: number;
  createdAt: string;
  memberCount: number;
};

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

export function Groups() {
  const auth = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const { data: groups, isLoading } = useQuery<GroupRow[]>({
    queryKey: ["groups"],
    queryFn: () => apiFetch("/api/groups"),
    enabled: auth.status === "authenticated",
  });

  const createGroup = useMutation({
    mutationFn: (name: string) =>
      apiFetch("/api/groups", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      setNewName("");
      setShowForm(false);
      toast({ title: "Group created" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try { await createGroup.mutateAsync(newName.trim()); }
    finally { setCreating(false); }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Groups</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Internal team group chats</p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowForm((v) => !v)}
          className="gap-2 rounded-full bg-brand-blue hover:bg-brand-blue/90 text-white px-4"
        >
          <Plus className="w-4 h-4" />
          New group
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">Create a new group</p>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Group name"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="flex-1"
              autoFocus
            />
            <Button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="rounded-full shrink-0 bg-brand-blue hover:bg-brand-blue/90 text-white"
              size="sm"
            >
              {creating ? "Creating..." : "Create"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowForm(false); setNewName(""); }}
              className="rounded-full text-muted-foreground"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-secondary/30 animate-pulse" />
          ))}
        </div>
      ) : !groups || groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <MessageSquare className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No groups yet. Create one to start chatting.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <Link key={g.id} href={`/groups/${g.id}`}>
              <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-secondary/40 transition-colors cursor-pointer group">
                <div className="w-10 h-10 rounded-full bg-brand-blue/15 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-brand-blue" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{g.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {g.memberCount} member{Number(g.memberCount) !== 1 ? "s" : ""} &middot;{" "}
                    {new Date(g.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
