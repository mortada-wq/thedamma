import { ReactNode } from "react";
import { Link } from "wouter";
import { useExportAllSongs, getExportAllSongsQueryKey } from "@workspace/api-client-react";
import { downloadJson } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Download, LayoutGrid, Settings2 } from "lucide-react";
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

      {/* ── Logo bar ── */}
      <div className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="container mx-auto px-4 h-28 flex items-center justify-center">
          <Link href="/" aria-label="مضمام صاحب" className="flex flex-col items-center gap-1 transition-opacity hover:opacity-80">
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 68 69"
              className="h-[76px] w-auto"
              fill="none"
            >
              <defs>
                <linearGradient id="logoGrad" x1="34" y1="0" x2="34" y2="69" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#93C5FD" />
                  <stop offset="100%" stopColor="#2563EB" />
                </linearGradient>
              </defs>
              <path d="M67.7039 13.1701L67.4381 12.8825C66.6928 22.4599 61.8895 31.8781 53.028 41.1371C56.2216 44.4954 57.7587 47.6963 57.6393 50.7399C57.5272 53.599 56.1437 55.9002 53.4889 57.6435C52.214 54.8223 49.0258 51.3256 43.9243 47.1535C36.3668 53.7849 27.1003 59.2407 16.1249 63.521C7.77534 66.7959 2.77049 68.4008 1.11036 68.3357C0.372525 68.3067 0.0108443 68.1078 0.0253188 67.7389C-0.544297 65.7767 8.56485 59.6219 27.3528 49.2745C32.2609 46.6035 36.149 44.0311 39.0173 41.5572C37.8436 40.8646 36.0235 38.9919 33.5568 35.9393C30.4808 31.939 28.9012 28.644 28.818 26.0543C28.8471 20.6056 32.9559 14.7626 41.1446 8.52552C49.0493 2.46203 55.8111 -0.367123 61.4299 0.038073C66.1263 0.407082 68.2177 4.78441 67.7039 13.1701ZM56.3813 19.238C56.5188 15.7333 54.6173 13.5803 50.6767 12.7791C48.4813 12.2311 46.1222 12.3233 43.5994 13.0557C40.7005 13.958 39.0268 15.4165 38.5783 17.4311C38.1732 18.3389 37.9525 19.2539 37.9163 20.1762C37.7752 23.7732 39.6098 27.6324 43.4201 31.7539C43.9445 32.5134 44.9156 33.66 46.3334 35.1935C47.3985 33.9421 48.7938 32.5189 50.519 30.9239C50.9169 30.2006 51.8456 28.8976 53.305 27.0151L53.3159 26.7384C55.2799 23.7672 56.3017 21.2671 56.3813 19.238Z" fill="url(#logoGrad)"/>
            </svg>
            <span
              style={{ fontFamily: "'Muna', 'IBM Plex Sans Arabic', 'Tajawal', sans-serif" }}
              className="text-[22px] font-medium tracking-wide text-muted-foreground leading-none"
              dir="rtl"
            >
              مضمام صاحب
            </span>
          </Link>
        </div>

        {/* ── Nav bar ── */}
        <div className="border-t border-border/50">
          <div className="container mx-auto px-4 h-11 flex items-center justify-center gap-3">
            <Link href="/rag-grid">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-xs font-medium rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary active:scale-[0.98] transition-transform h-7 px-3"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                RAG Grid
              </Button>
            </Link>
            <div className="w-px h-4 bg-border" />
            <Link href="/admin">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-xs font-medium rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary active:scale-[0.98] transition-transform h-7 px-3"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Admin
              </Button>
            </Link>
            <div className="w-px h-4 bg-border" />
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-xs font-medium rounded-full text-brand-blue hover:bg-brand-blue/10 active:scale-[0.98] transition-transform h-7 px-3"
              onClick={handleExportLibrary}
              data-testid="button-export-library"
            >
              <Download className="w-3.5 h-3.5" />
              Export RAG Library
            </Button>
          </div>
        </div>
      </div>

      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
