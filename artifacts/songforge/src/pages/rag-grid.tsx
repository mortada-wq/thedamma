import { useState, useCallback } from "react";
import { useListSongs, useUpdateSong, getListSongsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Save, X } from "lucide-react";
import { Link } from "wouter";
import type { Song } from "@workspace/api-client-react";

type SongMetadata = NonNullable<Song["metadata"]>;

type FieldKey =
  | "title" | "singer" | "composer" | "era" | "geography"
  | "dialect" | "subject" | "history"
  | "instruments" | "voices" | "relatedSubjects" | "relatedWorks"
  | "transcription" | "pronunciationNotes" | "track";

interface FieldDef {
  key: FieldKey;
  label: string;
  color: "blue" | "orange";
  type: "string-short" | "string-long" | "array" | "track";
}

const FIELDS: FieldDef[] = [
  { key: "title",              label: "Title",           color: "blue",   type: "string-short" },
  { key: "singer",             label: "Singer",          color: "orange", type: "string-short" },
  { key: "composer",           label: "Composer",        color: "blue",   type: "string-short" },
  { key: "era",                label: "Era",             color: "orange", type: "string-short" },
  { key: "geography",          label: "Geography",       color: "blue",   type: "string-short" },
  { key: "dialect",            label: "Dialect",         color: "orange", type: "string-short" },
  { key: "subject",            label: "Subject",         color: "blue",   type: "string-short" },
  { key: "history",            label: "History",         color: "orange", type: "string-long"  },
  { key: "instruments",        label: "Instruments",     color: "blue",   type: "array"        },
  { key: "voices",             label: "Voices",          color: "orange", type: "array"        },
  { key: "relatedSubjects",    label: "Related Subjects",color: "blue",   type: "array"        },
  { key: "relatedWorks",       label: "Related Works",   color: "orange", type: "array"        },
  { key: "transcription",      label: "Transcription",   color: "blue",   type: "string-long"  },
  { key: "pronunciationNotes", label: "Pronunciation",   color: "orange", type: "string-long"  },
  { key: "track",              label: "Track",           color: "blue",   type: "track"        },
];

const BLUE   = "#5E94FF";
const ORANGE = "#F7731E";
const EMPTY  = "rgba(247,115,30,0.12)";

