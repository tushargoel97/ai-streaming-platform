import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import VideoCard from "./VideoCard";
import type { Video } from "@/types/api";

interface CarouselRowProps {
  title: string;
  videos: Video[];
  progress: Record<string, { progress: number; percentage: number; watch_count?: number }>;
  cardWidth?: number;
  ranked?: boolean;
}

// Width of a portrait Top 10 card
const PORTRAIT_WIDTH = 155;

export default function CarouselRow({
  title,
  videos,
  progress,
  cardWidth = 280,
  ranked = false,
}: CarouselRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hoveredRankedId, setHoveredRankedId] = useState<string | null>(null);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 10);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) el.addEventListener("scroll", checkScroll);
    return () => el?.removeEventListener("scroll", checkScroll);
  }, [videos]);

  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.75;
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  };

  if (videos.length === 0) return null;

  return (
    <section className="group/row relative py-6">
      {/* ── Section header ─────────────────────────────────── */}
      <div className="mb-5 px-12">
        {ranked ? (
          /* Cineby-style "TOP 10 CONTENT TODAY" header */
          <div className="flex items-end gap-4">
            <span
              className="select-none leading-none"
              style={{
                fontSize: "72px",
                fontWeight: 900,
                color: "var(--primary)",
                lineHeight: 1,
              }}
            >
              TOP 10
            </span>
            <div className="mb-1.5 flex flex-col leading-snug">
              <span className="text-[11px] font-bold uppercase tracking-[0.35em] text-white/40">
                Content
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.35em] text-white/40">
                Today
              </span>
            </div>
          </div>
        ) : (
          /* Standard row header with red left accent */
          <h2 className="flex items-center gap-3 text-xl font-semibold">
            <span className="h-5 w-1 rounded-full bg-red-500" />
            {title}
          </h2>
        )}
      </div>

      {/* ── Scrollable area ────────────────────────────────── */}
      <div className="relative">
        {/* Left scroll button */}
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            className="absolute left-0 top-0 z-20 flex h-full w-16 items-center justify-start pl-3 opacity-0 transition-opacity duration-200 group-hover/row:opacity-100"
            style={{
              background: "linear-gradient(to right, var(--bg) 20%, transparent 100%)",
            }}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-sm transition-all hover:bg-black/80 hover:scale-110">
              <ChevronLeft size={20} />
            </div>
          </button>
        )}

        {/* Right scroll button */}
        {canScrollRight && (
          <button
            onClick={() => scroll("right")}
            className="absolute right-0 top-0 z-20 flex h-full w-16 items-center justify-end pr-3 opacity-0 transition-opacity duration-200 group-hover/row:opacity-100"
            style={{
              background: "linear-gradient(to left, var(--bg) 20%, transparent 100%)",
            }}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-lg backdrop-blur-sm transition-all hover:bg-black/80 hover:scale-110">
              <ChevronRight size={20} />
            </div>
          </button>
        )}

        {/* Cards */}
        <div
          ref={scrollRef}
          className="scrollbar-none flex overflow-x-auto px-12"
          style={{ gap: ranked ? "0px" : "10px" }}
        >
          {videos.map((v, i) =>
            ranked ? (
              /* ── Ranked item: big number left, portrait card right ── */
              <div
                key={v.id}
                className="flex flex-shrink-0 items-end"
                onMouseEnter={() => setHoveredRankedId(v.id)}
                onMouseLeave={() => setHoveredRankedId(null)}
              >
                <span
                  className="flex-shrink-0 select-none font-black leading-none transition-all duration-200"
                  style={{
                    fontSize: "120px",
                    lineHeight: 1,
                    paddingBottom: "12px",
                    marginRight: "-22px",
                    color: hoveredRankedId === v.id ? "#e50914" : "transparent",
                    WebkitTextStroke: hoveredRankedId === v.id ? "0px" : "3px #e50914",
                    zIndex: 1,
                    minWidth: i >= 9 ? "110px" : "80px",
                    textAlign: "right",
                  }}
                >
                  {i + 1}
                </span>
                <div className="relative z-10 flex-shrink-0" style={{ width: PORTRAIT_WIDTH }}>
                  <VideoCard
                    video={v}
                    progressPercent={progress[v.id]?.percentage}
                    progressSeconds={progress[v.id]?.progress}
                    watchCount={progress[v.id]?.watch_count}
                    portrait
                  />
                </div>
              </div>
            ) : (
              /* ── Standard landscape card ── */
              <div key={v.id} className="flex-shrink-0" style={{ width: cardWidth }}>
                <VideoCard
                  video={v}
                  progressPercent={progress[v.id]?.percentage}
                  progressSeconds={progress[v.id]?.progress}
                  watchCount={progress[v.id]?.watch_count}
                />
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}
