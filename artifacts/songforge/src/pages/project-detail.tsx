import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetProject,
  useCreateEntry,
  useDeleteEntry,
  usePatchProject,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Plus, Trash2, Download, Globe, Lock, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const { data: project, isLoading, refetch } = useGetProject(projectId);
  const createEntry = useCreateEntry();
  const deleteEntry = useDeleteEntry();
  const patchProject = usePatchProject();
  const { toast } = useToast();

  const [inputUrl, setInputUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleAddEntry = async () => {
    if (!inputUrl.trim()) return;
    setAdding(true);
    try {
      await createEntry.mutateAsync({ projectId, data: { inputUrl: inputUrl.trim() } });
      setInputUrl("");
      refetch();
      toast({ title: "Entry added" });
    } catch (e: any) {
      toast({ title: "Failed to add entry", description: e.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteEntry = async (entryId: number) => {
    if (deletingId === entryId) {
      try {
        await deleteEntry.mutateAsync({ projectId, entryId });
        refetch();
      } catch (e: any) {
        toast({ title: "Failed to delete entry", description: e.message, variant: "destructive" });
      } finally {
        setDeletingId(null);
      }
    } else {
      setDeletingId(entryId);
      setTimeout(() => setDeletingId(null), 3000);
    }
  };

  const togglePublic = async () => {
    if (!project) return;
    try {
      await patchProject.mutateAsync({ projectId, data: { isPublic: !project.isPublic } });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to update", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-secondary/50 rounded animate-pulse" />
        <div className="h-32 bg-secondary/30 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-3xl mx-auto text-center py-16 text-muted-foreground">
        Project not found.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start gap-4 mb-8">
        <Link href="/projects">
          <Button variant="ghost" size="sm" className="gap-2 rounded-full text-muted-foreground hover:text-foreground mt-0.5">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-foreground truncate">{project.title}</h1>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="capitalize">{project.category.replace("-", " ")}</span>
            <span>·</span>
            <span>{project.provider}</span>
            <span>·</span>
            <span>{project.entries.length} entries</span>
          </div>
          {project.summary && (
            <p className="text-sm text-muted-foreground mt-1">{project.summary}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={togglePublic}
            className="gap-2 rounded-full text-xs text-muted-foreground hover:text-foreground"
          >
            {project.isPublic ? <><Globe className="w-3.5 h-3.5" /> Public</> : <><Lock className="w-3.5 h-3.5" /> Private</>}
          </Button>
          <a href={`/api/projects/${projectId}/export`} target="_blank" rel="noopener">
            <Button variant="outline" size="sm" className="gap-2 rounded-full text-xs">
              <Download className="w-3.5 h-3.5" />
              Export JSON
            </Button>
          </a>
        </div>
      </div>

      {/* Add entry */}
      <div className="mb-6 flex gap-2">
        <Input
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          placeholder="Paste a link, image URL, YouTube URL, or describe an input..."
          className="flex-1"
          onKeyDown={(e) => e.key === "Enter" && !adding && handleAddEntry()}
          disabled={adding}
        />
        <Button
          onClick={handleAddEntry}
          disabled={adding || !inputUrl.trim()}
          className="gap-2 rounded-full shrink-0"
        >
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {adding ? "Processing..." : "Add entry"}
        </Button>
      </div>

      {/* Entries */}
      {project.entries.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No entries yet. Add your first input above — AI will analyze it and generate descriptions.</p>
        </div>
      )}

      <div className="space-y-4">
        {project.entries.map((entry, idx) => (
          <div key={entry.id} className="rounded-2xl border border-border bg-card overflow-hidden group">
            <div className="flex items-start gap-3 p-4 border-b border-border/50">
              <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0 w-5">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground break-all">{entry.inputUrl}</p>
                {entry.aiQuestion && (
                  <p className="text-xs text-brand-blue mt-1.5 italic">
                    AI: {entry.aiQuestion}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 w-7 p-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ${
                  deletingId === entry.id ? "text-red-400 hover:bg-red-400/10" : "text-muted-foreground"
                }`}
                onClick={() => handleDeleteEntry(entry.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
            {entry.descriptions.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/50">
                {entry.descriptions.map((desc) => (
                  <div key={desc.label} className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      {desc.label}
                    </p>
                    <p className="text-sm text-foreground leading-relaxed">{desc.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
