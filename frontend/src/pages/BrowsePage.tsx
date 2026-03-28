import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Loader2,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Clock,
  Monitor,
  Shield,
  ArrowUpDown,
  LayoutGrid,
  Film,
  Tag,
} from "lucide-react";
import { api } from "@/api/client";
import { useWatchProgress } from "@/hooks/useWatchProgress";
import VideoCard from "@/components/video/VideoCard";
import type { Video, Category, PaginatedResponse } from "@/types/api";

// ── Config ───────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: "recent", label: "Recently Added" },
  { value: "views", label: "Most Popular" },
  { value: "title", label: "A – Z" },
] as const;

const DURATION_FILTERS = [
  { value: "", label: "Any" },
  { value: "short", label: "< 20 min" },
  { value: "medium", label: "20–60 min" },
  { value: "long", label: "1–2 hrs" },
  { value: "movie", label: "2+ hrs" },
] as const;

const QUALITY_FILTERS = [
  { value: "", label: "Any" },
  { value: "hd", label: "HD" },
  { value: "4k", label: "4K" },
] as const;

const RATING_FILTERS = [
  { value: "", label: "All" },
  { value: "safe", label: "U/A" },
  { value: "mature", label: "U/A 16+" },
  { value: "explicit", label: "18+" },
] as const;

const PAGE_SIZE = 24;

function durationToParams(d: string): { min?: string; max?: string } {
  switch (d) {
    case "short": return { max: "1200" };
    case "medium": return { min: "1200", max: "3600" };
    case "long": return { min: "3600", max: "7200" };
    case "movie": return { min: "7200" };
    default: return {};
  }
}

// ── Chip ─────────────────────────────────────────────────────

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
        active ? "bg-white text-black shadow-md shadow-white/10" : "bg-white/[0.06] text-gray-300 hover:bg-white/[0.12]"
      }`}
    >
      {children}
    </button>
  );
}

// ── Filter group ─────────────────────────────────────────────

function FilterGroup({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex w-20 shrink-0 items-center gap-1.5 pt-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">
        {icon}
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

// ── Category tab bar ─────────────────────────────────────────

function CategoryBar({ categories, active, onChange }: { categories: Category[]; active: string; onChange: (id: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 10);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 10);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) el.addEventListener("scroll", checkScroll);
    return () => el?.removeEventListener("scroll", checkScroll);
  }, [categories]);

  const scroll = (dir: "left" | "right") => scrollRef.current?.scrollBy({ left: dir === "left" ? -300 : 300, behavior: "smooth" });

  if (categories.length === 0) return null;

  return (
    <div className="relative">
      {canLeft && (
        <button onClick={() => scroll("left")} className="absolute -left-1 top-0 z-10 flex h-full items-center bg-gradient-to-r from-[var(--bg)] to-transparent pr-4">
          <ChevronLeft size={18} className="text-gray-400" />
        </button>
      )}
      {canRight && (
        <button onClick={() => scroll("right")} className="absolute -right-1 top-0 z-10 flex h-full items-center bg-gradient-to-l from-[var(--bg)] to-transparent pl-4">
          <ChevronRight size={18} className="text-gray-400" />
        </button>
      )}
      <div ref={scrollRef} className="flex gap-1 overflow-x-auto scrollbar-none" style={{ scrollbarWidth: "none" }}>
        {[{ id: "", name: "All" }, ...categories].map((cat) => (
          <button
            key={cat.id}
            onClick={() => onChange(cat.id)}
            className={`relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors ${
              active === cat.id ? "text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {cat.name}
            {active === cat.id && <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--primary)]" />}
          </button>
        ))}
      </div>
      <div className="h-px bg-white/[0.06]" />
    </div>
  );
}

// ── Active filter pills ──────────────────────────────────────

