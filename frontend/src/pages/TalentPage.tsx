import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "@/api/client";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import VideoCard from "@/components/video/VideoCard";
import type { Talent, Video } from "@/types/api";

export default function TalentPage() {
  const { id } = useParams();
  const [talent, setTalent] = useState<Talent | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get<Talent>(`/talents/${id}`),
      api.get<Video[]>(`/talents/${id}/videos`),
    ])
      .then(([t, v]) => {
        setTalent(t);
        setVideos(v);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const videoIds = useMemo(() => videos.map((v) => v.id), [videos]);
  const progress = useWatchProgress(videoIds);

  if (loading) {
    return (
      <div className="flex items-center justify-center pt-32">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!talent) {
    return (
      <div className="px-12 pt-24 text-center text-gray-400">
        Talent not found.
      </div>
    );
  }

  return (
    <div className="px-12 pt-24">
      <div className="flex gap-8">
        {talent.photo_url ? (
          <img
            src={talent.photo_url}
            alt={talent.name}
            className="h-48 w-48 flex-shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-48 w-48 flex-shrink-0 items-center justify-center rounded-full bg-[var(--card)] text-5xl font-bold text-gray-500">
            {talent.name[0]?.toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-3xl font-bold">{talent.name}</h1>
          {talent.birth_date && (
            <p className="mt-1 text-sm text-gray-500">Born: {talent.birth_date}</p>
          )}
          {talent.bio && <p className="mt-3 max-w-2xl text-gray-400">{talent.bio}</p>}
          {talent.video_count !== undefined && (
            <p className="mt-2 text-sm text-gray-500">
              {talent.video_count} video{talent.video_count !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-xl font-semibold">Filmography</h2>
        {videos.length === 0 ? (
          <p className="text-gray-500">No videos yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {videos.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                progressPercent={progress[v.id]?.percentage}
                progressSeconds={progress[v.id]?.progress}
                watchCount={progress[v.id]?.watch_count}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
