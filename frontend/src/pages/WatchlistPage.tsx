import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import { Loader2, BookmarkX, Bookmark } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import VideoCard from "@/components/video/VideoCard";
import type { WatchlistItem, PaginatedResponse } from "@/types/api";

export default function WatchlistPage() {
  const { isAuthenticated } = useAuthStore();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  const fetchWatchlist = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<PaginatedResponse<WatchlistItem>>("/watchlist", {
        page: String(page),
        page_size: String(pageSize),
      });
      setItems(data.items);
      setTotal(data.total);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (isAuthenticated) fetchWatchlist();
  }, [isAuthenticated, fetchWatchlist]);

  const videoIds = useMemo(
    () => items.filter((i) => i.video).map((i) => i.video!.id),
    [items],
  );
  const progress = useWatchProgress(videoIds);

  const handleRemove = async (videoId: string) => {
    try {
      await api.delete(`/watchlist/${videoId}`);
      fetchWatchlist();
    } catch {
      // silent
    }
  };

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="px-4 sm:px-8 lg:px-12 pt-24">
      <div className="mb-6 flex items-center gap-3">
        <Bookmark size={24} />
        <h1 className="text-2xl font-bold">My Watchlist</h1>
        {total > 0 && <span className="text-sm text-gray-400">({total})</span>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <Bookmark size={48} className="mb-3 opacity-30" />
          <p>Your watchlist is empty.</p>
          <Link to="/browse" className="mt-2 text-sm text-[var(--primary)] hover:underline">
            Browse videos
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((item) => {
              const video = item.video;
              if (!video) return null;
              return (
                <div key={item.id} className="relative">
                  <VideoCard
                    video={video}
                    progressPercent={progress[video.id]?.percentage}
                    progressSeconds={progress[video.id]?.progress}
                    watchCount={progress[video.id]?.watch_count}
                  />
                  <div className="absolute right-1 top-[calc(100%-2.5rem)]">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        handleRemove(video.id);
                      }}
                      className="rounded p-1 text-gray-500 hover:text-red-400"
                      title="Remove from watchlist"
                    >
                      <BookmarkX size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex justify-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i + 1)}
                  className={`rounded px-3 py-1 text-sm ${
                    page === i + 1
                      ? "bg-[var(--primary)] text-white"
                      : "text-gray-400 hover:bg-white/10"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
