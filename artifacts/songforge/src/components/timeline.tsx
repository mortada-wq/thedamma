import { TrackSegment } from "@workspace/api-client-react";
import { Clock } from "lucide-react";

export function Timeline({ segments }: { segments: TrackSegment[] }) {
  if (!segments || segments.length === 0) return null;

  return (
    <div className="relative pl-6 sm:pl-8 py-2 border-l-2 border-border/50 space-y-12">
      {segments.map((segment, i) => (
        <div key={i} className="relative group">
          {/* Timeline dot */}
          <div className="absolute -left-[31px] sm:-left-[39px] w-4 h-4 rounded-full bg-background border-2 border-brand-blue/50 group-hover:border-brand-blue transition-colors flex items-center justify-center mt-1.5" />
          
          <div className="flex flex-col gap-1 mb-2">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center font-mono text-sm font-semibold text-brand-blue bg-brand-blue/10 px-2 py-0.5 rounded-md">
                <Clock className="w-3.5 h-3.5 mr-1" />
                {segment.timestamp}
              </span>
              <h4 className="font-serif text-lg font-bold text-foreground">
                {segment.label}
              </h4>
            </div>
          </div>

          <div className="bg-card border border-border/40 rounded-xl p-5 shadow-sm space-y-4">
            {segment.instruments && segment.instruments.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Instruments</h5>
                <div className="flex flex-wrap gap-1.5">
                  {segment.instruments.map(inst => (
                    <span key={inst} className="text-xs px-2.5 py-1 rounded-full bg-secondary/50 text-secondary-foreground border border-border/30">
                      {inst}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {segment.vocals && (
              <div>
                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Vocals</h5>
                <p className="text-sm text-foreground/90">{segment.vocals}</p>
              </div>
            )}

            {segment.notes && (
              <div>
                <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Musical Notes</h5>
                <p className="text-sm font-medium text-foreground/80 italic leading-relaxed">
                  {segment.notes}
                </p>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
