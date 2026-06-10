import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useGenerateSong, getListSongsQueryKey, getGetSongStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, ArrowRight, Loader2, Music4 } from "lucide-react";
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

export function GenerateForm() {
  const [input, setInput] = useState("");
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
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
      onError: () => {
        toast({
          title: "Generation failed",
          description: "Could not process the song. Please verify the input and try again.",
          variant: "destructive",
        });
      }
    }
  });

  const isPending = generateSong.isPending;

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    generateSong.mutate({ data: { input: input.trim() } });
  };

  return (
    <div className="bg-card border border-border/60 rounded-xl p-8 shadow-sm relative overflow-hidden">
      <div className="relative z-10 max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-serif font-semibold text-foreground mb-2">
            Catalog a New Work
          </h2>
          <p className="text-muted-foreground">
            Paste a YouTube URL or type a song name to generate a complete musicological dossier.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <Music4 className="h-5 w-5 text-muted-foreground/60" />
            </div>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. 'Jolene by Dolly Parton' or https://youtube.com/..."
              className="pl-12 pr-4 py-6 text-lg bg-background/50 border-border/80 focus-visible:ring-primary shadow-inner"
              disabled={isPending}
              data-testid="input-song-generate"
            />
          </div>
          
          {isPending ? (
            <div className="h-12 flex items-center justify-center gap-3 text-primary animate-pulse-slow">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="font-medium text-sm transition-all duration-300">
                {LOADING_MESSAGES[loadingMsgIdx]}
              </span>
            </div>
          ) : (
            <Button 
              type="submit" 
              size="lg" 
              className="w-full sm:w-auto self-center px-8 shadow-sm transition-all hover:shadow-md"
              disabled={!input.trim()}
              data-testid="button-generate"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Dossier
            </Button>
          )}
        </form>
      </div>

      {/* Decorative background element */}
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
    </div>
  );
}