function ActivePills({ params, categories, onRemove, onClear }: {
  params: URLSearchParams; categories: Category[]; onRemove: (key: string) => void; onClear: () => void;
}) {
  const pills: { key: string; label: string }[] = [];

  const cat = params.get("category");
  if (cat) pills.push({ key: "category", label: categories.find((c) => c.id === cat)?.name || "Category" });

  const genre = params.get("genre");
  if (genre) pills.push({ key: "genre", label: `Genre: ${genre}` });

  const dur = params.get("duration");
  if (dur) pills.push({ key: "duration", label: `Duration: ${DURATION_FILTERS.find((d) => d.value === dur)?.label || dur}` });

  const q = params.get("quality");
  if (q) pills.push({ key: "quality", label: q === "4k" ? "4K Ultra HD" : "HD 720p+" });

  const r = params.get("rating");
  if (r) pills.push({ key: "rating", label: `Rating: ${RATING_FILTERS.find((x) => x.value === r)?.label || r}` });

  const s = params.get("q");
  if (s) pills.push({ key: "q", label: `"${s}"` });

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pills.map((p) => (
        <span key={p.key} className="flex items-center gap-1.5 rounded-full bg-white/[0.08] py-1 pl-3 pr-2 text-xs text-gray-300">
          {p.label}
          <button onClick={() => onRemove(p.key)} className="rounded-full p-0.5 hover:bg-white/10"><X size={12} /></button>
        </span>
      ))}
      {pills.length > 1 && (
        <button onClick={onClear} className="text-xs text-gray-500 hover:text-white">Clear all</button>
      )}
    </div>
  );
}

// ── Main BrowsePage ──────────────────────────────────────────

