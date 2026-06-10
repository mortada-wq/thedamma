import { Song } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Globe, Clock, Music2, FileText, ImageIcon, ArrowLeft } from "lucide-react";

type CardType = "music" | "image" | "text";

function getCardType(inputType: string): CardType {
  if (inputType === "image") return "image";
  if (inputType === "writing" || inputType === "text") return "text";
  return "music";
}

const TYPE_CONFIG: Record<CardType, {
  borderColor: string;
  accentBg: string;
  accentText: string;
  topBar: string;
  icon: React.ReactNode;
  label: string;
}> = {
  music: {
    borderColor: "border-brand-blue/30 hover:border-brand-blue/60",
    accentBg: "bg-brand-blue/10",
    accentText: "text-brand-blue",
    topBar: "from-brand-blue/20 to-transparent",
    icon: <Music2 className="w-3 h-3" />,
    label: "موسيقى",
  },
  image: {
    borderColor: "border-amber-500/30 hover:border-amber-500/60",
    accentBg: "bg-amber-500/10",
    accentText: "text-amber-400",
    topBar: "from-amber-500/20 to-transparent",
    icon: <ImageIcon className="w-3 h-3" />,
    label: "صورة",
  },
  text: {
    borderColor: "border-emerald-500/30 hover:border-emerald-500/60",
    accentBg: "bg-emerald-500/10",
    accentText: "text-emerald-400",
    topBar: "from-emerald-500/20 to-transparent",
    icon: <FileText className="w-3 h-3" />,
    label: "كتابة",
  },
};

const ARABIC_FONT: React.CSSProperties = {
  fontFamily: "'Muna', 'IBM Plex Sans Arabic', 'Tajawal', 'Scheherazade New', sans-serif",
};

function shortOverview(song: Song): string {
  const subject = song.metadata?.subject;
  const history = song.metadata?.history;
  const text = (subject && subject.trim()) || (history && history.trim()) || "";
  if (!text) return "";
  const firstSentence = text.split(/[.!?؟]/)[0]?.trim();
  return firstSentence && firstSentence.length > 5 ? firstSentence : text.slice(0, 120);
}

export function SongCard({ song, style, className }: { song: Song; style?: React.CSSProperties; className?: string }) {
  const cardType = getCardType(song.inputType);
  const cfg = TYPE_CONFIG[cardType];
  const overview = shortOverview(song);

  return (
    <Link
      href={`/song/${song.id}`}
      className={`group block h-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-2xl${className ? ` ${className}` : ""}`}
      style={style}
    >
      <div
        className={`relative h-full bg-card border ${cfg.borderColor} rounded-2xl overflow-hidden flex flex-col shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5`}
      >
        {/* top color bar */}
        <div className={`h-1 w-full bg-gradient-to-r ${cfg.topBar}`} />

        {/* type badge */}
        <div className="px-4 pt-3 flex items-center justify-end">
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${cfg.accentBg} ${cfg.accentText} border border-current/20`}
            style={ARABIC_FONT}
          >
            {cfg.icon}
            {cfg.label}
          </span>
        </div>

        {/* main content */}
        <div className="px-4 pb-4 pt-2 flex flex-col flex-1">
          {/* title — Arabic only */}
          <h3
            className={`font-bold text-xl leading-snug text-foreground line-clamp-2 group-hover:${cfg.accentText} transition-colors mb-1`}
            dir="rtl"
            style={ARABIC_FONT}
          >
            {song.title}
          </h3>

          {/* singer — Arabic font, muted */}
          <p
            className="text-sm text-muted-foreground mb-3 truncate"
            dir="rtl"
            style={ARABIC_FONT}
          >
            {song.singer}
          </p>

          {/* short Arabic overview */}
          {overview && (
            <p
              className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-3 mb-4 flex-1"
              dir="rtl"
              style={ARABIC_FONT}
            >
              {overview}
            </p>
          )}

          {/* meta row */}
          <div className="mt-auto space-y-1.5 pt-3 border-t border-border/40">
            <div className="flex items-center gap-2 text-xs text-muted-foreground" dir="rtl">
              <Clock className="w-3 h-3 opacity-60 shrink-0" />
              <span className="truncate">{song.era}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground" dir="rtl">
              <Globe className="w-3 h-3 opacity-60 shrink-0" />
              <span className="truncate">{song.geography}</span>
            </div>
          </div>

          {/* hover cta */}
          <div className="mt-3 flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className={`text-xs font-semibold ${cfg.accentText} uppercase tracking-wider`}
              style={ARABIC_FONT}
            >
              عرض الملف
            </span>
            <ArrowLeft className={`w-3.5 h-3.5 ${cfg.accentText}`} />
          </div>
        </div>
      </div>
    </Link>
  );
}
