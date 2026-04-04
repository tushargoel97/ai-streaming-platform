import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, Play } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import type { Series, Season, Video } from "@/types/api";
import { formatDuration } from "@/lib/utils";

interface SeriesDetail extends Series {
  seasons?: Season[];
}

interface SeriesProgress {
  percentage: number;
  watched_episodes: number;
  total_episodes: number;
}

export default function SeriesPage() {
  const { id } = useParams();
  const { isAuthenticated } = useAuthStore();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSeason, setActiveSeason] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<Video[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [seriesProgress, setSeriesProgress] = useState<SeriesProgress | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<SeriesDetail>(`/series/${id}`)
      .then((s) => {
        setSeries(s);
        if (s.seasons && s.seasons.length > 0) {
          const sorted = [...s.seasons].sort((a, b) => a.season_number - b.season_number);
          if (sorted[0]) setActiveSeason(sorted[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Fetch series-level progress
  useEffect(() => {
    if (!id || !isAuthenticated) return;
    api
      .get<SeriesProgress>(`/watchProgress/series/${id}`)
      .then(setSeriesProgress)
      .catch(() => setSeriesProgress(null));
  }, [id, isAuthenticated]);

  // Fetch episodes when active season changes
  useEffect(() => {
    if (!id || !activeSeason) return;
    setLoadingEpisodes(true);
    api
      .get<Video[]>(`/series/${id}/seasons/${activeSeason}/episodes`)
      .then(setEpisodes)
      .catch(() => setEpisodes([]))
      .finally(() => setLoadingEpisodes(false));
  }, [id, activeSeason]);

  // Episode progress bars
  const episodeIds = useMemo(() => episodes.map((ep) => ep.id), [episodes]);
  const episodeProgress = useWatchProgress(episodeIds);

  if (loading) {
    return (
      <div className="flex items-center justify-center pt-32">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!series) {
    return (
      <div className="px-12 pt-24 text-center text-gray-400">
        Series not found.
      </div>
    );
  }

  const sortedSeasons = series.seasons
    ? [...series.seasons].sort((a, b) => a.season_number - b.season_number)
    : [];

  const statusColors: Record<string, string> = {
    ongoing: "text-blue-400",
    completed: "text-green-400",
    cancelled: "text-gray-400",
  };

  return (
    <div className="pt-[72px]">
      {/* Series banner */}
      <div
        className="relative flex h-80 items-end bg-gradient-to-t from-black to-gray-800 px-12 pb-8"
        style={
          series.banner_url
            ? { backgroundImage: `url(${series.banner_url})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      >
        {series.banner_url && <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />}
        <div className="relative z-10 flex gap-6">
          {series.poster_url && (
            <div className="flex flex-col">
              <img
                src={series.poster_url}
                alt={series.title}
                className="h-44 w-32 rounded-md object-cover shadow-lg"
              />
              {/* Series progress bar under poster */}
              {seriesProgress && seriesProgress.percentage > 0 && (
                <div className="mt-1 h-1 w-32 rounded-full bg-white/20">
                  <div
                    className="h-full rounded-full bg-red-600"
                    style={{ width: `${seriesProgress.percentage}%` }}
                  />
                </div>
              )}
            </div>
          )}
          <div>
            <h1 className="text-4xl font-bold">{series.title}</h1>
            <div className="mt-2 flex items-center gap-3 text-sm">
              <span className={statusColors[series.status] || "text-gray-400"}>
                {series.status.charAt(0).toUpperCase() + series.status.slice(1)}
              </span>
              {series.year_started && <span className="text-gray-400">{series.year_started}</span>}
              <span className={`rounded px-2 py-0.5 text-xs ${
                series.content_classification === "explicit"
                  ? "bg-red-500/20 text-red-400"
                  : series.content_classification === "mature"
                    ? "bg-yellow-500/20 text-yellow-400"
                    : "bg-green-500/20 text-green-400"
              }`}>
                {series.content_classification}
              </span>
            </div>
            {/* Series progress text */}
            {seriesProgress && seriesProgress.percentage > 0 && (
              <p className="mt-2 text-sm text-gray-400">
                {seriesProgress.watched_episodes}/{seriesProgress.total_episodes} episodes watched
                {" · "}{seriesProgress.percentage}% complete
              </p>
            )}
            {series.description && (
              <p className="mt-3 max-w-2xl text-gray-300">{series.description}</p>
            )}
            {series.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {series.tags.map((tag) => (
                  <span key={tag} className="rounded bg-white/10 px-2 py-0.5 text-xs text-gray-300">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Season tabs & episode list */}
      <div className="px-12 py-6">
        {sortedSeasons.length > 0 ? (
          <>
            <div className="mb-6 flex gap-4 border-b border-[var(--border)]">
              {sortedSeasons.map((season) => (
                <button
                  key={season.id}
                  onClick={() => setActiveSeason(season.id)}
                  className={`pb-2 text-sm font-medium transition-colors ${
                    activeSeason === season.id
                      ? "border-b-2 border-[var(--primary)] text-white"
                      : "text-gray-500 hover:text-white"
                  }`}
                >
                  Season {season.season_number}
                  {season.title && ` — ${season.title}`}
                </button>
              ))}
            </div>

            {loadingEpisodes ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : episodes.length === 0 ? (
              <p className="py-4 text-gray-500">No episodes in this season yet.</p>
            ) : (
              <div className="space-y-3">
                {episodes.map((ep) => {
                  const epPct = episodeProgress[ep.id]?.percentage;
                  return (
                    <Link
                      key={ep.id}
                      to={`/watch/${ep.id}`}
                      className="group flex gap-4 rounded-lg bg-[var(--card)] p-4 transition-colors hover:bg-[var(--card-hover,var(--card))]"
                    >
                      <div className="relative h-24 w-40 flex-shrink-0 overflow-hidden rounded bg-gray-800">
                        {ep.thumbnail_url ? (
                          <img
                            src={ep.thumbnail_url}
                            alt={ep.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-gray-600">
                            <Play size={24} />
                          </div>
                        )}
                        {ep.duration > 0 && (
                          <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white">
                            {formatDuration(ep.duration)}
                          </span>
                        )}
                        {/* Episode progress bar */}
                        {epPct != null && epPct > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                            <div
                              className="h-full bg-red-600"
                              style={{ width: `${Math.min(epPct, 100)}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-medium group-hover:text-[var(--primary)]">
                          {ep.episode_number != null && `E${ep.episode_number}. `}
                          {ep.title}
                        </h3>
                        {ep.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-gray-400">{ep.description}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500">
                          {ep.view_count.toLocaleString()} views
                          {epPct != null && epPct > 0 && (
                            <span className="ml-2 text-red-400">{epPct}% watched</span>
                          )}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <p className="text-gray-500">No seasons available yet.</p>
        )}
      </div>
    </div>
  );
}
