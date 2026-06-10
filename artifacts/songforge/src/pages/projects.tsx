import { useState } from "react";
import { Link } from "wouter";
import { useListProjects, useCreateProject, useDeleteProject } from "@workspace/api-client-react";
import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Download, Trash2, Lock, Globe, FolderOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  { value: "rag-dataset", label: "RAG Dataset" },
  { value: "fine-tune", label: "Fine-tune Dataset" },
  { value: "document", label: "Document" },
  { value: "other", label: "Other" },
] as const;

const PROVIDERS = ["gemini", "claude", "deepseek", "siliconflow", "flamingo"] as const;

export function Projects() {
  const { data: projects, isLoading, refetch } = useListProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<"rag-dataset" | "fine-tune" | "document" | "other">("rag-dataset");
  const [provider, setProvider] = useState("gemini");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      await createProject.mutateAsync({ data: { title: title.trim(), category, provider } });
      setTitle(""); setShowForm(false);
      refetch();
      toast({ title: "Project created" });
    } catch (e: any) {
      toast({ title: "Failed to create project", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (deletingId === id) {
      try {
        await deleteProject.mutateAsync({ projectId: id });
        refetch();
        toast({ title: "Project deleted" });
      } catch (e: any) {
        toast({ title: "Failed to delete", description: e.message, variant: "destructive" });
      } finally {
        setDeletingId(null);
      }
    } else {
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">My Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Each project generates a structured dataset file
          </p>
        </div>
        <Button
          onClick={() => setShowForm((v) => !v)}
          className="gap-2 rounded-full"
          size="sm"
        >
          <Plus className="w-4 h-4" />
          New Project
        </Button>
      </div>

      {showForm && (
        <div className="mb-6 p-5 rounded-2xl border border-border bg-card space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Create project</h2>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Arabic Music RAG v1"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>AI Provider</Label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={creating || !title.trim()} size="sm">
              {creating ? "Creating..." : "Create"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-secondary/30 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && projects?.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No projects yet. Create your first one above.</p>
        </div>
      )}

      <div className="space-y-3">
        {projects?.map((project) => (
          <div key={project.id} className="flex items-center gap-4 p-4 rounded-2xl border border-border bg-card hover:bg-secondary/30 transition-colors group">
            <Link href={`/projects/${project.id}`} className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-foreground truncate">{project.title}</span>
                {project.isPublic
                  ? <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  : <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="capitalize">{project.category.replace("-", " ")}</span>
                <span>·</span>
                <span>{project.provider}</span>
                <span>·</span>
                <span>{project.entryCount} {project.entryCount === 1 ? "entry" : "entries"}</span>
              </div>
              {project.summary && (
                <p className="text-xs text-muted-foreground mt-1 truncate">{project.summary}</p>
              )}
            </Link>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <a href={`/api/projects/${project.id}/export`} target="_blank" rel="noopener">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-full">
                  <Download className="w-3.5 h-3.5" />
                </Button>
              </a>
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 w-8 p-0 rounded-full ${deletingId === project.id ? "text-red-400 hover:text-red-400 hover:bg-red-400/10" : "text-muted-foreground"}`}
                onClick={() => handleDelete(project.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
