import { useState } from "react";
import {
  useListTasks,
  useCreateTask,
  usePatchTask,
  useDeleteTask,
  useSuggestTasks,
  useListProjectMembers,
  type Task,
  type TaskSuggestion,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Sparkles, Loader2, CalendarDays } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

const STATUSES = ["todo", "in_progress", "done"] as const;

function shortEmail(email: string) {
  return email.split("@")[0];
}

export function TaskBoard({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { data: tasks, refetch } = useListTasks(projectId);
  const { data: members } = useListProjectMembers(projectId);
  const createTask = useCreateTask();
  const patchTask = usePatchTask();
  const deleteTask = useDeleteTask();
  const suggestTasks = useSuggestTasks();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setAdding(true);
    try {
      await createTask.mutateAsync({
        projectId,
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          assigneeId: assigneeId ? Number(assigneeId) : undefined,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        },
      });
      setTitle("");
      setDescription("");
      setAssigneeId("");
      setDueDate("");
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to create task", description: e.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleStatusChange = async (task: Task, status: string) => {
    try {
      await patchTask.mutateAsync({ projectId, taskId: task.id, data: { status: status as any } });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to update task", description: e.message, variant: "destructive" });
    }
  };

  const handleAssigneeChange = async (task: Task, value: string) => {
    try {
      await patchTask.mutateAsync({
        projectId,
        taskId: task.id,
        data: { assigneeId: value === "unassigned" ? null : Number(value) },
      });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to update task", description: e.message, variant: "destructive" });
    }
  };

  const handleDelete = async (taskId: number) => {
    try {
      await deleteTask.mutateAsync({ projectId, taskId });
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to delete task", description: e.message, variant: "destructive" });
    }
  };

  const handleSuggest = async () => {
    try {
      const result = await suggestTasks.mutateAsync({ projectId });
      setSuggestions(result.suggestions ?? []);
      if (!result.suggestions?.length) {
        toast({ title: "No suggestions returned" });
      }
    } catch (e: any) {
      toast({ title: "Failed to generate suggestions", description: e.message, variant: "destructive" });
    }
  };

  const handleAddSuggestion = async (s: TaskSuggestion) => {
    try {
      await createTask.mutateAsync({ projectId, data: { title: s.title, description: s.description } });
      setSuggestions((prev) => prev.filter((x) => x.title !== s.title));
      refetch();
    } catch (e: any) {
      toast({ title: "Failed to add task", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Add task */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New task title..."
          onKeyDown={(e) => e.key === "Enter" && !adding && handleCreate()}
        />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="min-h-16"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={assigneeId} onValueChange={setAssigneeId}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Assign to..." />
            </SelectTrigger>
            <SelectContent>
              {members?.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {shortEmail(m.email)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-40 h-8 text-xs"
          />
          <Button
            onClick={handleCreate}
            disabled={adding || !title.trim()}
            size="sm"
            className="gap-1.5 rounded-full ml-auto"
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add task
          </Button>
          <Button
            onClick={handleSuggest}
            disabled={suggestTasks.isPending}
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-full"
          >
            {suggestTasks.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            Suggest tasks with AI
          </Button>
        </div>
      </div>

      {/* AI suggestions */}
      {suggestions.length > 0 && (
        <div className="rounded-2xl border border-brand-blue/30 bg-brand-blue/5 p-4 space-y-2">
          <p className="text-xs font-semibold text-brand-blue flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> AI suggestions
          </p>
          {suggestions.map((s) => (
            <div key={s.title} className="flex items-start justify-between gap-3 rounded-lg bg-card border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm text-foreground font-medium">{s.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
              </div>
              <Button size="sm" variant="outline" className="rounded-full shrink-0" onClick={() => handleAddSuggestion(s)}>
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Task list by status */}
      {(!tasks || tasks.length === 0) ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No tasks yet. Add one above, or ask the AI for suggestions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STATUSES.map((status) => (
            <div key={status} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {STATUS_LABELS[status]} ({tasks.filter((t) => t.status === status).length})
              </h3>
              <div className="space-y-2">
                {tasks
                  .filter((t) => t.status === status)
                  .map((task) => (
                    <div key={task.id} className="rounded-xl border border-border bg-card p-3 space-y-2 group">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{task.title}</p>
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-red-400 transition-opacity shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {task.description && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{task.description}</p>
                      )}
                      {task.dueDate && (
                        <p className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" />
                          {new Date(task.dueDate).toLocaleDateString()}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Select value={task.status} onValueChange={(v) => handleStatusChange(task, v)}>
                          <SelectTrigger className="h-7 text-[11px] flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={task.assigneeId ? String(task.assigneeId) : "unassigned"} onValueChange={(v) => handleAssigneeChange(task, v)}>
                          <SelectTrigger className="h-7 text-[11px] flex-1">
                            <SelectValue placeholder="Unassigned" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {members?.map((m) => (
                              <SelectItem key={m.id} value={String(m.id)}>{shortEmail(m.email)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
