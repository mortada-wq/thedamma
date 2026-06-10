import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useGenerateSong, getListSongsQueryKey, getGetSongStatsQueryKey, ApiError } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, ArrowRight, Loader2, Music4, Link, Upload, Search } from "lucide-react";
import { useLocation } from "wouter";

const LOADING_MESSAGES = [
  "Waking up the archivist...",
  "Analyzing audio frequencies...",
  "Extracting instrumental layers...",
  "Transcribing lyrics...",
  "Identifying dialect and pronunciation...",
  "Drafting historical context...",
  "Structuring metadata...",
  "Finalizing dossier..."
];

type Tab = "link" | "upload" | "name";

export function GenerateForm() {
  const [activeTab, setActiveTab] = useState<Tab>("name");
  const [textInput, setTextInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const generateSong = useGenerateSong({
    mutation: {
      onSuccess: (song) => {
        queryClient.invalidateQueries({ queryKey: getListSongsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSongStatsQueryKey() });
        toast({
          title: "Dossier generated",
          description: `Successfully cataloged "${song.title}".`,
        });
        setLocation(`/song/${song.id}`);
      },
      onError: (err) => {
        const serverMessage = (err as ApiError<{ error?: string }>).data?.error;
        toast({
          title: "Generation failed",
          description: serverMessage ?? "Could not process the song. Please verify the input and try again.",
          variant: "destructive",
        });
      }
    }
  });

  const isPending = generateSong.isPending || isUploading;

  useEffect(() => {
    if (!isPending) {
      setLoadingMsgIdx(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingMsgIdx((prev) => Math.min(prev + 1, LOADING_MESSAGES.length - 1));
    }, 4000);
    return () => clearInterval(interval);
  }, [isPending]);

  const canSubmit = () => {
    if (isPending) return false;
    if (activeTab === "upload") return file !== null;
    return textInput.trim().length > 0;
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/songs/upload", { method: "POST", body: formData });
      const data = await res.json() as { id?: number; title?: string; error?: string };
      if (!res.ok) {
        toast({
          title: "Generation failed",
          description: data.error ?? "Could not process the file. Please try again.",
          variant: "destructive",
        });
        return;
      }
      queryClient.invalidateQueries({ queryKey: getListSongsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetSongStatsQueryKey() });
      toast({ title: "Dossier generated", description: `Successfully cataloged "${data.title}".` });
      setLocation(`/song/${data.id}`);
    } catch {
      toast({ title: "Upload failed", description: "Network error. Please try again.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit()) return;
    if (activeTab === "upload") {
      handleUpload();
    } else {
      generateSong.mutate({ data: { input: textInput.trim() } });
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "name", label: "Song Name", icon: <Search className="w-4 h-4" /> },
    { id: "link", label: "YouTube Link", icon: <Link className="w-4 h-4" /> },
    { id: "upload", label: "Upload File", icon: <Upload className="w-4 h-4" /> },
  ];

  return (
    <div className="bg-card border border-border rounded-xl p-8 shadow-sm relative">
      <div className="relative z-10 max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <h2 className="text-3xl font-bold text-foreground mb-2 tracking-tight">
            Catalog a New Work
          </h2>
          <p className="text-muted-foreground">
            Search by name, paste a YouTube link, or upload an audio or video file.
          </p>
        </div>

        <div className="flex gap-1 p-1 bg-secondary rounded-lg mb-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setActiveTab(tab.id); setTextInput(""); setFile(null); }}
              disabled={isPending}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all duration-150 ${
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {activeTab === "upload" ? (
            <div
              className="prompt-glow relative bg-secondary rounded-[15px] border border-dashed border-border cursor-pointer hover:border-brand-blue/50 transition-colors"
              onClick={() => !isPending && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/*,.mp3,.mp4,.m4a,.wav,.flac,.ogg,.aac,.mkv,.webm"
                className="hidden"
                disabled={isPending}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
                <Upload className="w-8 h-8 text-muted-foreground" />
                {file ? (
                  <>
                    <span className="text-sm font-medium text-foreground">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {(file.size / (1024 * 1024)).toFixed(1)} MB — click to change
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium text-foreground">Click to select a file</span>
                    <span className="text-xs text-muted-foreground">
                      MP3, MP4, M4A, WAV, FLAC, OGG, AAC, MKV, WebM — up to 200 MB
                    </span>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="prompt-glow relative bg-secondary">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none z-10">
                {activeTab === "link"
                  ? <Link className="h-5 w-5 text-muted-foreground" />
                  : <Music4 className="h-5 w-5 text-muted-foreground" />
                }
              </div>
              <Input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={
                  activeTab === "link"
                    ? "https://youtube.com/watch?v=..."
                    : "e.g. Enta Omri - Umm Kulthum"
                }
                className="pl-12 pr-4 py-6 text-base bg-transparent border-transparent rounded-[15px] focus-visible:ring-0 focus-visible:ring-offset-0"
                disabled={isPending}
                data-testid="input-song-generate"
              />
            </div>
          )}

          {isPending ? (
            <div className="h-12 flex items-center justify-center gap-3 text-brand-blue animate-pulse-slow">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="font-medium text-sm">
                {LOADING_MESSAGES[loadingMsgIdx]}
              </span>
            </div>
          ) : (
            <Button
              type="submit"
              size="lg"
              className="w-full sm:w-auto self-center px-8 transition-transform duration-150 ease-out active:scale-[0.98]"
              disabled={!canSubmit()}
              data-testid="button-generate"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Dossier
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
