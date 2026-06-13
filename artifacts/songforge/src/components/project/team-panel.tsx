import { useState } from "react";
import {
  useListProjectMembers,
  useAddProjectMember,
  useRemoveProjectMember,
  type InviteResult,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/auth";
import { UserPlus, UserMinus, ShieldCheck, Clock, Crown } from "lucide-react";

function shortEmail(email: string) {
  return email.split("@")[0];
}

export function TeamPanel({ projectId, isOwner }: { projectId: number; isOwner: boolean }) {
  const { toast } = useToast();
  const auth = useAuth();
  const myId = auth.status === "authenticated" ? auth.user.id : -1;
  const { data: members, refetch } = useListProjectMembers(projectId);
  const addMember = useAddProjectMember();
  const removeMember = useRemoveProjectMember();

  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);

  const handleInvite = async () => {
    if (!email.trim() || inviting) return;
    setInviting(true);
    setResult(null);
    try {
      const res = await addMember.mutateAsync({ projectId, data: { email: email.trim() } });
      setResult(res);
      if (res.found && res.added) {
        setEmail("");
        refetch();
        toast({ title: "Member added", description: res.email });
      }
    } catch (e: any) {
      toast({ title: "Invite failed", description: e.message, variant: "destructive" });
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (userId: number) => {
    try {
      await removeMember.mutateAsync({ projectId, userId });
      refetch();
      toast({ title: userId === myId ? "Left project" : "Member removed" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="max-w-md space-y-6">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Members ({members?.length ?? 0})
        </h3>
        <div className="space-y-1">
          {members?.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-secondary/50 group"
            >
              <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0 text-[10px] font-bold text-muted-foreground uppercase">
                {m.email[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{shortEmail(m.email)}</p>
                {m.role === "owner" && (
                  <span className="text-[10px] text-brand-blue font-medium flex items-center gap-1">
                    <Crown className="w-2.5 h-2.5" /> owner
                  </span>
                )}
              </div>
              {((isOwner && m.id !== myId) || (m.id === myId && m.role !== "owner")) && (
                <button
                  onClick={() => handleRemove(m.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-red-400 transition-all"
                  title={m.id === myId ? "Leave project" : "Remove member"}
                >
                  <UserMinus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {isOwner && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <UserPlus className="w-3 h-3" />
            Invite
          </h3>
          <div className="flex gap-2">
            <Input
              value={email}
              onChange={(e) => { setEmail(e.target.value); setResult(null); }}
              placeholder="email@example.com"
              type="email"
              onKeyDown={(e) => e.key === "Enter" && handleInvite()}
              className="text-sm h-9 flex-1"
            />
            <Button
              onClick={handleInvite}
              disabled={inviting || !email.trim()}
              size="sm"
              className="rounded-full gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Add
            </Button>
          </div>

          {result && (
            <div className="rounded-lg border p-2.5 text-xs space-y-1.5">
              {!result.found && (
                <div className="flex items-center gap-1.5 text-amber-400">
                  <Clock className="w-3 h-3 shrink-0" />
                  <span className="font-medium">{result.email} does not have an account yet.</span>
                </div>
              )}
              {result.found && result.pending && (
                <div className="flex items-center gap-1.5 text-amber-400">
                  <Clock className="w-3 h-3 shrink-0" />
                  <span className="font-medium">{result.email} is pending admin approval.</span>
                </div>
              )}
              {result.found && result.added && (
                <div className="flex items-center gap-1.5 text-green-400">
                  <ShieldCheck className="w-3 h-3 shrink-0" />
                  <span className="font-medium">{result.email} added to project</span>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