export default function BrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const currentSort = searchParams.get("sort") || "recent";
  const currentCategory = searchParams.get("category") || "";
  const currentGenre = searchParams.get("genre") || "";
  const currentDuration = searchParams.get("duration") || "";
  const currentQuality = searchParams.get("quality") || "";
  const currentRating = searchParams.get("rating") || "";
  const currentSearch = searchParams.get("q") || "";
  const currentPage = parseInt(searchParams.get("page") || "1", 10);

  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [searchInput, setSearchInput] = useState(currentSearch);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch categories + genres once
  useEffect(() => {
    api.get<Category[]>("/categories").then(setCategories).catch(() => {});
    api.get<string[]>("/videos/genres").then(setGenres).catch(() => {});
  }, []);

  // Debounced search
  useEffect(() => { setSearchInput(currentSearch); }, [currentSearch]);

  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => updateParams({ q: val || null, page: null }), 400);
  };

  // Fetch videos
  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {
      page: String(currentPage),
      page_size: String(PAGE_SIZE),
      sort: currentSort,
    };
    if (currentCategory) params.category_id = currentCategory;
    if (currentSearch) params.search = currentSearch;
    if (currentRating) params.content_classification = currentRating;
    if (currentQuality) params.quality = currentQuality;
    if (currentGenre) params.tag = currentGenre;

    const dur = durationToParams(currentDuration);
    if (dur.min) params.min_duration = dur.min;
    if (dur.max) params.max_duration = dur.max;

    api
      .get<PaginatedResponse<Video>>("/videos", params)
      .then((data) => { setVideos(data.items); setTotal(data.total); })
      .catch(() => { setVideos([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [currentSort, currentCategory, currentSearch, currentPage, currentDuration, currentQuality, currentRating, currentGenre]);

  const videoIds = useMemo(() => videos.map((v) => v.id), [videos]);
  const progress = useWatchProgress(videoIds);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      });
    },
    [setSearchParams],
  );

  const setFilter = (key: string, val: string) => updateParams({ [key]: val || null, page: null });
  const setPage = (p: number) => updateParams({ page: p > 1 ? String(p) : null });
  const removeFilter = (key: string) => updateParams({ [key]: null, page: null });
  const clearAll = () => setSearchParams(new URLSearchParams());

  const hasFilters = currentCategory || currentSearch || currentDuration || currentQuality || currentRating || currentGenre || currentSort !== "recent";
  const activeFilterCount = [currentDuration, currentQuality, currentRating, currentGenre].filter(Boolean).length;

  return (
    <div className="min-h-screen pt-20 pb-12">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="px-12">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Browse</h1>
            {!loading && (
              <p className="mt-1 text-sm text-gray-500">
                {total.toLocaleString()} {total === 1 ? "title" : "titles"} available
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Keyword search */}
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search titles..."
                className="w-48 rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 outline-none transition-all focus:w-64 focus:border-white/20 focus:bg-white/[0.08]"
              />
              {searchInput && (
                <button onClick={() => handleSearchChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Sort */}
            <div className="relative flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-gray-300">
              <ArrowUpDown size={13} className="text-gray-500" />
              <select
                value={currentSort}
                onChange={(e) => setFilter("sort", e.target.value)}
                className="appearance-none bg-transparent pr-4 text-sm text-gray-200 outline-none"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-[#181818]">{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Filters toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                showFilters ? "border-[var(--primary)]/50 bg-[var(--primary)]/10 text-[var(--primary)]" : "border-white/10 text-gray-300 hover:border-white/20 hover:bg-white/[0.04]"
              }`}
            >
              <LayoutGrid size={14} />
              Filters
              {activeFilterCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--primary)] text-[10px] font-bold text-white">{activeFilterCount}</span>
              )}
            </button>

          </div>
        </div>
      </div>

      {/* ── Category tabs ──────────────────────────────────── */}
      <div className="mt-5 px-12">
        <CategoryBar categories={categories} active={currentCategory} onChange={(id) => setFilter("category", id)} />
      </div>

      {/* ── Filter panel ───────────────────────────────────── */}
      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showFilters ? "max-h-80 opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="mx-12 mt-4 space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 backdrop-blur-sm">
          {/* Genre */}
          {genres.length > 0 && (
            <FilterGroup icon={<Tag size={12} />} label="Genre">
              <Chip active={!currentGenre} onClick={() => setFilter("genre", "")}>All</Chip>
              {genres.map((g) => (
                <Chip key={g} active={currentGenre === g} onClick={() => setFilter("genre", g)}>
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </Chip>
              ))}
            </FilterGroup>
          )}

          {/* Duration */}
          <FilterGroup icon={<Clock size={12} />} label="Duration">
            {DURATION_FILTERS.map((d) => (
              <Chip key={d.value} active={currentDuration === d.value} onClick={() => setFilter("duration", d.value)}>{d.label}</Chip>
            ))}
          </FilterGroup>

          {/* Quality */}
          <FilterGroup icon={<Monitor size={12} />} label="Quality">
            {QUALITY_FILTERS.map((q) => (
              <Chip key={q.value} active={currentQuality === q.value} onClick={() => setFilter("quality", q.value)}>{q.label}</Chip>
            ))}
          </FilterGroup>

          {/* Rating */}
          <FilterGroup icon={<Shield size={12} />} label="Rating">
            {RATING_FILTERS.map((r) => (
              <Chip key={r.value} active={currentRating === r.value} onClick={() => setFilter("rating", r.value)}>{r.label}</Chip>
            ))}
          </FilterGroup>
        </div>
      </div>

      {/* ── Active pills ───────────────────────────────────── */}
      <div className="mt-4 px-12">
        <ActivePills params={searchParams} categories={categories} onRemove={removeFilter} onClear={clearAll} />
      </div>

      {/* ── Results ────────────────────────────────────────── */}
      <div className="mt-6 px-12">
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-gray-500">
            <Film size={48} className="mb-4 text-gray-700" />
            <p className="text-lg font-medium">No titles found</p>
            <p className="mt-1 text-sm">Try adjusting your filters or search</p>
            {hasFilters && (
              <button onClick={clearAll} className="mt-4 rounded-full bg-white/10 px-5 py-2 text-sm text-white hover:bg-white/20">
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-x-3 gap-y-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
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

            {totalPages > 1 && (
              <div className="mt-10 flex items-center justify-center gap-1">
                <button
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="flex items-center gap-1 rounded-full px-4 py-2 text-sm text-gray-400 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronLeft size={16} /> Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => {
                  const p = i + 1;
                  if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1) {
                    return (
                      <button key={p} onClick={() => setPage(p)} className={`min-w-[2.25rem] rounded-full px-2 py-1.5 text-sm font-medium ${p === currentPage ? "bg-[var(--primary)] text-white" : "text-gray-400 hover:bg-white/10"}`}>
                        {p}
                      </button>
                    );
                  }
                  if ((p === 2 && currentPage > 3) || (p === totalPages - 1 && currentPage < totalPages - 2)) {
                    return <span key={p} className="px-1 text-sm text-gray-600">...</span>;
                  }
                  return null;
                })}
                <button
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="flex items-center gap-1 rounded-full px-4 py-2 text-sm text-gray-400 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30"
                >
                  Next <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
