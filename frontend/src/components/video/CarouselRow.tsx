import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import VideoCard from "./VideoCard";
import type { Video } from "@/types/api";

interface CarouselRowProps {
  title: string;
  videos: Video[];
  progress: Record<string, { progress: number; percentage: number; watch_count?: number }>;
  cardWidth?: number;
}

export default function CarouselRow({
  title,
  videos,
  progress,
  cardWidth = 280,
}: CarouselRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
    const amount = el.clientWidth * 0.8;
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  };

  if (videos.length === 0) return null;

  return (
    <section className="group/row relative px-12 py-4">
      <h2 className="mb-3 text-xl font-semibold">{title}</h2>
      <div className="relative">
        {/* Scroll buttons */}
        {canScrollLeft && (
          <button
            onClick={() => scroll("left")}
            className="absolute -left-5 top-1/2 z-20 flex h-full -translate-y-1/2 items-center bg-gradient-to-r from-[var(--bg)] to-transparent px-2 opacity-0 transition-opacity group-hover/row:opacity-100"
          >
            <ChevronLeft size={28} />
          </button>
        )}
        {canScrollRight && (
          <button
            onClick={() => scroll("right")}
            className="absolute -right-5 top-1/2 z-20 flex h-full -translate-y-1/2 items-center bg-gradient-to-l from-[var(--bg)] to-transparent px-2 opacity-0 transition-opacity group-hover/row:opacity-100"
          >
            <ChevronRight size={28} />
          </button>
        )}

        {/* Cards */}
        <div
          ref={scrollRef}
          className="flex gap-2 overflow-x-auto scrollbar-none"
          style={{ scrollbarWidth: "none" }}
        >
          {videos.map((v) => (
            <div key={v.id} className="flex-shrink-0" style={{ width: cardWidth }}>
              <VideoCard
                video={v}
                progressPercent={progress[v.id]?.percentage}
                progressSeconds={progress[v.id]?.progress}
                watchCount={progress[v.id]?.watch_count}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
