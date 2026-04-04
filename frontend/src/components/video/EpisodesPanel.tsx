import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { X, Play, Search } from "lucide-react";
import type { Video } from "@/types/api";

interface EpisodesPanelProps {
  episodes: Video[];
  currentVideoId: string;
  progress: Record<string, { progress: number; percentage: number }>;
  seasonNumber?: number;
  seasonDescription?: string;
  autoNext: boolean;
  onAutoNextToggle: () => void;
  onClose: () => void;
}

function timeLeft(ep: Video, progressSeconds?: number): string {
  if (!ep.duration) return "";
  const watched = progressSeconds ?? 0;
  const remaining = Math.max(0, ep.duration - watched);
  const mins = Math.round(remaining / 60);
  if (mins <= 0) return "Finished";
  return `${mins}m left`;
}

export default function EpisodesPanel({
  episodes,
  currentVideoId,
  progress,
  seasonNumber,
  seasonDescription,
  autoNext,
  onAutoNextToggle,
  onClose,
}: EpisodesPanelProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  // Scroll current episode into view on open
  useEffect(() => {
    const el = currentRef.current;
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const filtered = query
    ? episodes.filter((e) => e.title.toLowerCase().includes(query.toLowerCase()))
    : episodes;

  return (
    <div
      className="absolute inset-y-0 right-0 z-30 flex w-[320px] flex-col"
      style={{ background: "rgba(10,10,10,0.96)", backdropFilter: "blur(14px)" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
        {/* Search */}
        {searchOpen ? (
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search episodes…"
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
            onBlur={() => { if (!query) setSearchOpen(false); }}
          />
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="text-gray-400 transition-colors hover:text-white"
          >
            <Search size={15} />
          </button>
        )}

        <div className="flex-1" />

        {/* Season label */}
        {seasonNumber != null && (
          <span className="text-sm font-semibold text-white">S{seasonNumber}</span>
        )}

        {/* Auto next toggle */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-400">Auto next</span>
          <button
            onClick={onAutoNextToggle}
            className={`relative h-5 w-9 rounded-full transition-colors ${autoNext ? "bg-white" : "bg-white/20"}`}
            title={autoNext ? "Auto next: On" : "Auto next: Off"}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-black transition-transform duration-200 ${
                autoNext ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-[11px] text-gray-400">{autoNext ? "ON" : "OFF"}</span>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="ml-1 text-gray-400 transition-colors hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Season description ──────────────────────────────────── */}
      {seasonDescription && (
        <p className="flex-shrink-0 px-4 py-3 text-xs leading-relaxed text-gray-400 line-clamp-3 border-b border-white/5">
          {seasonDescription}
        </p>
      )}

      {/* ── Episode list ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-1">
        {filtered.map((ep) => {
          const isCurrent = ep.id === currentVideoId;
          const isHovered = hoveredId === ep.id && !isCurrent;
          const ep_progress = progress[ep.id];
          const expanded = isCurrent || isHovered;

          return (
            <div
              key={ep.id}
              ref={isCurrent ? currentRef : undefined}
              onMouseEnter={() => setHoveredId(ep.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => { if (!isCurrent) navigate(`/watch/${ep.id}`); }}
              className={`transition-all ${
                expanded
                  ? "px-3 py-2"
                  : "flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-white/5"
              }`}
            >
              {expanded ? (
                /* ── Expanded card ── */
                <div
                  className={`cursor-pointer overflow-hidden rounded-lg transition-all ${
                    isCurrent
                      ? "ring-2 ring-[var(--primary)]"
                      : "ring-1 ring-white/15 hover:ring-white/30"
                  }`}
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-video overflow-hidden bg-gray-900">
                    {ep.thumbnail_url ? (
                      <img
                        src={ep.thumbnail_url}
                        alt={ep.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-gray-700">
                        <Play size={24} />
                      </div>
                    )}

                    {/* Watching badge / hover play button */}
                    {isCurrent ? (
                      <span className="absolute bottom-2 left-2 rounded bg-[var(--primary)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                        Watching
                      </span>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-lg">
                          <Play size={18} className="ml-0.5 fill-black text-black" />
                        </div>
                      </div>
                    )}

                    {/* Progress bar */}
                    {ep_progress && ep_progress.percentage > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/20">
                        <div
                          className="h-full bg-[var(--primary)]"
                          style={{ width: `${Math.min(ep_progress.percentage, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Info below thumbnail */}
                  <div className="p-2.5" style={{ background: "#161616" }}>
                    <p className="text-sm font-semibold leading-snug text-white">
                      {ep.episode_number != null ? `${ep.episode_number}. ` : ""}
                      {ep.title}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {timeLeft(ep, ep_progress?.progress)}
                    </p>
                    {ep.description && (
                      <p className="mt-1.5 text-xs leading-relaxed text-gray-500 line-clamp-2">
                        {ep.description}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                /* ── Compact row ── */
                <>
                  {/* Small dim thumbnail */}
                  <div className="relative h-[42px] w-[75px] flex-shrink-0 overflow-hidden rounded bg-gray-900">
                    {ep.thumbnail_url ? (
                      <img
                        src={ep.thumbnail_url}
                        alt={ep.title}
                        className="h-full w-full object-cover opacity-40"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Play size={14} className="text-gray-700" />
                      </div>
                    )}
                  </div>

                  {/* Text */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-300">
                      {ep.episode_number != null ? `${ep.episode_number}. ` : ""}
                      {ep.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {timeLeft(ep, ep_progress?.progress)}
                    </p>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
