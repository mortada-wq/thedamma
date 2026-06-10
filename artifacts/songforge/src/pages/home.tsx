import { useGetSongStats, useListSongs } from "@workspace/api-client-react";
import { GenerateForm } from "@/components/generate-form";
import { SongCard } from "@/components/song-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Library, Activity } from "lucide-react";

export function Home() {
  const { data: stats, isLoading: statsLoading } = useGetSongStats();
  const { data: songs, isLoading: songsLoading } = useListSongs();

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-8 min-w-0">
        <GenerateForm />

        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <h2 className="text-xl font-serif font-bold text-foreground flex items-center gap-2">
              <Library className="w-5 h-5 text-primary" />
              Archive Library
            </h2>
            <div className="text-sm font-medium text-muted-foreground">
              {songsLoading ? <Skeleton className="w-16 h-5" /> : `${songs?.length || 0} Entries`}
            </div>
          </div>

          {songsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          ) : songs && songs.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {songs.map((song, i) => (
                <SongCard 
                  key={song.id} 
                  song={song} 
                  style={{ animationDelay: `${i * 50}ms` }} 
                  className="animate-in-stagger"
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-20 px-4 border border-dashed border-border/60 rounded-xl bg-card/50">
              <p className="text-muted-foreground">The archive is empty. Begin by cataloging a song above.</p>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar Area */}
      <div className="lg:w-80 shrink-0 space-y-6">
        <div className="bg-card rounded-xl border border-border/60 p-6 shadow-sm sticky top-24">
          <h3 className="font-serif text-lg font-bold border-b border-border/40 pb-3 mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Archive Stats
          </h3>
          
          {statsLoading ? (
            <div className="space-y-6">
              <Skeleton className="w-full h-16" />
              <Skeleton className="w-full h-16" />
              <Skeleton className="w-full h-16" />
            </div>
          ) : stats ? (
            <div className="space-y-6">
              <StatSection title="By Era" data={stats.byEra} />
              <StatSection title="By Geography" data={stats.byGeography} />
              <StatSection title="By Dialect" data={stats.byDialect} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatSection({ title, data }: { title: string, data: { label: string, count: number }[] }) {
  if (!data || data.length === 0) return null;
  
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h4>
      <div className="space-y-2">
        {data.map((item) => (
          <div key={item.label} className="flex items-center justify-between text-sm">
            <span className="text-foreground truncate pr-2">{item.label}</span>
            <span className="bg-muted px-2 py-0.5 rounded-full text-xs font-medium text-muted-foreground">
              {item.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
