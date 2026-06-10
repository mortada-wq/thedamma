import { Song } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Globe, Clock, User, ArrowRight } from "lucide-react";

export function SongCard({ song, style, className }: { song: Song, style?: React.CSSProperties, className?: string }) {
  return (
    <Link href={`/song/${song.id}`} className={`group block h-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl${className ? ` ${className}` : ""}`} style={style}>
      <div className="h-full bg-card border border-border/40 hover:border-primary/30 rounded-xl p-5 transition-all duration-300 hover:shadow-md flex flex-col hover:-translate-y-1">
        <div className="mb-4">
          <h3 className="font-serif text-xl font-bold text-foreground leading-tight line-clamp-2 group-hover:text-primary transition-colors">
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

        <div className="mt-4 pt-4 border-t border-border/30 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-xs font-semibold text-primary uppercase tracking-wider">
            View Dossier
          </span>
          <ArrowRight className="w-4 h-4 text-primary" />
        </div>
      </div>
    </Link>
  );
}
