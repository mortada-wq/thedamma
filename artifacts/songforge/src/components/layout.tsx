import { ReactNode } from "react";
import { Link } from "wouter";
import { useExportAllSongs, getExportAllSongsQueryKey } from "@workspace/api-client-react";
import { downloadJson } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Download, LayoutGrid } from "lucide-react";
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
        downloadJson(result.data, "damma-library.json");
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
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" aria-label="ضمة" className="flex flex-col items-center justify-center gap-0.5 transition-opacity hover:opacity-80">
            <svg
              aria-hidden="true"
              viewBox="0 0 64 64"
              className="w-9 h-9 text-primary"
              fill="none"
              stroke="currentColor"
              strokeWidth={8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M41 18 C 50 21 51 34 42 37 C 33 40 23 35 24 27 C 25 20 32 16 41 18" />
              <path d="M34 37 C 32 47 25 52 16 53" />
            </svg>
            <span className="font-song text-foreground text-2xl leading-none">
              ضمة
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/rag-grid">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 font-medium rounded-full bg-transparent border-border text-muted-foreground hover:text-foreground hover:bg-secondary active:scale-[0.98] transition-transform"
              >
                <LayoutGrid className="w-4 h-4" />
                RAG Grid
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 font-medium rounded-full bg-transparent border-brand-blue/50 text-brand-blue hover:bg-brand-blue/10 hover:text-brand-blue active:scale-[0.98] transition-transform"
              onClick={handleExportLibrary}
              data-testid="button-export-library"
            >
              <Download className="w-4 h-4" />
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
