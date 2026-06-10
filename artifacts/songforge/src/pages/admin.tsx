import { useState, useEffect } from "react";
import {
  useGetAdminSettings,
  useUpdateAdminSettings,
  useListUsers,
  useInviteUser,
  usePatchUser,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save, Check, AlertCircle, UserPlus, ShieldCheck, Clock, Ban } from "lucide-react";
import { Link } from "wouter";

type Provider = "gemini" | "claude" | "deepseek" | "siliconflow" | "flamingo";

const PROVIDERS: {
  id: Provider;
  label: string;
  description: string;
  defaultModel: string;
  envVar?: string;
  supportsAudio: boolean;
  audioOnly?: boolean;
  note?: string;
}[] = [
  {
    id: "gemini",
    label: "Gemini",
    description: "Google Gemini via Replit proxy — no API key required.",
    defaultModel: "gemini-2.0-flash",
    supportsAudio: true,
  },
  {
    id: "flamingo",
    label: "Music Flamingo",
    description: "NVIDIA Music Flamingo — music-specialized audio LLM via HuggingFace. Optional HF_TOKEN for higher rate limits.",
    defaultModel: "nvidia/music-flamingo",
    envVar: "HF_TOKEN",
    supportsAudio: true,
    audioOnly: true,
    note: "Song-name queries fall back to Gemini (Flamingo needs audio). HF_TOKEN is optional but reduces rate limiting.",
  },
  {
    id: "claude",
    label: "Claude",
    description: "Anthropic Claude via Replit proxy — no API key required.",
    defaultModel: "claude-sonnet-4-6",
    supportsAudio: false,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek API — requires DEEPSEEK_API_KEY environment secret.",
    defaultModel: "deepseek-chat",
    envVar: "DEEPSEEK_API_KEY",
    supportsAudio: false,
  },
  {
    id: "siliconflow",
    label: "Silicon Flow",
    description: "SiliconFlow API — requires SILICON_FLOW_API_KEY environment secret.",
    defaultModel: "deepseek-ai/DeepSeek-V3",
    envVar: "SILICON_FLOW_API_KEY",
    supportsAudio: false,
  },
];

type AdminUser = {
  id: number;
  email: string;
  role: "pending" | "user" | "admin";
  createdAt: string;
};

