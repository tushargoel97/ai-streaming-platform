import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Bookmark,
  BookmarkCheck,
  Eye,
  Calendar,
  Lock,
  CreditCard,
} from "lucide-react";
import { api, ApiError } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import { usePlayerSession } from "@/hooks/usePlayerSession";
import VideoPlayer from "@/components/video/VideoPlayer";
import CarouselRow from "@/components/video/CarouselRow";
import type { Video, ReactionResponse } from "@/types/api";
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

  // Watchlist
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);

  // Reactions
  const [reactions, setReactions] = useState<ReactionResponse>({ user_reaction: null });
  const [reactionLoading, setReactionLoading] = useState(false);
  const [reactionError, setReactionError] = useState("");

  // Episode navigation
  const [adjacentEpisodes, setAdjacentEpisodes] = useState<AdjacentEpisodes>({ previous: null, next: null });

  // Season episodes (for carousel)
  const [seasonEpisodes, setSeasonEpisodes] = useState<Video[]>([]);

  // Recommendations
  const [recommended, setRecommended] = useState<Video[]>([]);

  // Watch progress heartbeat
  const lastReportedRef = useRef(0);
  const [startTime, setStartTime] = useState(0);

  const recVideoIds = useMemo(() => recommended.map((v) => v.id), [recommended]);
  const recProgress = useWatchProgress(recVideoIds);

  const episodeVideoIds = useMemo(() => seasonEpisodes.map((v) => v.id), [seasonEpisodes]);
  const episodeProgress = useWatchProgress(episodeVideoIds);

  // Player session WebSocket (viewer count + analytics heartbeat)
  const { viewerCount, updateTime: updateSessionTime } = usePlayerSession({
    videoId: id || "",
    enabled: !!id && !!video,
  });

  // ── Fetch video data ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setReactionError("");
    lastReportedRef.current = 0;

    const fetchData = async () => {
      try {
        const v = await api.get<Video>(`/videos/${id}`);
        setVideo(v);

        // Fetch reactions
        try {
          const r = await api.get<ReactionResponse>(`/videos/${id}/reactions`);
          setReactions(r);
        } catch { /* ignore */ }

        // Watchlist status
        if (isAuthenticated) {
          try {
            const status = await api.get<{ in_watchlist: boolean }>(`/watchlist/${id}/status`);
            setInWatchlist(status.in_watchlist);
          } catch { /* ignore */ }

          // Get resume position
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

        // Fetch all episodes in the same season (for carousel)
        if (v.series_id && v.season_id) {
          try {
            const episodes = await api.get<Video[]>(
              `/series/${v.series_id}/seasons/${v.season_id}/episodes`,
            );
            setSeasonEpisodes(episodes);
          } catch { /* ignore */ }
        } else {
          setSeasonEpisodes([]);
        }

        // Recommendations (AI-powered similarity)
        try {
          const similar = await api.get<Video[]>(`/recommendations/similar/${id}`, { limit: "8" });
          setRecommended(similar);
        } catch {
          // Fallback to trending if recommendation engine not ready
          try {
            const trending = await api.get<Video[]>("/videos/trending");
            setRecommended(trending.filter((t) => t.id !== id).slice(0, 8));
          } catch { /* ignore */ }
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
    // Navigate to next episode if available
    if (adjacentEpisodes.next) {
      navigate(`/watch/${adjacentEpisodes.next.id}`);
    }
  }, [id, isAuthenticated, video?.duration, adjacentEpisodes.next, navigate]);

  // ── Watchlist toggle ─────────────────────────────────────────────────────

  const toggleWatchlist = useCallback(async () => {
    if (!id || !isAuthenticated) return;
    setWatchlistLoading(true);
    try {
      if (inWatchlist) {
        await api.delete(`/watchlist/${id}`);
        setInWatchlist(false);
      } else {
        await api.post(`/watchlist/${id}`);
        setInWatchlist(true);
      }
    } catch { /* ignore */ } finally {
      setWatchlistLoading(false);
    }
  }, [id, isAuthenticated, inWatchlist]);

  // ── Reaction handler ─────────────────────────────────────────────────────

  const handleReaction = useCallback(
    async (type: "like" | "dislike") => {
      if (!id || !isAuthenticated) return;
      setReactionLoading(true);
      setReactionError("");
      try {
        if (reactions.user_reaction === type) {
          const r = await api.delete(`/videos/${id}/react`) as unknown as ReactionResponse;
          setReactions(r);
        } else {
          const r = await api.post<ReactionResponse>(`/videos/${id}/react`, { reaction: type });
          setReactions(r);
        }
      } catch (err) {
        if (err instanceof ApiError) {
          try {
            const body = JSON.parse(err.body);
            setReactionError(body.detail || "Cannot react yet");
          } catch {
            setReactionError("You must watch at least 70% of the video to react");
          }
        }
      } finally {
        setReactionLoading(false);
      }
    },
    [id, isAuthenticated, reactions.user_reaction],
  );

  // ── Loading / Error states ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center pt-32">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!video) {
    return (
      <div className="px-12 pt-24 text-center text-gray-400">Video not found.</div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const hasCast = video.talents && video.talents.length > 0;
  const hasAccess = !video.access || video.access.has_access;

  return (
    <div className="pt-16">
      {/* Player or Subscription Gate */}
      {hasAccess && video.manifest_url ? (
        <VideoPlayer
          manifestUrl={video.manifest_url}
          posterUrl={video.thumbnail_url || undefined}
          subtitleTracks={video.subtitle_tracks || []}
          startTime={startTime}
          autoPlay
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
        />
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

      {/* Season episodes carousel */}
      {seasonEpisodes.length > 1 && (
        <div className="-mb-4">
          <CarouselRow
            title={`Season Episodes${video.episode_number != null ? ` — Now Playing E${video.episode_number}` : ""}`}
            videos={seasonEpisodes}
            progress={episodeProgress}
          />
        </div>
      )}

      {/* Metadata + Actions */}
      <div className="px-12 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{video.title}</h1>
            <div className="mt-2 flex items-center gap-4 text-sm text-gray-400">
              <span className="flex items-center gap-1">
                <Eye size={14} /> {video.view_count.toLocaleString()} views
              </span>
              {viewerCount > 1 && (
                <span className="flex items-center gap-1 text-green-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                  {viewerCount} watching now
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar size={14} />{" "}
                {video.published_at
                  ? new Date(video.published_at).toLocaleDateString()
                  : "Not published"}
              </span>
              {video.duration > 0 && <span>{formatDuration(video.duration)}</span>}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Like / Dislike */}
            <div className="flex items-center overflow-hidden rounded-full bg-white/10">
              <button
                onClick={() => handleReaction("like")}
                disabled={reactionLoading || !isAuthenticated}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors ${
                  reactions.user_reaction === "like"
                    ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                    : "text-gray-300 hover:bg-white/10"
                } disabled:cursor-not-allowed disabled:opacity-50`}
                title={!isAuthenticated ? "Login to react" : "Like"}
              >
                <ThumbsUp size={16} className={reactions.user_reaction === "like" ? "fill-current" : ""} />
              </button>
              <div className="h-6 w-px bg-white/20" />
              <button
                onClick={() => handleReaction("dislike")}
                disabled={reactionLoading || !isAuthenticated}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm transition-colors ${
                  reactions.user_reaction === "dislike"
                    ? "bg-red-500/20 text-red-400"
                    : "text-gray-300 hover:bg-white/10"
                } disabled:cursor-not-allowed disabled:opacity-50`}
                title={!isAuthenticated ? "Login to react" : "Dislike"}
              >
                <ThumbsDown size={16} className={reactions.user_reaction === "dislike" ? "fill-current" : ""} />
              </button>
            </div>

            {/* Watchlist */}
            {isAuthenticated && (
              <button
                onClick={toggleWatchlist}
                disabled={watchlistLoading}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm transition-colors ${
                  inWatchlist
                    ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                    : "bg-white/10 text-gray-300 hover:bg-white/20"
                } disabled:opacity-50`}
              >
                {inWatchlist ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                {inWatchlist ? "Saved" : "Save"}
              </button>
            )}
          </div>
        </div>

        {/* Reaction error */}
        {reactionError && (
          <div className="mt-3 flex items-center gap-2 rounded bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400">
            <Lock size={14} />
            {reactionError}
          </div>
        )}

        {/* Description */}
        {video.description && (
          <div className="mt-4 rounded-lg bg-white/5 p-4">
            <p className="whitespace-pre-line text-sm text-gray-300">{video.description}</p>
          </div>
        )}

        {/* Tags */}
        {video.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {video.tags.map((tag) => (
              <span key={tag} className="rounded bg-white/10 px-2 py-0.5 text-xs text-gray-300">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Cast */}
        {hasCast && (
          <section className="mt-6">
            <h2 className="mb-3 text-lg font-semibold">Cast</h2>
            <div className="flex flex-wrap gap-3">
              {video.talents!.map((vt) => (
                <Link
                  key={vt.talent_id}
                  to={`/talent/${vt.talent?.slug || vt.talent_id}`}
                  className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2 transition-colors hover:bg-white/10"
                >
                  {vt.talent?.photo_url ? (
                    <img
                      src={vt.talent.photo_url}
                      alt={vt.talent.name}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700 text-xs font-bold text-gray-400">
                      {(vt.talent?.name || "?")[0]?.toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium">{vt.talent?.name || "Unknown"}</p>
                    {vt.role && <p className="text-xs text-gray-500">{vt.role}</p>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Series link */}
        {video.series_id && (
          <div className="mt-4">
            <Link
              to={`/series/${video.series_id}`}
              className="text-sm text-[var(--primary)] hover:underline"
            >
              View full series
              {video.episode_number != null && ` — Episode ${video.episode_number}`}
            </Link>
          </div>
        )}

        {/* Recommendations */}
        {recommended.length > 0 && (
          <div className="-mx-12 mt-6">
            <CarouselRow
              title="More Like This"
              videos={recommended}
              progress={recProgress}
            />
          </div>
        )}
      </div>
    </div>
  );
}
