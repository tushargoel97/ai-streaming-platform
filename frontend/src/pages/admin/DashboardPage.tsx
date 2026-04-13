import { useState, useEffect } from "react";
import {
  Loader2, Film, Eye, Users, HardDrive, Radio,
  AlertTriangle, Clock, TrendingUp, BarChart3,
} from "lucide-react";
import { api } from "@/api/client";
import { formatBytes } from "@/lib/utils";
import type { AnalyticsOverview } from "@/types/api";

interface ViewTrendEntry { date: string; views: number }
interface TopVideo { id: string; title: string; view_count: number; recent_views: number }

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function DashboardPage() {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [viewTrends, setViewTrends] = useState<ViewTrendEntry[]>([]);
  const [topVideos, setTopVideos] = useState<TopVideo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [overview, trends, top] = await Promise.all([
          api.get<AnalyticsOverview>("/admin/analytics/overview"),
          api.get<{ data: ViewTrendEntry[] }>("/admin/analytics/views", { days: "30", period: "daily" })
            .catch(() => ({ data: [] })),
          api.get<TopVideo[]>("/admin/analytics/top-videos", { limit: "10", days: "30" })
            .catch(() => []),
        ]);
        setData(overview);
        setViewTrends(trends.data);
        setTopVideos(top);
      } catch {
        // leave null
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <AlertTriangle size={40} className="mb-3 opacity-50" />
        <p>Failed to load dashboard data.</p>
      </div>
    );
  }

  const stats = [
    { label: "Total Videos", value: formatNumber(data.total_videos), icon: Film, color: "text-blue-400" },
    { label: "Total Views", value: formatNumber(data.total_views), icon: Eye, color: "text-green-400" },
    { label: "Total Users", value: formatNumber(data.total_users), icon: Users, color: "text-purple-400" },
    { label: "Storage Used", value: formatBytes(data.total_storage_bytes), icon: HardDrive, color: "text-yellow-400" },
  ];

  // Simple bar chart max for view trends
  const maxViews = Math.max(1, ...viewTrends.map((d) => d.views));

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-400">{label}</p>
              <Icon size={20} className={color} />
            </div>
            <p className="mt-2 text-3xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {/* Secondary Stats */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Radio size={16} className="text-red-400" />
            Active Streams
          </div>
          <p className="mt-1 text-2xl font-bold">{data.active_streams}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Clock size={16} className="text-yellow-400" />
            Processing
          </div>
          <p className="mt-1 text-2xl font-bold">{data.videos_by_status.processing}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <AlertTriangle size={16} className="text-red-400" />
            Failed
          </div>
          <p className="mt-1 text-2xl font-bold">{data.videos_by_status.failed}</p>
        </div>
      </div>

      {/* View Trends (last 30 days) */}
      {viewTrends.length > 0 && (
        <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-green-400" />
            <h2 className="text-lg font-semibold">View Trends (30 days)</h2>
          </div>
          <div className="flex items-end gap-[2px]" style={{ height: 120 }}>
            {viewTrends.map((d) => (
              <div
                key={d.date}
                className="group relative flex-1 rounded-t bg-blue-500/60 transition-colors hover:bg-blue-400"
                style={{ height: `${Math.max((d.views / maxViews) * 100, 2)}%` }}
                title={`${d.date}: ${d.views} views`}
              >
                <div className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-0.5 text-[10px] text-white group-hover:block">
                  {d.views}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-gray-500">
            <span>{viewTrends[0]?.date}</span>
            <span>{viewTrends[viewTrends.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Top Videos + Recent Activity row */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Videos */}
        {topVideos.length > 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 size={18} className="text-purple-400" />
              <h2 className="text-lg font-semibold">Top Videos (30 days)</h2>
            </div>
            <div className="space-y-2">
              {topVideos.map((v, idx) => (
                <div key={v.id} className="flex items-center gap-3 rounded-md bg-white/5 px-3 py-2">
                  <span className="w-5 text-center text-xs font-bold text-gray-500">{idx + 1}</span>
                  <p className="min-w-0 flex-1 truncate text-sm text-white">{v.title}</p>
                  <span className="whitespace-nowrap text-xs text-gray-400">{formatNumber(v.recent_views)} views</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Videos */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="mb-4 text-lg font-semibold">Recent Videos</h2>
          {data.recent_videos.length === 0 ? (
            <p className="text-gray-500">No videos yet.</p>
          ) : (
            <div className="space-y-3">
              {data.recent_videos.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{v.title}</p>
                    <p className="text-xs text-gray-500">
                      {v.created_at ? new Date(v.created_at).toLocaleDateString() : ""}
                    </p>
                  </div>
                  <div className="ml-3 flex items-center gap-3">
                    <span className="text-xs text-gray-400">{formatNumber(v.view_count)} views</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        v.status === "ready"
                          ? "bg-green-500/20 text-green-400"
                          : v.status === "processing"
                            ? "bg-yellow-500/20 text-yellow-400"
                            : v.status === "failed"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-gray-500/20 text-gray-400"
                      }`}
                    >
                      {v.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Users + Users by Role */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="mb-4 text-lg font-semibold">Recent Users</h2>
          {data.recent_users.length === 0 ? (
            <p className="text-gray-500">No users yet.</p>
          ) : (
            <div className="space-y-3">
              {data.recent_users.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">@{u.username}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </div>
                  <div className="ml-3 flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.role === "superadmin"
                          ? "bg-red-500/20 text-red-400"
                          : u.role === "admin"
                            ? "bg-blue-500/20 text-blue-400"
                            : "bg-gray-500/20 text-gray-400"
                      }`}
                    >
                      {u.role}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Users by Role */}
        {Object.keys(data.users_by_role).length > 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <h2 className="mb-4 text-lg font-semibold">Users by Role</h2>
            <div className="flex flex-wrap gap-6">
              {Object.entries(data.users_by_role).map(([role, count]) => (
                <div key={role} className="text-center">
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-xs text-gray-400">{role}s</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
