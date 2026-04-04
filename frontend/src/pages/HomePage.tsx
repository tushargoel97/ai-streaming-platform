import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play, Info } from "lucide-react";
import Hls from "hls.js";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import CarouselRow from "@/components/video/CarouselRow";
import VideoDetailModal from "@/components/video/VideoDetailModal";
import type { Video } from "@/types/api";

interface RecommendationSection {
  title: string;
  videos: Video[];
}

interface PersonalizedFeedResponse {
  sections: RecommendationSection[];
}

const HERO_DURATION = 25_000; // ms each hero slot stays

// ── Hero Banner ────────────────────────────────────────────────────────────────

function HeroBanner({
  video,
  onSeeMore,
  onPause,
  onResume,
}: {
  video: Video;
  onSeeMore: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [muted, setMuted] = useState(true);

  // Brief delay before starting video so thumbnail is visible first
  useEffect(() => {
    if (!video.manifest_url) return;
    const timer = setTimeout(() => setShowTrailer(true), 1500);
    return () => clearTimeout(timer);
  }, [video.manifest_url]);

  useEffect(() => {
    if (!showTrailer || !video.manifest_url || !videoRef.current) return;
    const el = videoRef.current;
    const isHls = video.manifest_url.endsWith(".m3u8");

    if (!isHls) {
      el.src = video.manifest_url;
      el.play().catch(() => {});
      return () => { el.removeAttribute("src"); el.load(); };
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 10, startLevel: 0 });
      hls.loadSource(video.manifest_url);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { el.play().catch(() => {}); });
      hlsRef.current = hls;
      return () => hls.destroy();
    } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = video.manifest_url;
      el.play().catch(() => {});
    }
  }, [showTrailer, video.manifest_url]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const year = video.published_at ? new Date(video.published_at).getFullYear() : null;

  return (
    <section
      className="relative flex items-end overflow-hidden"
      style={{ height: "82vh", minHeight: "500px" }}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
    >
      {/* Background — thumbnail always present, video fades in on top */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-700"
        style={{
          backgroundImage: video.thumbnail_url ? `url(${video.thumbnail_url})` : undefined,
          backgroundColor: "#111",
        }}
      />
      {showTrailer && video.manifest_url && (
        <video
          ref={videoRef}
          muted={muted}
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/* Cinematic gradients */}
      <div className="absolute inset-0" style={{
        background: "linear-gradient(to top, #0a0a0a 0%, rgba(10,10,10,0.7) 40%, rgba(10,10,10,0.1) 70%, transparent 100%)",
      }} />
      <div className="absolute inset-0" style={{
        background: "linear-gradient(to right, rgba(10,10,10,0.9) 0%, rgba(10,10,10,0.5) 40%, transparent 75%)",
      }} />

      {/* Content */}
      <div className="relative z-10 max-w-2xl px-12 pb-24">
        <h1 className="text-5xl font-black leading-tight tracking-tight drop-shadow-2xl">
          {video.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {video.imdb_rating != null && (
            <span className="flex items-center gap-1 font-bold text-yellow-400">
              ★ {video.imdb_rating.toFixed(1)}
            </span>
          )}
          {(video.imdb_rating != null || year != null) && video.tags.length > 0 && (
            <span className="text-white/30">|</span>
          )}
          {year && <span className="text-gray-400">{year}</span>}
          {year && video.tags.length > 0 && <span className="text-white/30">|</span>}
          {video.tags.slice(0, 3).map((tag, i) => (
            <span key={tag} className="flex items-center gap-2 text-gray-300">
              {i > 0 && <span className="text-white/20">·</span>}
              {tag}
            </span>
          ))}
        </div>

        {video.description && (
          <p className="mt-3 line-clamp-3 max-w-md text-sm leading-relaxed text-gray-300/90">
            {video.description}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => navigate(`/watch/${video.id}`)}
            className="flex items-center gap-2 rounded px-8 py-2.5 text-sm font-bold text-black shadow-lg transition-all hover:bg-gray-100 active:scale-95"
            style={{ background: "#fff" }}
          >
            <Play size={18} className="fill-current" />
            Play
          </button>
          <button
            onClick={onSeeMore}
            className="flex items-center gap-2 rounded border border-white/30 bg-white/10 px-6 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-all hover:bg-white/20"
          >
            <Info size={17} />
            See More
          </button>
          {showTrailer && video.manifest_url && (
            <button
              onClick={() => setMuted((m) => !m)}
              className="ml-2 flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-black/40 text-white backdrop-blur-sm transition-all hover:bg-black/60"
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3.63 3.63a.996.996 0 000 1.41L7.29 8.7 7 9H4c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h3l3.29 3.29c.63.63 1.71.18 1.71-.71v-4.17l4.18 4.18c-.49.37-1.02.68-1.6.91-.36.15-.58.53-.58.92 0 .72.73 1.18 1.39.91.8-.33 1.55-.77 2.22-1.31l1.34 1.34a.996.996 0 101.41-1.41L5.05 3.63c-.39-.39-1.02-.39-1.42 0zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-3.83-2.4-7.11-5.78-8.4-.59-.23-1.22.23-1.22.86v.19c0 .38.25.71.61.85C17.18 6.54 19 9.06 19 12zm-8.71-6.29l-.17.17L12 7.76V6.41c0-.89-1.08-1.33-1.71-.7zM16.5 12A4.5 4.5 0 0014 7.97v1.79l2.48 2.48c.01-.08.02-.16.02-.24z"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Dot indicators ─────────────────────────────────────────────────────────────

function HeroDots({
  count,
  active,
  progress,
  paused,
  onSelect,
}: {
  count: number;
  active: number;
  progress: number; // 0–1
  paused: boolean;
  onSelect: (i: number) => void;
}) {
  if (count <= 1) return null;
  return (
    <div className="absolute bottom-8 right-12 z-20 flex items-center gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          className="relative overflow-hidden rounded-full transition-all duration-300"
          style={{
            width: i === active ? 28 : 8,
            height: 4,
            background: i === active ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.25)",
          }}
        >
          {i === active && (
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${progress * 100}%`,
                background: "#fff",
                transition: paused ? "none" : "width 0.1s linear",
              }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Home Page ──────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { isAuthenticated } = useAuthStore();
  const [sections, setSections] = useState<RecommendationSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailVideo, setDetailVideo] = useState<Video | null>(null);

  // Hero rotation state
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroProgress, setHeroProgress] = useState(0); // 0–1
  const [heroPaused, setHeroPaused] = useState(false);
  const progressRef = useRef(0);
  const lastTickRef = useRef<number>(Date.now());
  const rafRef = useRef<number | null>(null);

  // Build hero candidate pool: first video from each section, deduped, max 8
  const heroCandidates = useMemo<Video[]>(() => {
    const seen = new Set<string>();
    const pool: Video[] = [];
    for (const section of sections) {
      for (const v of section.videos) {
        if (!seen.has(v.id) && v.status === "ready" && pool.length < 8) {
          seen.add(v.id);
          pool.push(v);
          break; // one per section to keep variety
        }
      }
    }
    return pool;
  }, [sections]);

  const heroVideo = heroCandidates[heroIndex] ?? null;

  // Progress ticker using rAF so it's smooth and pause-able
  const tick = useCallback(() => {
    if (heroCandidates.length <= 1) return;
    const now = Date.now();
    const elapsed = now - lastTickRef.current;
    lastTickRef.current = now;

    progressRef.current = Math.min(1, progressRef.current + elapsed / HERO_DURATION);
    setHeroProgress(progressRef.current);

    if (progressRef.current >= 1) {
      progressRef.current = 0;
      setHeroProgress(0);
      setHeroIndex((i) => (i + 1) % heroCandidates.length);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [heroCandidates.length]);

  useEffect(() => {
    if (heroCandidates.length <= 1 || heroPaused) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = Date.now();
      return;
    }
    lastTickRef.current = Date.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [heroCandidates.length, heroPaused, tick]);

  // Reset progress when index changes (including manual dot click)
  useEffect(() => {
    progressRef.current = 0;
    setHeroProgress(0);
    lastTickRef.current = Date.now();
  }, [heroIndex]);

  const handleDotSelect = (i: number) => {
    setHeroIndex(i);
  };

  const allVideoIds = useMemo(
    () => sections.flatMap((s) => s.videos.map((v) => v.id)),
    [sections],
  );
  const progressMap = useWatchProgress(allVideoIds);

  useEffect(() => {
    const fetchFeed = async () => {
      setLoading(true);
      try {
        const feed = await api.get<PersonalizedFeedResponse>(
          "/recommendations/personal",
          { limit: "20" },
        );
        setSections(feed.sections);
      } catch {
        try {
          const trending = await api.get<Video[]>("/videos/trending");
          if (trending.length > 0) {
            setSections([{ title: "Trending Now", videos: trending }]);
          }
        } catch { /* no content available */ }
      } finally {
        setLoading(false);
      }
    };
    fetchFeed();
  }, [isAuthenticated]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[var(--primary)]" />
      </div>
    );
  }

  if (!heroVideo && sections.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
        <p className="text-lg font-semibold text-white">Welcome</p>
        <p className="text-sm text-gray-500">
          {isAuthenticated ? "No content available yet." : "Sign in to get personalised recommendations."}
        </p>
        {!isAuthenticated && (
          <Link
            to="/login"
            className="mt-2 rounded px-6 py-2.5 text-sm font-semibold text-white"
            style={{ background: "var(--primary)" }}
          >
            Sign In
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Hero — key forces full remount on video change so HLS state resets */}
      {heroVideo && (
        <div className="relative">
          <HeroBanner
            key={heroVideo.id}
            video={heroVideo}
            onSeeMore={() => setDetailVideo(heroVideo)}
            onPause={() => setHeroPaused(true)}
            onResume={() => setHeroPaused(false)}
          />
          <HeroDots
            count={heroCandidates.length}
            active={heroIndex}
            progress={heroProgress}
            paused={heroPaused}
            onSelect={handleDotSelect}
          />
        </div>
      )}

      {/* Recommendation rows */}
      <div className="relative z-10 -mt-20">
        {sections.map((section) => {
          const isRanked = section.title.startsWith("Top 10");
          return (
            <CarouselRow
              key={section.title}
              title={section.title}
              videos={section.videos}
              progress={progressMap}
              ranked={isRanked}
            />
          );
        })}
      </div>

      {/* Detail modal */}
      {detailVideo && (
        <VideoDetailModal video={detailVideo} onClose={() => setDetailVideo(null)} />
      )}
    </div>
  );
}
