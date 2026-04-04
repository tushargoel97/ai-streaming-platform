import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Loader2, Lock, CreditCard } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import { usePlayerSession } from "@/hooks/usePlayerSession";
import VideoPlayer from "@/components/video/VideoPlayer";
import EpisodesPanel from "@/components/video/EpisodesPanel";
import type { Video, Season } from "@/types/api";
import { formatDuration } from "@/lib/utils";

// ── Episode navigation type ──────────────────────────────────────────────────

interface EpisodeInfo {
  id: string;
  title: string;
  episode_number: number | null;
  thumbnail_path: string | null;
  thumbnail_url: string;
  duration: number;
}

interface AdjacentEpisodes {
  previous: EpisodeInfo | null;
  next: EpisodeInfo | null;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function WatchPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);

  // Episode navigation
  const [adjacentEpisodes, setAdjacentEpisodes] = useState<AdjacentEpisodes>({ previous: null, next: null });

  // Season episodes (for panel + carousel)
  const [seasonEpisodes, setSeasonEpisodes] = useState<Video[]>([]);
  const [currentSeason, setCurrentSeason] = useState<Season | null>(null);

  // Episodes panel
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [autoNext, setAutoNext] = useState(true);

  // Watch progress heartbeat
  const lastReportedRef = useRef(0);
  const [startTime, setStartTime] = useState(0);

  const episodeVideoIds = useMemo(() => seasonEpisodes.map((v) => v.id), [seasonEpisodes]);
  const episodeProgress = useWatchProgress(episodeVideoIds);

  // Player session WebSocket (viewer count + analytics heartbeat)
  const { updateTime: updateSessionTime } = usePlayerSession({
    videoId: id || "",
    enabled: !!id && !!video,
  });

  // ── Fetch video data ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    lastReportedRef.current = 0;

    const fetchData = async () => {
      try {
        const v = await api.get<Video>(`/videos/${id}`);
        setVideo(v);

        // Get resume position
        if (isAuthenticated) {
          try {
            const progressMap = await api.get<Record<string, { progress: number }>>("/watchProgress", {
              video_ids: id,
            });
            const entry = progressMap[id];
            if (entry && entry.progress > 5) {
              setStartTime(entry.progress);
            }
          } catch { /* ignore */ }
        }

        // Episode navigation (for series episodes)
        try {
          const adj = await api.get<AdjacentEpisodes>(`/videos/${id}/nextEpisode`);
          setAdjacentEpisodes(adj);
        } catch { /* ignore */ }

        // Fetch all episodes in the same season + season details
        if (v.series_id && v.season_id) {
          try {
            const episodes = await api.get<Video[]>(
              `/series/${v.series_id}/seasons/${v.season_id}/episodes`,
            );
            setSeasonEpisodes(episodes);
          } catch { /* ignore */ }
          try {
            const series = await api.get<{ seasons?: Season[] }>(`/series/${v.series_id}`);
            const season = series.seasons?.find((s) => s.id === v.season_id) ?? null;
            setCurrentSeason(season);
          } catch { /* ignore */ }
        } else {
          setSeasonEpisodes([]);
          setCurrentSeason(null);
        }
      } catch {
        setVideo(null);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, isAuthenticated]);

  // ── Watch progress heartbeat ─────────────────────────────────────────────

  const handleTimeUpdate = useCallback(
    (currentTime: number, duration: number) => {
      // Always update the WebSocket session time (for heartbeat)
      updateSessionTime(currentTime);

      if (!id || !isAuthenticated || !duration) return;
      // Report every 15 seconds of watch time
      if (Math.abs(currentTime - lastReportedRef.current) >= 15) {
        lastReportedRef.current = currentTime;
        api.post(`/watchProgress/${id}`, { progress: currentTime }).catch(() => {});
      }
    },
    [id, isAuthenticated, updateSessionTime],
  );

  // ── Save final progress on unmount ─────────────────────────────────────

  useEffect(() => {
    return () => {
      if (id && isAuthenticated && lastReportedRef.current > 0) {
        api.post(`/watchProgress/${id}`, { progress: lastReportedRef.current }).catch(() => {});
      }
    };
  }, [id, isAuthenticated]);

  // ── Episode ended → auto-play next ───────────────────────────────────────

  const handleEnded = useCallback(() => {
    // Save 100% progress
    if (id && isAuthenticated && video?.duration) {
      api.post(`/watchProgress/${id}`, { progress: video.duration }).catch(() => {});
    }
    // Navigate to next episode if available and autoNext is on
    if (autoNext && adjacentEpisodes.next) {
      navigate(`/watch/${adjacentEpisodes.next.id}`);
    }
  }, [id, isAuthenticated, video?.duration, autoNext, adjacentEpisodes.next, navigate]);

  // ── Loading / Error states ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-black text-gray-400">
        <p>Video not found.</p>
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-white hover:underline">
          <ArrowLeft size={16} /> Go back
        </button>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const hasAccess = !video.access || video.access.has_access;

  return (
    <div className="fixed inset-0 bg-black">
      {/* Player or Subscription Gate */}
      {hasAccess && video.manifest_url ? (
        <div className="relative h-full">
          <VideoPlayer
            manifestUrl={video.manifest_url}
            posterUrl={video.thumbnail_url || undefined}
            subtitleTracks={video.subtitle_tracks || []}
            startTime={startTime}
            autoPlay
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            showEpisodesButton={seasonEpisodes.length > 1}
            onEpisodesClick={() => setEpisodesOpen((o) => !o)}
            externalPanelOpen={episodesOpen}
            hasPreviousEpisode={!!adjacentEpisodes.previous}
            hasNextEpisode={!!adjacentEpisodes.next}
            onPreviousEpisode={() => adjacentEpisodes.previous && navigate(`/watch/${adjacentEpisodes.previous.id}`)}
            onNextEpisode={() => adjacentEpisodes.next && navigate(`/watch/${adjacentEpisodes.next.id}`)}
            introStart={video.intro_start}
            introEnd={video.intro_end}
            onBack={() => navigate(-1)}
            title={video.title}
            description={video.description || undefined}
            episodeLabel={
              video.series_id && video.episode_number != null
                ? [
                    currentSeason ? `Season ${currentSeason.season_number}` : null,
                    `Episode ${video.episode_number}`,
                    video.duration > 0 ? formatDuration(video.duration) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : video.duration > 0
                  ? formatDuration(video.duration)
                  : undefined
            }
          />
          {episodesOpen && seasonEpisodes.length > 1 && (
            <EpisodesPanel
              episodes={seasonEpisodes}
              currentVideoId={id!}
              progress={episodeProgress}
              seasonNumber={currentSeason?.season_number}
              seasonDescription={currentSeason?.description}
              autoNext={autoNext}
              onAutoNextToggle={() => setAutoNext((n) => !n)}
              onClose={() => setEpisodesOpen(false)}
            />
          )}
        </div>
      ) : video.access && !video.access.has_access ? (
        <div className="relative flex aspect-video w-full items-center justify-center bg-black">
          {video.thumbnail_url && (
            <img
              src={video.thumbnail_url}
              alt={video.title}
              className="absolute inset-0 h-full w-full object-cover opacity-20 blur-sm"
            />
          )}
          <div className="relative z-10 flex max-w-md flex-col items-center gap-4 rounded-xl bg-black/80 p-8 text-center backdrop-blur-md">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary)]/20">
              <Lock size={28} className="text-[var(--primary)]" />
            </div>
            <h2 className="text-xl font-bold">Subscribe to Watch</h2>
            <p className="text-sm text-gray-400">
              {video.access.reason === "login_required"
                ? "Sign in and subscribe to access this content."
                : video.access.reason === "no_subscription"
                  ? "You need an active subscription to watch this video."
                  : `This content requires a higher subscription tier (level ${video.access.min_tier_level}).`}
            </p>
            {!isAuthenticated ? (
              <Link
                to="/login"
                className="mt-2 rounded-lg bg-[var(--primary)] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
              >
                Sign In
              </Link>
            ) : (
              <button
                onClick={() => navigate("/pricing")}
                className="mt-2 flex items-center gap-2 rounded-lg bg-[var(--primary)] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
              >
                <CreditCard size={16} />
                View Plans
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-black text-gray-600">
          Video not yet available
        </div>
      )}

    </div>
  );
}