function UserRow({
  user,
  onPatch,
  patching,
}: {
  user: AdminUser;
  onPatch: (userId: number, role: "pending" | "user" | "admin") => void;
  patching: number | null;
}) {
  const roleColor: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    user: "bg-green-500/10 text-green-400 border-green-500/20",
    admin: "bg-brand-blue/10 text-brand-blue border-brand-blue/20",
  };

  return (
    <div className="flex items-center gap-3 py-3 border-b border-border/50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{user.email}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Joined {new Date(user.createdAt).toLocaleDateString()}
        </p>
      </div>
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${roleColor[user.role]}`}>
        {user.role}
      </span>
      <div className="flex items-center gap-1">
        {user.role === "pending" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1 rounded-full text-green-400 hover:bg-green-400/10"
            disabled={patching === user.id}
            onClick={() => onPatch(user.id, "user")}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Approve
          </Button>
        )}
        {user.role === "user" && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1 rounded-full text-brand-blue hover:bg-brand-blue/10"
              disabled={patching === user.id}
              onClick={() => onPatch(user.id, "admin")}
            >
              Make admin
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1 rounded-full text-amber-400 hover:bg-amber-400/10"
              disabled={patching === user.id}
              onClick={() => onPatch(user.id, "pending")}
            >
              <Ban className="w-3.5 h-3.5" />
            </Button>
          </>
        )}
        {user.role === "admin" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1 rounded-full text-muted-foreground hover:bg-secondary"
            disabled={patching === user.id}
            onClick={() => onPatch(user.id, "user")}
          >
            Demote
          </Button>
        )}
      </div>
    </div>
  );
}

export function Admin() {
  const { toast } = useToast();

  // AI settings
  const { data, isLoading } = useGetAdminSettings();
  const update = useUpdateAdminSettings();
  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState("gemini-2.0-flash");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setProvider(data.activeProvider as Provider);
      setModel(data.activeModel);
    }
  }, [data]);

  const handleProviderChange = (p: Provider) => {
    setProvider(p);
    setModel(PROVIDERS.find((x) => x.id === p)?.defaultModel ?? "");
    setSaved(false);
  };

  const handleSave = async () => {
    try {
      await update.mutateAsync({ data: { activeProvider: provider, activeModel: model } });
      setSaved(true);
      toast({ title: "Settings saved", description: `Now using ${label} / ${model}` });
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast({ title: "Save failed", description: "Could not update settings.", variant: "destructive" });
    }
  };

  // User management
  const { data: users, refetch: refetchUsers } = useListUsers();
  const inviteUser = useInviteUser();
  const patchUser = usePatchUser();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [patchingId, setPatchingId] = useState<number | null>(null);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const result = await inviteUser.mutateAsync({ data: { email: inviteEmail.trim() } });
      setInviteEmail("");
      refetchUsers();
      const tempPw = (result as any).tempPassword;
      toast({
        title: "User invited",
        description: tempPw ? `Temporary password: ${tempPw}` : "User created in pending state.",
      });
    } catch (e: any) {
      toast({ title: "Invite failed", description: e.message, variant: "destructive" });
    } finally {
      setInviting(false);
    }
  };

  const handlePatchUser = async (userId: number, role: "pending" | "user" | "admin") => {
    setPatchingId(userId);
    try {
      await patchUser.mutateAsync({ userId, data: { role } });
      refetchUsers();
      toast({ title: "User updated" });
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setPatchingId(null);
    }
  };

  const current = PROVIDERS.find((p) => p.id === provider)!;
  const label = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;

  const pending = users?.filter((u) => u.role === "pending") ?? [];
  const active = users?.filter((u) => u.role !== "pending") ?? [];

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="h-8 w-48 bg-secondary/50 rounded animate-pulse mb-6" />
        <div className="h-64 bg-secondary/30 rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-10">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground rounded-full">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Admin</h1>
          <p className="text-sm text-muted-foreground mt-0.5">AI provider settings and user management</p>
        </div>
      </div>

      {/* ── AI Provider ── */}
      <section className="space-y-5">
        <h2 className="text-base font-semibold text-foreground border-b border-border/50 pb-2">AI Provider</h2>

        <div className="grid grid-cols-2 gap-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderChange(p.id)}
              className={`text-left p-4 rounded-xl border transition-all ${
                provider === p.id
                  ? "border-brand-blue bg-brand-blue/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-border/80 hover:bg-secondary/40"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`font-medium text-sm ${provider === p.id ? "text-brand-blue" : "text-foreground"}`}>
                  {p.label}
                </span>
                {p.supportsAudio ? (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">audio</span>
                ) : (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">text</span>
                )}
              </div>
              <p className="text-xs leading-relaxed">{p.description}</p>
            </button>
          ))}
        </div>

        {!current.supportsAudio && (
          <div className="flex gap-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300 leading-relaxed">
              <strong>{current.label}</strong> does not support audio analysis. YouTube links and uploaded files will
              still be processed, but analysis will be based on training knowledge rather than the actual audio.
            </p>
          </div>
        )}

        {current.audioOnly && (
          <div className="flex gap-3 p-3 rounded-xl border border-sky-500/20 bg-sky-500/5">
            <AlertCircle className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <p className="text-xs text-sky-300 leading-relaxed">
              <strong>{current.label}</strong> requires audio input. Song-name queries fall back to Gemini automatically.
            </p>
          </div>
        )}

        {current.envVar && (
          <div className="flex gap-3 p-3 rounded-xl border border-border bg-card">
            <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {current.audioOnly
                ? <>Optionally set <code className="font-mono bg-secondary px-1 py-0.5 rounded text-foreground">{current.envVar}</code> for higher rate limits. Works without it.</>
                : <>Requires <code className="font-mono bg-secondary px-1 py-0.5 rounded text-foreground">{current.envVar}</code> in the Replit Secrets panel.</>}
            </p>
          </div>
        )}

        <div>
          <Label htmlFor="model-input" className="text-sm font-medium text-foreground mb-2 block">Model name</Label>
          <Input
            id="model-input"
            value={model}
            onChange={(e) => { setModel(e.target.value); setSaved(false); }}
            placeholder="e.g. gemini-2.0-flash"
            className="font-mono text-sm bg-card border-border focus:border-brand-blue/60"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            Default: <code className="font-mono">{current.defaultModel}</code>
          </p>
        </div>

        <Button
          onClick={handleSave}
          disabled={update.isPending || !model.trim()}
          className="gap-2 rounded-full bg-brand-blue hover:bg-brand-blue/90 text-white font-medium px-6"
        >
          {saved ? <><Check className="w-4 h-4" /> Saved</> : update.isPending ? "Saving..." : <><Save className="w-4 h-4" /> Save settings</>}
        </Button>
      </section>

      {/* ── User Management ── */}
      <section className="space-y-5">
        <h2 className="text-base font-semibold text-foreground border-b border-border/50 pb-2">User Management</h2>

        {/* Invite */}
        <div className="space-y-2">
          <Label className="text-sm text-muted-foreground">Invite by email</Label>
          <div className="flex gap-2">
            <Input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@example.com"
              type="email"
              onKeyDown={(e) => e.key === "Enter" && !inviting && handleInvite()}
              className="flex-1"
            />
            <Button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
              className="gap-2 rounded-full shrink-0"
              size="sm"
            >
              <UserPlus className="w-4 h-4" />
              {inviting ? "Inviting..." : "Invite"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Creates an account with a temporary password shown in the confirmation. Share it out-of-band.
          </p>
        </div>

        {/* Pending approvals */}
        {pending.length > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium text-amber-300">{pending.length} pending approval{pending.length > 1 ? "s" : ""}</span>
            </div>
            <div>
              {pending.map((u) => (
                <UserRow
                  key={u.id}
                  user={u as AdminUser}
                  onPatch={handlePatchUser}
                  patching={patchingId}
                />
              ))}
            </div>
          </div>
        )}

        {/* All users */}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            All users ({users?.length ?? 0})
          </p>
          {!users || users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <div>
              {[...pending, ...active].map((u) => (
                <UserRow
                  key={u.id}
                  user={u as AdminUser}
                  onPatch={handlePatchUser}
                  patching={patchingId}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