function getFieldValue(song: Song, key: FieldKey): unknown {
  if (key === "title")   return song.title;
  if (key === "singer")  return song.singer;
  if (key === "era")     return song.era;
  if (key === "geography") return song.geography;
  return (song.metadata as SongMetadata)[key as keyof SongMetadata];
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function valueToEditString(value: unknown, type: FieldDef["type"]): string {
  if (type === "array") {
    if (!Array.isArray(value)) return "";
    return (value as string[]).join("\n");
  }
  if (type === "track") {
    return JSON.stringify(value, null, 2);
  }
  return typeof value === "string" ? value : "";
}

function editStringToValue(raw: string, type: FieldDef["type"]): unknown {
  if (type === "array") {
    return raw.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  if (type === "track") {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return raw;
}

interface CellDialogState {
  song: Song;
  field: FieldDef;
  rawValue: string;
}

export function RagGrid() {
  const { data: songs, isLoading } = useListSongs();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<CellDialogState | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const updateSong = useUpdateSong();

  const openCell = useCallback((song: Song, field: FieldDef) => {
    const value = getFieldValue(song, field.key);
    setDialog({ song, field, rawValue: valueToEditString(value, field.type) });
    setEditValue(valueToEditString(value, field.type));
  }, []);

  const handleSave = async () => {
    if (!dialog) return;
    setIsSaving(true);
    const parsed = editStringToValue(editValue, dialog.field.type);

    const topLevel = ["title", "singer", "era", "geography"];
    const body: Record<string, unknown> = topLevel.includes(dialog.field.key)
      ? { [dialog.field.key]: parsed }
      : { metadata: { ...dialog.song.metadata, [dialog.field.key]: parsed } };

    try {
      await updateSong.mutateAsync({ id: dialog.song.id, data: body as Parameters<typeof updateSong.mutateAsync>[0]["data"] });
      queryClient.invalidateQueries({ queryKey: getListSongsQueryKey() });
      toast({ title: "Saved", description: `${dialog.field.label} updated for "${dialog.song.title}".` });
      setDialog(null);
    } catch {
      toast({ title: "Save failed", description: "Could not save changes.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">RAG Data Grid</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading..." : `${songs?.length ?? 0} songs — click any cell to view or edit`}
          </p>
        </div>
      </div>

      <div className="flex gap-4 text-xs text-muted-foreground items-center">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: BLUE }} />
          filled
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: ORANGE }} />
          filled
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full inline-block border border-border" style={{ backgroundColor: EMPTY }} />
          empty
        </span>
      </div>

      <div className="rounded-xl border border-border overflow-auto flex-1 min-h-0" style={{ maxHeight: "calc(100vh - 220px)" }}>
        <table className="border-collapse text-sm" style={{ minWidth: `${200 + FIELDS.length * 72}px` }}>
          <thead>
            <tr className="bg-card border-b border-border">
              <th
                className="sticky left-0 z-20 bg-card text-left px-4 py-3 font-semibold text-foreground border-r border-border whitespace-nowrap"
                style={{ minWidth: 200 }}
              >
                Song
              </th>
              {FIELDS.map((f) => (
                <th
                  key={f.key}
                  className="px-2 py-3 font-medium text-center whitespace-nowrap"
                  style={{
                    minWidth: 64,
                    color: f.color === "blue" ? BLUE : ORANGE,
                    fontSize: "0.7rem",
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="sticky left-0 bg-card px-4 py-3 border-r border-border">
                      <Skeleton className="h-4 w-36" />
                    </td>
                    {FIELDS.map((f) => (
                      <td key={f.key} className="px-2 py-3 text-center">
                        <Skeleton className="h-3 w-3 rounded-full mx-auto" />
                      </td>
                    ))}
                  </tr>
                ))
              : songs?.map((song, rowIdx) => (
                  <tr
                    key={song.id}
                    className={`border-b border-border/40 hover:bg-secondary/30 transition-colors ${rowIdx % 2 === 0 ? "" : "bg-card/40"}`}
                  >
                    <td
                      className="sticky left-0 z-10 bg-inherit px-4 py-2.5 border-r border-border"
                      style={{ minWidth: 200 }}
                    >
                      <div className="font-medium text-foreground truncate max-w-[180px]" title={song.title}>
                        {song.title}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-[180px]">{song.singer}</div>
                    </td>
                    {FIELDS.map((f) => {
                      const value = getFieldValue(song, f.key);
                      const filled = isFilled(value);
                      const dotColor = filled
                        ? f.color === "blue" ? BLUE : ORANGE
                        : EMPTY;
                      const dotBorder = filled ? "none" : "1px solid rgba(247,115,30,0.25)";
                      return (
                        <td key={f.key} className="px-2 py-2.5 text-center">
                          <button
                            onClick={() => openCell(song, f)}
                            title={`${f.label} — click to view/edit`}
                            className="inline-flex items-center justify-center rounded-full transition-transform hover:scale-125 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                            style={{ width: 14, height: 14 }}
                          >
                            <span
                              className="rounded-full block"
                              style={{
                                width: 12,
                                height: 12,
                                backgroundColor: dotColor,
                                border: dotBorder,
                                transition: "transform 0.1s",
                              }}
                            />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!dialog} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent className="max-w-lg w-full">
          {dialog && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-col gap-0.5">
                  <span
                    className="text-xs font-semibold uppercase tracking-widest"
                    style={{ color: dialog.field.color === "blue" ? BLUE : ORANGE }}
                  >
                    {dialog.field.label}
                  </span>
                  <span className="text-base font-bold text-foreground truncate">{dialog.song.title}</span>
                </DialogTitle>
              </DialogHeader>

              <div className="py-2">
                {dialog.field.type === "string-short" ? (
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="font-mono text-sm"
                    placeholder="(empty)"
                  />
                ) : (
                  <Textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="font-mono text-sm resize-none"
                    rows={dialog.field.type === "track" ? 14 : dialog.field.type === "array" ? 6 : 10}
                    placeholder={
                      dialog.field.type === "array"
                        ? "One item per line"
                        : dialog.field.type === "track"
                        ? "JSON array of track segments"
                        : "(empty)"
                    }
                    dir={dialog.field.key === "transcription" ? "auto" : undefined}
                  />
                )}
                {dialog.field.type === "array" && (
                  <p className="text-xs text-muted-foreground mt-1.5">One item per line</p>
                )}
                {dialog.field.type === "track" && (
                  <p className="text-xs text-muted-foreground mt-1.5">JSON — array of track segment objects</p>
                )}
              </div>

              <DialogFooter className="gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDialog(null)} className="gap-1.5">
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1.5">
                  <Save className="w-3.5 h-3.5" />
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
