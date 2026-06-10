import { Song } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Globe, Clock, User, ArrowRight } from "lucide-react";

export function SongCard({ song, style, className }: { song: Song, style?: React.CSSProperties, className?: string }) {
  return (
    <Link href={`/song/${song.id}`} className={`group block h-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl${className ? ` ${className}` : ""}`} style={style}>
      <div className="h-full bg-card border border-border hover:border-primary/40 hover:bg-accent/40 rounded-xl p-5 transition-colors duration-150 ease-out flex flex-col shadow-sm">
        <div className="mb-4">
          <h3 className="font-song text-2xl font-bold text-foreground leading-tight line-clamp-2 group-hover:text-brand-blue transition-colors">
            {song.title}
          </h3>
          <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm font-medium">
            <User className="w-3.5 h-3.5" />
            {song.singer}
          </p>
        </div>
        
        <div className="mt-auto space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5 opacity-70" />
            <span className="truncate">{song.era}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe className="w-3.5 h-3.5 opacity-70" />
            <span className="truncate">{song.geography}</span>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-xs font-semibold text-brand-blue uppercase tracking-wider">
            View Dossier
          </span>
          <ArrowRight className="w-4 h-4 text-brand-blue" />
        </div>
      </div>
    </Link>
  );
}
