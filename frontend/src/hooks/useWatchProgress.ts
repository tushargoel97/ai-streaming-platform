import { useState, useEffect } from "react";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import type { WatchProgressMap } from "@/types/api";

/**
 * Fetches watch progress for a list of video IDs.
 * Returns a map of video_id -> { progress, duration, percentage }.
 * Only fetches when authenticated.
 */
export function useWatchProgress(videoIds: string[]): WatchProgressMap {
  const { isAuthenticated } = useAuthStore();
  const [progress, setProgress] = useState<WatchProgressMap>({});

  useEffect(() => {
    if (!isAuthenticated || videoIds.length === 0) {
      setProgress({});
      return;
    }

    const uniqueIds = [...new Set(videoIds)];
    if (uniqueIds.length === 0) return;

    api
      .get<WatchProgressMap>("/watchProgress", {
        video_ids: uniqueIds.join(","),
      })
      .then(setProgress)
      .catch(() => setProgress({}));
  }, [isAuthenticated, videoIds.join(",")]);

  return progress;
}
