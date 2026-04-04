import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Play, Plus, Check, ChevronDown } from "lucide-react";
import Hls from "hls.js";
import type { Video, Series, Season } from "@/types/api";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";

interface Props {
  video: Video;
  onClose: () => void;
}

interface VideoSummary {
  id: string;
  title: string;
  description: string;
  duration: number;
  thumbnail_url: string;
  tags: string[];
  imdb_rating?: number | null;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Mute / Unmute SVGs ────────────────────────────────────────────────────────
const MuteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zm-8.71-6.29l-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12A4.5 4.5 0 0014 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z" />
  </svg>
);
const UnmuteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
);

// ── Icon button ───────────────────────────────────────────────────────────────
function CircleBtn({
  onClick, title, children,
}: { onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-9 w-9 items-center justify-center rounded-full border text-white transition-all hover:border-white hover:bg-white/10"
      style={{ borderColor: "rgba(255,255,255,0.5)" }}
    >
      {children}
    </button>
  );
}

// ── Episode row ───────────────────────────────────────────────────────────────
function EpisodeRow({ ep, onClick }: { ep: Video; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-4 rounded-lg p-3 text-left transition-colors hover:bg-white/5"
    >
      {/* Number */}
      <span className="w-6 flex-shrink-0 pt-1 text-lg font-bold text-gray-400">
        {ep.episode_number ?? ""}
      </span>

      {/* Thumbnail */}
      <div
        className="relative flex-shrink-0 overflow-hidden rounded"
        style={{ width: 120, height: 68 }}
      >
        {ep.thumbnail_url ? (
          <img src={ep.thumbnail_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-white/10" />
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity hover:opacity-100"
          style={{ background: "rgba(0,0,0,0.5)" }}>
          <Play size={20} className="fill-white text-white" />
        </div>
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-white">{ep.title}</span>
          {ep.duration > 0 && (
            <span className="flex-shrink-0 text-xs text-gray-500">{formatDuration(ep.duration)}</span>
          )}
        </div>
        {ep.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-400">{ep.description}</p>
        )}
      </div>
    </button>
  );
}

// ── Similar video card ────────────────────────────────────────────────────────
function SimilarCard({ v, onClick }: { v: VideoSummary; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-md text-left transition-transform hover:scale-[1.03]"
      style={{ background: "#2a2a2a" }}
    >
      <div className="relative aspect-video w-full overflow-hidden">
        {v.thumbnail_url ? (
          <img src={v.thumbnail_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-white/5" />
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
            <Play size={18} className="fill-white text-white" />
          </div>
        </div>
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-white line-clamp-1">{v.title}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
          {v.imdb_rating != null && (
            <span className="font-bold text-yellow-400">★ {v.imdb_rating.toFixed(1)}</span>
          )}
          {v.duration > 0 && <span>{formatDuration(v.duration)}</span>}
        </div>
        {v.description && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-gray-500">{v.description}</p>
        )}
      </div>
    </button>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function VideoDetailModal({ video, onClose }: Props) {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [muted, setMuted] = useState(true);
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  // Series state
  const [series, setSeries] = useState<Series | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [episodes, setEpisodes] = useState<Video[]>([]);
  const [seasonDropOpen, setSeasonDropOpen] = useState(false);

  // Similar videos (movies)
  const [similar, setSimilar] = useState<VideoSummary[]>([]);

  const isSeries = Boolean(video.series_id);
  const year = video.published_at ? new Date(video.published_at).getFullYear() : null;

  // Lock scroll + Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // HLS preview
  useEffect(() => {
    if (!video.manifest_url || !videoRef.current) return;
    const el = videoRef.current;
    if (!video.manifest_url.endsWith(".m3u8")) {
      el.src = video.manifest_url;
      el.play().catch(() => {});
      return () => { el.removeAttribute("src"); el.load(); };
    }
    if (Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 10, startLevel: 0 });
      hls.loadSource(video.manifest_url);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, () => el.play().catch(() => {}));
      return () => hls.destroy();
    } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = video.manifest_url;
      el.play().catch(() => {});
    }
  }, [video.manifest_url]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Watchlist
  useEffect(() => {
    if (!isAuthenticated) return;
    api.get<{ in_watchlist: boolean }>(`/watchlist/${video.id}/status`)
      .then((r) => setInWatchlist(r.in_watchlist))
      .catch(() => {});
  }, [video.id, isAuthenticated]);

  // Series: load seasons then default season's episodes
  useEffect(() => {
    if (!isSeries || !video.series_id) return;
    api.get<Series>(`/series/${video.series_id}`)
      .then((s) => {
        setSeries(s);
        // Default to the season this episode belongs to, or first season
        const defaultSeason =
          s.seasons?.find((se) => se.id === video.season_id) ?? s.seasons?.[0] ?? null;
        setSelectedSeason(defaultSeason);
      })
      .catch(() => {});
  }, [isSeries, video.series_id, video.season_id]);

  // Load episodes when season changes
  useEffect(() => {
    if (!selectedSeason || !video.series_id) return;
    api.get<Video[]>(`/series/${video.series_id}/seasons/${selectedSeason.id}/episodes`)
      .then(setEpisodes)
      .catch(() => {});
  }, [selectedSeason, video.series_id]);

  // Movie: load similar
  useEffect(() => {
    if (isSeries) return;
    api.get<VideoSummary[]>(`/recommendations/similar/${video.id}`, { limit: "12" })
      .then(setSimilar)
      .catch(() => {});
  }, [isSeries, video.id]);

  const toggleWatchlist = async () => {
    if (!isAuthenticated || watchlistLoading) return;
    setWatchlistLoading(true);
    try {
      if (inWatchlist) {
        await api.delete(`/watchlist/${video.id}`);
        setInWatchlist(false);
      } else {
        await api.post(`/watchlist/${video.id}`, {});
        setInWatchlist(true);
      }
    } catch { /* ignore */ } finally {
      setWatchlistLoading(false);
    }
  };

  return (
    /* Backdrop — click outside closes */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.75)", paddingTop: "2vh", paddingBottom: "2vh" }}
      onClick={onClose}
    >
      {/* Modal card */}
      <div
        className="relative mx-auto w-full rounded-xl shadow-2xl"
        style={{ maxWidth: "860px", background: "#181818", minHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Hero ─────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-t-xl" style={{ aspectRatio: "16/9" }}>
          {video.manifest_url ? (
            <video
              ref={videoRef}
              muted={muted}
              loop
              playsInline
              poster={video.thumbnail_url || undefined}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage: video.thumbnail_url ? `url(${video.thumbnail_url})` : undefined,
                backgroundColor: "#111",
              }}
            />
          )}

          {/* gradient */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, #181818 0%, rgba(24,24,24,0.5) 45%, rgba(24,24,24,0.05) 80%, transparent 100%)",
            }}
          />

          {/* Close */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full text-white"
            style={{ background: "rgba(24,24,24,0.95)" }}
          >
            <X size={18} />
          </button>

          {/* Title */}
          <div className="absolute bottom-20 left-6 right-6 z-10">
            <h2 className="text-3xl font-black leading-tight text-white drop-shadow-lg">
              {series?.title ?? video.title}
            </h2>
          </div>

          {/* Controls */}
          <div className="absolute bottom-5 left-6 right-6 z-10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(`/watch/${video.id}`)}
                className="flex items-center gap-2 rounded px-6 py-2 text-sm font-bold text-black transition-all hover:bg-gray-100 active:scale-95"
                style={{ background: "#fff" }}
              >
                <Play size={16} className="fill-current" />
                Play
              </button>
              {isAuthenticated && (
                <CircleBtn onClick={toggleWatchlist} title={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}>
                  {inWatchlist ? <Check size={16} /> : <Plus size={16} />}
                </CircleBtn>
              )}
            </div>
            {video.manifest_url && (
              <CircleBtn onClick={() => setMuted((m) => !m)} title={muted ? "Unmute" : "Mute"}>
                {muted ? <MuteIcon /> : <UnmuteIcon />}
              </CircleBtn>
            )}
          </div>
        </div>

        {/* ── Body (scrollable) ─────────────────────────────────── */}
        <div className="px-6 pb-10 pt-5" ref={scrollRef}>
          {/* Meta */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {video.imdb_rating != null && (
              <span className="font-bold text-yellow-400">★ {video.imdb_rating.toFixed(1)}</span>
            )}
            {year && <span className="text-gray-400">{year}</span>}
            {isSeries && series?.seasons && (
              <span className="text-gray-400">{series.seasons.length} Season{series.seasons.length !== 1 ? "s" : ""}</span>
            )}
            {!isSeries && video.duration > 0 && (
              <span className="text-gray-400">{formatDuration(video.duration)}</span>
            )}
            {video.source_height != null && video.source_height >= 720 && (
              <span
                className="rounded border px-1 py-0.5 text-[10px] font-semibold"
                style={{ borderColor: "rgba(255,255,255,0.3)", color: "rgba(255,255,255,0.6)" }}
              >
                HD
              </span>
            )}
          </div>

          {/* Description */}
          {video.description && (
            <p className="mt-3 text-sm leading-relaxed text-gray-300">{video.description}</p>
          )}

          {/* Tags */}
          {video.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {video.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-sm px-2 py-0.5 text-xs text-gray-400"
                  style={{ background: "rgba(255,255,255,0.08)" }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* ── Episodes (series) ─────────────────────────────── */}
          {isSeries && series && (
            <div className="mt-8">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">Episodes</h3>

                {/* Season picker */}
                {series.seasons && series.seasons.length > 1 && (
                  <div className="relative">
                    <button
                      onClick={() => setSeasonDropOpen((o) => !o)}
                      className="flex items-center gap-2 rounded border px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-white/5"
                      style={{ borderColor: "rgba(255,255,255,0.3)" }}
                    >
                      {selectedSeason
                        ? (selectedSeason.title || `Season ${selectedSeason.season_number}`)
                        : "Season"}
                      <ChevronDown size={14} />
                    </button>
                    {seasonDropOpen && (
                      <div
                        className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border shadow-xl"
                        style={{ background: "#2a2a2a", borderColor: "rgba(255,255,255,0.1)" }}
                      >
                        {series.seasons.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => { setSelectedSeason(s); setSeasonDropOpen(false); }}
                            className={`w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-white/10 ${selectedSeason?.id === s.id ? "text-white font-semibold" : "text-gray-300"}`}
                          >
                            {s.title || `Season ${s.season_number}`}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                {episodes.map((ep) => (
                  <EpisodeRow
                    key={ep.id}
                    ep={ep}
                    onClick={() => navigate(`/watch/${ep.id}`)}
                  />
                ))}
                {episodes.length === 0 && (
                  <p className="py-6 text-center text-sm text-gray-500">No episodes found.</p>
                )}
              </div>
            </div>
          )}

          {/* ── More Like This (movies) ───────────────────────── */}
          {!isSeries && similar.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-4 text-lg font-bold text-white">More Like This</h3>
              <div className="grid grid-cols-3 gap-3">
                {similar.map((v) => (
                  <SimilarCard
                    key={v.id}
                    v={v}
                    onClick={() => { onClose(); navigate(`/watch/${v.id}`); }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
