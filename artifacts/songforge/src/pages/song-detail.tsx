import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { 
  useGetSong, 
  useDeleteSong,
  useReanalyzeDna,
  useReanalyzeSong,
  getGetSongQueryKey, 
  getListSongsQueryKey, 
  getGetSongStatsQueryKey 
} from "@workspace/api-client-react";
import type { Song, ReanalyzeDraftResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Timeline } from "@/components/timeline";
import { DraftDiff } from "@/components/draft-diff";
import { downloadJson } from "@/lib/export";
import { useToast } from "@/hooks/use-toast";
import { 
  ArrowLeft, Download, Trash2, User, Globe, Clock, BookOpen, 
  Mic2, Music2, Languages, ListMusic, FileText, Dna, RefreshCw, ChevronDown
} from "lucide-react";
import { Link } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SongDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<ReanalyzeDraftResponse | null>(null);

  const { data: song, isLoading } = useGetSong(id, { 
    query: { enabled: !!id, queryKey: getGetSongQueryKey(id) } 
  });

  const deleteSong = useDeleteSong({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSongsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSongStatsQueryKey() });
        toast({ title: "Song removed from archive." });
        setLocation("/");
      },
      onError: () => {
        toast({ title: "Failed to delete song.", variant: "destructive" });
      }
    }
  });

  const reanalyzeDna = useReanalyzeDna({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetSongQueryKey(id), updated);
        toast({ title: "Musical DNA added." });
      },
      onError: () => {
        toast({ title: "Re-analysis failed. Please try again.", variant: "destructive" });
      }
    }
  });

  const reanalyzeFull = useReanalyzeSong({
    mutation: {
      onSuccess: (response) => {
        setDraft(response);
        toast({ title: "Draft ready — review the changes below." });
      },
      onError: () => {
        toast({ title: "Re-analysis failed. Please try again.", variant: "destructive" });
      }
    }
  });

  const isAnalyzing = reanalyzeDna.isPending || reanalyzeFull.isPending;

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <Skeleton className="w-32 h-8" />
        <Skeleton className="w-full h-40 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!song) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-serif font-bold text-foreground">Dossier not found</h2>
        <p className="text-muted-foreground mt-2 mb-6">This song may have been removed or does not exist.</p>
        <Link href="/" className="inline-flex items-center text-brand-blue font-medium hover:underline">
          <ArrowLeft className="w-4 h-4 mr-2" /> Return to Library
        </Link>
      </div>
    );
  }

  const m = song.metadata;
  const missingDna = !m.maqamat?.length && !m.iqaat?.length && !m.ornamentation;

  const handleExport = () => {
    downloadJson(song, `damma-${song.id}-${song.title.toLowerCase().replace(/\s+/g, '-')}.json`);
    toast({ title: "Dossier exported" });
  };

  const handleDraftAccepted = (updated: Song) => {
    queryClient.setQueryData(getGetSongQueryKey(id), updated);
    setDraft(null);
  };

  return (
    <div className="max-w-5xl mx-auto pb-24">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-foreground font-medium transition-colors">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Library
        </Link>
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={isAnalyzing || !!draft}
                className="rounded-full bg-transparent border-brand-blue/50 text-brand-blue hover:bg-brand-blue/10 hover:text-brand-blue active:scale-[0.98] transition-transform"
                data-testid="button-reanalyze-menu"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isAnalyzing ? "animate-spin" : ""}`} />
                {isAnalyzing ? "Analyzing..." : "Re-analyze"}
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onClick={() => reanalyzeFull.mutate({ id: song.id })}
                disabled={isAnalyzing || !!draft}
                data-testid="button-reanalyze-full"
                className="cursor-pointer"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Full dossier
              </DropdownMenuItem>
              {missingDna && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => reanalyzeDna.mutate({ id: song.id })}
                    disabled={isAnalyzing || !!draft}
                    data-testid="button-reanalyze-dna"
                    className="cursor-pointer"
                  >
                    <Dna className="w-4 h-4 mr-2" />
                    Musical DNA only
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={handleExport} className="rounded-full bg-transparent border-brand-blue/50 text-brand-blue hover:bg-brand-blue/10 hover:text-brand-blue active:scale-[0.98] transition-transform" data-testid="button-export-single">
            <Download className="w-4 h-4 mr-2" /> Export JSON
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/40 active:scale-[0.98] transition-transform" data-testid="button-delete">
                <Trash2 className="w-4 h-4 mr-2" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this dossier?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. "{song.title}" will be permanently removed from the archive.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={() => deleteSong.mutate({ id: song.id })}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Draft diff panel */}
      {draft && (
        <div className="mb-8">
          <DraftDiff
            songId={id}
            response={draft}
            onAccepted={handleDraftAccepted}
            onDiscard={() => setDraft(null)}
          />
        </div>
      )}

      {/* Main Title Area */}
      <div className="mb-12 border-b border-border/60 pb-8">
        <h1 className="font-song text-5xl md:text-6xl font-bold text-foreground leading-tight mb-4">
          {m.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-muted-foreground">
          <div className="flex items-center gap-2 text-lg">
            <User className="w-5 h-5 text-brand-blue/80" />
            <span className="font-medium text-foreground">{m.singer}</span>
          </div>
          {m.composer && (
            <div className="flex items-center gap-2 text-lg">
              <span className="text-sm uppercase tracking-wide font-semibold text-muted-foreground">BY</span>
              <span className="font-medium text-foreground">{m.composer}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground ml-auto">
            <Clock className="w-3.5 h-3.5" />
            <span>Last analyzed: {new Date(song.analyzedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        
        {/* Left Column: Context & Metadata */}
        <div className="lg:col-span-1 space-y-8">
          <section className="bg-card rounded-xl border border-border/50 p-6 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
              <Globe className="w-4 h-4" /> Origin & Era
            </h3>
            <div className="space-y-4">
              <div>
                <span className="block text-xs font-semibold text-muted-foreground mb-1">Geography</span>
                <span className="text-foreground font-medium">{m.geography}</span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-muted-foreground mb-1">Musical Era</span>
                <span className="text-foreground font-medium">{m.era}</span>
              </div>
              <div>
                <span className="block text-xs font-semibold text-muted-foreground mb-1">Dialect / Language</span>
                <span className="text-foreground font-medium">{m.dialect}</span>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border/50 pb-2 flex items-center gap-2">
              <Music2 className="w-4 h-4" /> Instrumentation & Voices
            </h3>
            <div className="space-y-3">
              <div>
                <span className="block text-xs font-semibold text-muted-foreground mb-1">Instruments</span>
                <div className="flex flex-wrap gap-1.5">
                  {m.instruments?.map(inst => (
                    <span key={inst} className="text-xs px-2 py-1 bg-secondary/50 rounded-md font-medium text-secondary-foreground">{inst}</span>
                  ))}
                </div>
              </div>
              <div>
                <span className="block text-xs font-semibold text-muted-foreground mb-1">Voices</span>
                <div className="flex flex-wrap gap-1.5">
                  {m.voices?.map(voice => (
                    <span key={voice} className="text-xs px-2 py-1 bg-brand-blue/10 text-brand-blue rounded-md font-medium">{voice}</span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {(!!m.maqamat?.length || !!m.iqaat?.length || !!m.ornamentation) && (
            <section className="space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border/50 pb-2 flex items-center gap-2">
                <Dna className="w-4 h-4" /> Musical DNA
              </h3>
              {m.maqamat && m.maqamat.length > 0 && (
                <div>
                  <span className="block text-xs font-semibold text-muted-foreground mb-1.5">Maqamat</span>
                  <div className="flex flex-col gap-1">
                    {m.maqamat.map((maq) => (
                      <span
                        key={maq}
                        className="text-xs px-2.5 py-1.5 bg-brand-blue/10 text-brand-blue rounded-md font-medium leading-snug"
                      >
                        {maq}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {m.iqaat && m.iqaat.length > 0 && (
                <div>
                  <span className="block text-xs font-semibold text-muted-foreground mb-1.5">Iqa'at</span>
                  <div className="flex flex-wrap gap-1.5">
                    {m.iqaat.map((iqa) => (
                      <span
                        key={iqa}
                        className="text-xs px-2.5 py-1 bg-secondary/70 text-secondary-foreground rounded-full font-medium border border-border/40"
                      >
                        {iqa}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {m.ornamentation && (
                <div>
                  <span className="block text-xs font-semibold text-muted-foreground mb-1">Ornamentation</span>
                  <p className="text-xs text-foreground/80 leading-relaxed">{m.ornamentation}</p>
                </div>
              )}
            </section>
          )}

          {(m.relatedSubjects?.length > 0 || m.relatedWorks?.length > 0) && (
            <section className="space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border/50 pb-2 flex items-center gap-2">
                <ListMusic className="w-4 h-4" /> Relations
              </h3>
              {m.relatedSubjects && m.relatedSubjects.length > 0 && (
                <div>
                  <span className="block text-xs font-semibold text-muted-foreground mb-1">Subjects</span>
                  <div className="flex flex-wrap gap-1.5">
                    {m.relatedSubjects.map(sub => (
                      <span key={sub} className="text-xs px-2 py-1 border border-border/60 rounded-md text-muted-foreground">{sub}</span>
                    ))}
                  </div>
                </div>
              )}
              {m.relatedWorks && m.relatedWorks.length > 0 && (
                <div className="pt-2">
                  <span className="block text-xs font-semibold text-muted-foreground mb-1">Related Works</span>
                  <ul className="list-disc list-inside text-sm text-foreground/80 pl-2 space-y-1">
                    {m.relatedWorks.map(work => (
                      <li key={work}>{work}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Right Column: Deep text & Track */}
        <div className="lg:col-span-2 space-y-12">
          
          {/* History & Subject */}
          <section className="prose prose-invert max-w-none">
            <h2 className="flex items-center gap-2 text-2xl font-bold border-b border-border pb-2 mb-4">
              <BookOpen className="w-5 h-5 text-brand-blue" />
              Historical Context
            </h2>
            <p className="text-lg leading-relaxed text-foreground/90">{m.history}</p>
            
            <h3 className="text-lg font-bold mt-6">Primary Subject</h3>
            <p className="text-foreground/80">{m.subject}</p>
          </section>

          {/* Lyrics & Pronunciation */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-card rounded-xl p-6 md:p-8 border border-border/50 shadow-sm">
            <div>
              <h2 className="flex items-center gap-2 font-serif text-xl mb-4 text-foreground">
                <FileText className="w-5 h-5 text-brand-blue" />
                Transcription
              </h2>
              <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground/80 bg-background/50 p-4 rounded-lg border border-border/30">
                {m.transcription || "No transcription available."}
              </div>
            </div>
            <div>
              <h2 className="flex items-center gap-2 font-serif text-xl mb-4 text-foreground">
                <Languages className="w-5 h-5 text-brand-blue" />
                Pronunciation
              </h2>
              <div className="prose prose-sm prose-invert max-w-none text-foreground/80">
                <p>{m.pronunciationNotes || "No pronunciation notes available."}</p>
              </div>
            </div>
          </section>

          {/* Track Breakdown */}
          <section>
            <h2 className="flex items-center gap-2 font-serif text-2xl border-b border-border/50 pb-2 mb-8">
              <Clock className="w-5 h-5 text-brand-blue" />
              Interval Breakdown
            </h2>
            <Timeline segments={m.track || []} />
          </section>

        </div>
      </div>
    </div>
  );
}
