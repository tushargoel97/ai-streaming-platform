import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Search, X, Loader2, Play, TrendingUp, Clock, Star, Sparkles, Film, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/api/client";
import type { Video, Talent, Series } from "@/types/api";

// ── Types ───────────────────────────────────────────────────────────────────────

interface SearchResults {
  videos: Video[];
  talents: Talent[];
  series: Series[];
}

interface AISearchResult {
  video_id: string;
  title: string;
  reason: string;
}

interface AISearchResponse {
  summary: string;
  results: AISearchResult[];
  suggestions: string[];
}

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
}

// ── Poster Card ─────────────────────────────────────────────────────────────────

function PosterCard({ video, onClick }: { video: Video; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-lg text-left transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-[#1a1a1a]">
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Play size={28} className="text-gray-600" />
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

        {/* Play icon on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg">
            <Play size={20} className="ml-0.5 fill-black text-black" />
          </div>
        </div>

        {/* Title at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-2.5">
          <p className="line-clamp-2 text-xs font-semibold leading-tight text-white drop-shadow-lg">
            {video.title}
          </p>
        </div>

        {/* Badges */}
        {video.is_featured && (
          <span className="absolute left-1.5 top-1.5 rounded bg-[var(--primary)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Featured
          </span>
        )}

        {/* Rating badge */}
        {video.imdb_rating && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded bg-yellow-500/90 px-1.5 py-0.5 text-[10px] font-bold text-black">
            <Star size={8} className="fill-current" />
            {video.imdb_rating}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Talent Card ─────────────────────────────────────────────────────────────────

function TalentCard({ talent, onClick }: { talent: Talent; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center gap-3 rounded-xl bg-white/5 p-3 text-left transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
    >
      {talent.photo_url ? (
        <img
          src={talent.photo_url}
          alt={talent.name}
          className="h-12 w-12 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700 text-lg font-bold text-gray-400">
          {talent.name[0]?.toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white group-hover:text-[var(--primary)]">
          {talent.name}
        </p>
        {talent.video_count != null && (
          <p className="text-xs text-gray-500">{talent.video_count} titles</p>
        )}
      </div>
    </button>
  );
}

// ── Series Card ─────────────────────────────────────────────────────────────────

function SeriesCard({ series, onClick }: { series: Series; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-lg text-left transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-[#1a1a1a]">
        {series.poster_url ? (
          <img
            src={series.poster_url}
            alt={series.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
            <Play size={24} className="text-gray-600" />
            <p className="text-xs text-gray-500">{series.title}</p>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2.5 pt-8">
          <p className="line-clamp-2 text-xs font-semibold leading-tight text-white">
            {series.title}
          </p>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
            {series.status === "ongoing" && <span className="text-green-400">Ongoing</span>}
            {series.status === "completed" && <span>Completed</span>}
            {series.year_started && <span>{series.year_started}</span>}
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Search Overlay ──────────────────────────────────────────────────────────────

export default function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults>({ videos: [], talents: [], series: [] });
  const [trending, setTrending] = useState<Video[]>([]);
  const [recentlyAdded, setRecentlyAdded] = useState<Video[]>([]);
  const [trendingLoaded, setTrendingLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // AI search state
  const [aiMode, setAiMode] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AISearchResponse | null>(null);
  const [aiError, setAiError] = useState("");

  // Focus input when overlay opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery("");
      setResults({ videos: [], talents: [], series: [] });
      setAiResult(null);
      setAiError("");
    }
  }, [open]);

  // Load trending + recently added on first open
  useEffect(() => {
    if (!open || trendingLoaded) return;
    const load = async () => {
      try {
        const [t, r] = await Promise.all([
          api.get<Video[]>("/videos/trending"),
          api.get<{ items: Video[]; total: number }>("/videos", { sort: "recent", page_size: "14" }),
        ]);
        setTrending(t);
        setRecentlyAdded(r.items);
        setTrendingLoaded(true);
      } catch { /* ignore */ }
    };
    load();
  }, [open, trendingLoaded]);

  // Regular debounced search
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults({ videos: [], talents: [], series: [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [videosRes, talentsRes, seriesRes] = await Promise.all([
        api.get<{ items: Video[]; total: number }>("/videos", { search: q, page_size: "20" }),
        api.get<{ items: Talent[]; total: number }>("/talents", { search: q, page_size: "6" }),
        api.get<{ items: Series[]; total: number }>("/series", { search: q, page_size: "6" }),
      ]);
      setResults({
        videos: videosRes.items,
        talents: talentsRes.items,
        series: seriesRes.items,
      });
    } catch {
      setResults({ videos: [], talents: [], series: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (aiMode) return; // Don't auto-search in AI mode
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults({ videos: [], talents: [], series: [] });
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch, aiMode]);

  // AI search handler
  const doAiSearch = useCallback(async (q?: string) => {
    const searchQuery = (q ?? query).trim();
    if (!searchQuery || aiLoading) return;
    setAiLoading(true);
    setAiError("");
    setAiResult(null);

    try {
      const data = await api.post<AISearchResponse>("/search/ai", { query: searchQuery });
      setAiResult(data);
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : "AI search failed");
    } finally {
      setAiLoading(false);
    }
  }, [query, aiLoading]);

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && aiMode) {
      e.preventDefault();
      doAiSearch();
    }
  };

  // Toggle AI mode
  const toggleAiMode = () => {
    const next = !aiMode;
    setAiMode(next);
    setAiResult(null);
    setAiError("");
    if (!next && query.trim()) {
      // Switching back to regular — trigger regular search
      doSearch(query);
    }
    inputRef.current?.focus();
  };

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const navigateTo = (path: string) => {
    onClose();
    navigate(path);
  };

  const hasQuery = query.trim().length > 0;
  const hasResults = results.videos.length > 0 || results.talents.length > 0 || results.series.length > 0;
  const noResults = hasQuery && !loading && !hasResults;
  const isSearching = aiMode ? aiLoading : loading;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-sm"
        >
          {/* ── Search Header ──────────────────────────────────────── */}
          <div className="border-b border-white/10 bg-black/60 px-6 py-4">
            <div className="mx-auto flex max-w-5xl items-center gap-3">
              {/* AI mode toggle */}
              <button
                onClick={toggleAiMode}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  aiMode
                    ? "bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/20"
                    : "bg-white/[0.06] text-gray-400 hover:bg-white/[0.1] hover:text-gray-200"
                }`}
              >
                <Sparkles size={13} />
                AI
              </button>

              {/* Search icon */}
              {aiMode ? (
                <Sparkles size={20} className="shrink-0 text-purple-400" />
              ) : (
                <Search size={22} className="shrink-0 text-gray-400" />
              )}

              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={aiMode ? 'Describe what you want to watch... (press Enter)' : "Movies, shows and more"}
                className="flex-1 bg-transparent text-lg text-white placeholder-gray-500 outline-none"
                autoComplete="off"
                spellCheck={false}
              />

              {/* AI search button (visible in AI mode with query) */}
              {aiMode && hasQuery && (
                <button
                  onClick={() => doAiSearch()}
                  disabled={aiLoading}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {aiLoading ? "Searching..." : "Search"}
                </button>
              )}

              {isSearching && !aiMode && <Loader2 size={20} className="shrink-0 animate-spin text-gray-400" />}
              <button
                onClick={onClose}
                className="shrink-0 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={22} />
              </button>
            </div>
          </div>

          {/* ── Content Area ───────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-6xl">

              {/* ── AI Search Results ────────────────────────────── */}
              {aiMode && (
                <>
                  {/* AI Error */}
                  {aiError && (
                    <div className="mb-6 rounded-xl bg-red-500/10 px-5 py-3 text-sm text-red-400">
                      {aiError}
                    </div>
                  )}

                  {/* AI Results */}
                  {aiResult && (
                    <div className="mb-8">
                      {/* Summary */}
                      <div className="mb-4 flex items-start gap-3 rounded-xl bg-gradient-to-br from-purple-500/[0.08] to-blue-500/[0.06] p-4">
                        <Sparkles size={18} className="mt-0.5 shrink-0 text-purple-400" />
                        <p className="text-sm leading-relaxed text-gray-200">{aiResult.summary}</p>
                      </div>

                      {/* Video matches */}
                      {aiResult.results.length > 0 ? (
                        <section>
                          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
                            AI Matches
                          </h3>
                          <div className="space-y-2">
                            {aiResult.results.map((r) => (
                              <Link
                                key={r.video_id}
                                to={`/watch/${r.video_id}`}
                                onClick={onClose}
                                className="group flex items-center gap-3 rounded-xl bg-white/[0.04] p-3.5 transition-colors hover:bg-white/[0.08]"
                              >
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 transition-colors group-hover:bg-purple-500/30">
                                  <Film size={18} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-white">{r.title}</p>
                                  <p className="truncate text-xs text-gray-400">{r.reason}</p>
                                </div>
                                <ArrowRight size={16} className="shrink-0 text-gray-600 transition-colors group-hover:text-gray-300" />
                              </Link>
                            ))}
                          </div>
                        </section>
                      ) : (
                        <p className="text-sm text-gray-500">No matching videos found. Try a different query.</p>
                      )}

                      {/* Suggestions */}
                      {aiResult.suggestions.length > 0 && (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-500">Try:</span>
                          {aiResult.suggestions.map((s, i) => (
                            <button
                              key={i}
                              onClick={() => { setQuery(s); doAiSearch(s); }}
                              className="rounded-full bg-white/[0.06] px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-white/[0.12] hover:text-white"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* AI empty state */}
                  {!aiResult && !aiLoading && !aiError && (
                    <div className="py-20 text-center">
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20">
                        <Sparkles size={28} className="text-purple-400" />
                      </div>
                      <p className="text-lg font-medium text-gray-300">AI-Powered Search</p>
                      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
                        Describe what you want to watch in natural language. Try &quot;short action videos in HD&quot; or &quot;something relaxing to watch&quot;
                      </p>
                    </div>
                  )}

                  {/* AI loading */}
                  {aiLoading && (
                    <div className="flex flex-col items-center justify-center py-20">
                      <Loader2 size={32} className="animate-spin text-purple-400" />
                      <p className="mt-3 text-sm text-gray-400">Searching with AI...</p>
                    </div>
                  )}
                </>
              )}

              {/* ── Regular Search ────────────────────────────────── */}
              {!aiMode && (
                <>
                  {/* No results state */}
                  {noResults && (
                    <div className="py-20 text-center">
                      <Search size={48} className="mx-auto mb-4 text-gray-600" />
                      <p className="text-lg text-gray-400">
                        No results for &quot;{query}&quot;
                      </p>
                      <p className="mt-1 text-sm text-gray-600">
                        Try different keywords or browse trending content below
                      </p>
                      <button
                        onClick={toggleAiMode}
                        className="mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600/20 to-blue-600/20 px-5 py-2 text-sm text-purple-300 transition-colors hover:from-purple-600/30 hover:to-blue-600/30"
                      >
                        <Sparkles size={14} />
                        Try AI Search instead
                      </button>
                    </div>
                  )}

                  {/* ── Search Results ─────────────────────────────────── */}
                  {hasQuery && hasResults && (
                    <>
                      {/* Talent Results */}
                      {results.talents.length > 0 && (
                        <section className="mb-8">
                          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
                            People
                          </h3>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                            {results.talents.map((t) => (
                              <TalentCard
                                key={t.id}
                                talent={t}
                                onClick={() => navigateTo(`/talent/${t.slug || t.id}`)}
                              />
                            ))}
                          </div>
                        </section>
                      )}

                      {/* Series Results */}
                      {results.series.length > 0 && (
                        <section className="mb-8">
                          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
                            Series
                          </h3>
                          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
                            {results.series.map((s) => (
                              <SeriesCard
                                key={s.id}
                                series={s}
                                onClick={() => navigateTo(`/series/${s.id}`)}
                              />
                            ))}
                          </div>
                        </section>
                      )}

                      {/* Video Results */}
                      {results.videos.length > 0 && (
                        <section className="mb-8">
                          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
                            Videos
                          </h3>
                          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
                            {results.videos.map((v) => (
                              <PosterCard
                                key={v.id}
                                video={v}
                                onClick={() => navigateTo(`/watch/${v.id}`)}
                              />
                            ))}
                          </div>
                        </section>
                      )}
                    </>
                  )}

                  {/* ── Discovery Content (when no search query) ───────── */}
                  {!hasQuery && (
                    <>
                      {/* Trending */}
                      {trending.length > 0 && (
                        <section className="mb-10">
                          <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
                            <TrendingUp size={18} className="text-[var(--primary)]" />
                            Trending Now
                          </h3>
                          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
                            {trending.map((v) => (
                              <PosterCard
                                key={v.id}
                                video={v}
                                onClick={() => navigateTo(`/watch/${v.id}`)}
                              />
                            ))}
                          </div>
                        </section>
                      )}

                      {/* Recently Added */}
                      {recentlyAdded.length > 0 && (
                        <section className="mb-10">
                          <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
                            <Clock size={18} className="text-[var(--primary)]" />
                            Recently Added
                          </h3>
                          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
                            {recentlyAdded.map((v) => (
                              <PosterCard
                                key={v.id}
                                video={v}
                                onClick={() => navigateTo(`/watch/${v.id}`)}
                              />
                            ))}
                          </div>
                        </section>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
