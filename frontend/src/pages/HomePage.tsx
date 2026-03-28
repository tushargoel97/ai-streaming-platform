import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play, Info, Loader2 } from "lucide-react";
import Hls from "hls.js";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import CarouselRow from "@/components/video/CarouselRow";
import type { Video } from "@/types/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RecommendationSection {
  title: string;
  videos: Video[];
}

interface PersonalizedFeedResponse {
  sections: RecommendationSection[];
}

// ── Hero Banner ────────────────────────────────────────────────────────────────

function HeroBanner({ video }: { video: Video }) {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [showTrailer, setShowTrailer] = useState(false);

  useEffect(() => {
    if (!video.manifest_url) return;
    // Auto-play muted trailer after 2s delay
    const timer = setTimeout(() => setShowTrailer(true), 2000);
    return () => clearTimeout(timer);
  }, [video.manifest_url]);

  useEffect(() => {
    if (!showTrailer || !video.manifest_url || !videoRef.current) return;
    const el = videoRef.current;
    const isHls = video.manifest_url.endsWith(".m3u8");

    if (!isHls) {
      // Direct MP4 playback
      el.src = video.manifest_url;
      el.play().catch(() => {});
      return () => { el.removeAttribute("src"); el.load(); };
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ maxBufferLength: 10, startLevel: 0 });
      hls.loadSource(video.manifest_url);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        el.play().catch(() => {});
      });
      hlsRef.current = hls;
      return () => hls.destroy();
    } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = video.manifest_url;
      el.play().catch(() => {});
    }
  }, [showTrailer, video.manifest_url]);

  return (
    <section className="relative flex h-[75vh] items-end overflow-hidden">
      {/* Background: poster or trailer */}
      {showTrailer && video.manifest_url ? (
        <video
          ref={videoRef}
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: video.thumbnail_url
              ? `url(${video.thumbnail_url})`
              : undefined,
            backgroundColor: "#111",
          }}
        />
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg)]/80 to-transparent" />

      {/* Content */}
      <div className="relative z-10 max-w-2xl px-12 pb-20">
        <h1 className="text-5xl font-bold leading-tight">{video.title}</h1>
        {video.description && (
          <p className="mt-3 line-clamp-3 text-lg text-gray-300">
            {video.description}
          </p>
        )}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => navigate(`/watch/${video.id}`)}
            className="flex items-center gap-2 rounded bg-white px-8 py-2.5 font-semibold text-black transition-opacity hover:opacity-80"
          >
            <Play size={20} className="fill-current" /> Play
          </button>
          <Link
            to={`/watch/${video.id}`}
            className="flex items-center gap-2 rounded bg-white/20 px-6 py-2.5 font-semibold backdrop-blur-sm transition-colors hover:bg-white/30"
          >
            <Info size={20} /> More Info
          </Link>
        </div>
        <div className="mt-3 flex items-center gap-3 text-sm text-gray-400">
          {video.view_count > 0 && (
            <span>{video.view_count.toLocaleString()} views</span>
          )}
          {video.tags.length > 0 && (
            <span>{video.tags.slice(0, 3).join(" · ")}</span>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Home Page ──────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { isAuthenticated } = useAuthStore();
  const [sections, setSections] = useState<RecommendationSection[]>([]);
  const [heroVideo, setHeroVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);

  // Collect all video IDs for watch progress
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

        // Pick hero from featured or first section
        const featured = feed.sections.find((s) => s.title === "Featured");
        const heroSource = featured ?? feed.sections[0];
        if (heroSource && heroSource.videos.length > 0) {
          setHeroVideo(heroSource.videos[0] ?? null);
        }
      } catch {
        // Fallback: try trending directly
        try {
          const trending = await api.get<Video[]>("/videos/trending");
          setSections([{ title: "Trending Now", videos: trending }]);
          if (trending.length > 0) setHeroVideo(trending[0] ?? null);
        } catch { /* ignore */ }
      } finally {
        setLoading(false);
      }
    };

    fetchFeed();
  }, [isAuthenticated]);

  if (loading) {
    return (
      <div className="flex items-center justify-center pt-32">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div>
      {/* Hero */}
      {heroVideo && <HeroBanner video={heroVideo} />}

      {/* Recommendation rows */}
      <div className="-mt-16 relative z-10">
        {sections.map((section) => (
          <CarouselRow
            key={section.title}
            title={section.title}
            videos={section.videos}
            progress={progressMap}
          />
        ))}
      </div>
    </div>
  );
}
