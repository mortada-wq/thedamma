import { ReactNode } from "react";
import { Link } from "wouter";
import { useExportAllSongs, getExportAllSongsQueryKey } from "@workspace/api-client-react";
import { downloadJson } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Download, Music, Library } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function Layout({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const { refetch } = useExportAllSongs({
    query: { enabled: false, queryKey: getExportAllSongsQueryKey() },
  });

  const handleExportLibrary = async () => {
    try {
      const result = await refetch();
      if (result.data) {
        downloadJson(result.data, "songforge-library.json");
        toast({
          title: "Library exported",
          description: `Exported ${result.data.count} songs successfully.`,
        });
      }
    } catch (e) {
      toast({
        title: "Export failed",
        description: "Could not export the library. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col relative">
      <div className="noise-overlay" />
      <header className="sticky top-0 z-40 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
              <Music className="w-5 h-5" />
            </div>
            <span className="font-serif text-xl font-bold tracking-tight text-foreground">
              SongForge
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 font-medium"
              onClick={handleExportLibrary}
              data-testid="button-export-library"
            >
              <Download className="w-4 h-4 text-muted-foreground" />
              Export RAG Library
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
