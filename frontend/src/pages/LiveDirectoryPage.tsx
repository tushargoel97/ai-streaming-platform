import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Loader2, Radio, Users, AlertTriangle } from "lucide-react";
import { api } from "@/api/client";
import type { LiveStream } from "@/types/api";

const ALL_TAB = "__all__";

function StreamCard({ stream }: { stream: LiveStream }) {
  return (
    <Link
      to={`/live/${stream.id}`}
      className="group overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] transition-all hover:border-[var(--primary)] hover:shadow-lg hover:shadow-black/20"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-black">
        {stream.thumbnail_url ? (
          <img
            src={stream.thumbnail_url}
            alt={stream.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-gray-900 to-black">
            <Radio size={32} className="text-gray-700" />
          </div>
        )}

        {/* Live badge */}
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase text-white shadow">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          Live
        </span>

        {/* Viewer count */}
        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/70 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
          <Users size={12} />
          {stream.viewer_count.toLocaleString()}
        </span>

        {/* Category badge */}
        {stream.category_name && (
          <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 text-xs text-gray-300 backdrop-blur-sm">
            {stream.category_name}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="truncate font-medium text-white group-hover:text-[var(--primary)]">
          {stream.title}
        </h3>
        {stream.description && (
          <p className="mt-1 line-clamp-2 text-xs text-gray-400">
            {stream.description}
          </p>
        )}
        {stream.started_at && (
          <p className="mt-1.5 text-[11px] text-gray-500">
            Started {new Date(stream.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </div>
    </Link>
  );
}

export default function LiveDirectoryPage() {
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(ALL_TAB);

  const load = () => {
    api
      .get<LiveStream[]>("/live/streams")
      .then(setStreams)
      .catch(() => setStreams([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  // Build category tabs from the streams data
  const categories = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const s of streams) {
      const key = s.category_id || "__uncategorized__";
      const name = s.category_name || "Other";
      const existing = map.get(key);
      if (existing) {
        existing.count++;
      } else {
        map.set(key, { id: key, name, count: 1 });
      }
    }
    // Sort by count descending, then alphabetically
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [streams]);

  // Filter streams by active tab
  const filteredStreams = useMemo(() => {
    if (activeTab === ALL_TAB) return streams;
    return streams.filter((s) => {
      const key = s.category_id || "__uncategorized__";
      return key === activeTab;
    });
  }, [streams, activeTab]);

  // Group streams by category for the "All" view
  const groupedStreams = useMemo(() => {
    if (activeTab !== ALL_TAB) return null;
    const groups: { name: string; streams: LiveStream[] }[] = [];
    const map = new Map<string, LiveStream[]>();
    for (const s of streams) {
      const key = s.category_name || "Other";
      const arr = map.get(key);
      if (arr) {
        arr.push(s);
      } else {
        map.set(key, [s]);
      }
    }
    // Sort groups by stream count descending
    for (const [name, categoryStreams] of map) {
      groups.push({ name, streams: categoryStreams });
    }
    groups.sort((a, b) => b.streams.length - a.streams.length);
    return groups;
  }, [streams, activeTab]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 pt-20 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-600/20">
          <Radio size={20} className="text-red-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Live Now</h1>
          <p className="text-sm text-gray-400">
            {streams.length} stream{streams.length !== 1 ? "s" : ""} live
          </p>
        </div>
      </div>

      {streams.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] py-20 text-gray-500">
          <AlertTriangle size={40} className="mb-3 opacity-50" />
          <p className="text-lg">No streams are live right now</p>
          <p className="mt-1 text-sm">Check back later for live content</p>
        </div>
      ) : (
        <>
          {/* Category tabs */}
          {categories.length > 1 && (
            <div className="mb-6 flex gap-2 overflow-x-auto pb-2 scrollbar-none">
              <button
                onClick={() => setActiveTab(ALL_TAB)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === ALL_TAB
                    ? "bg-[var(--primary)] text-white"
                    : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                All
                <span className="ml-1.5 text-xs opacity-70">{streams.length}</span>
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveTab(cat.id)}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    activeTab === cat.id
                      ? "bg-[var(--primary)] text-white"
                      : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {cat.name}
                  <span className="ml-1.5 text-xs opacity-70">{cat.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Content: grouped or flat */}
          {activeTab === ALL_TAB && groupedStreams ? (
            <div className="space-y-8">
              {groupedStreams.map((group) => (
                <section key={group.name}>
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-white">{group.name}</h2>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-gray-400">
                      {group.streams.length} live
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {group.streams.map((stream) => (
                      <StreamCard key={stream.id} stream={stream} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredStreams.map((stream) => (
                <StreamCard key={stream.id} stream={stream} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
