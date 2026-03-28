import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { Play, Plus, Check, ThumbsUp, ChevronDown, RotateCcw } from "lucide-react";
import Hls from "hls.js";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import type { Video } from "@/types/api";
import { formatDuration } from "@/lib/utils";

// Animation config
const ENTER_ANIM: [Keyframe[], KeyframeAnimationOptions] = [
  [
    { opacity: 0, transform: "scale(0.96)" },
    { opacity: 1, transform: "scale(1.05)" },
  ],
  { duration: 200, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" as const },
];
const EXIT_ANIM: [Keyframe[], KeyframeAnimationOptions] = [
  [
    { opacity: 1, transform: "scale(1.05)" },
    { opacity: 0, transform: "scale(0.96)" },
  ],
  { duration: 150, easing: "ease-in", fill: "forwards" as const },
];

interface VideoCardProps {
  video: Video;
  progressPercent?: number;
  progressSeconds?: number;
  watchCount?: number;
}

export default function VideoCard({ video, progressPercent, progressSeconds, watchCount }: VideoCardProps) {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const [showPopup, setShowPopup] = useState(false);
  const [inWatchlist, setInWatchlist] = useState<boolean | null>(null);
  const [isLiked, setIsLiked] = useState<boolean | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitAnim = useRef<Animation | null>(null);
  const isOpen = useRef(false); // avoid stale closure issues

  // ── Calculate popup position once (aligned exactly over card) ──
  const positionPopup = useCallback(() => {
    const card = cardRef.current;
    const popup = popupRef.current;
    if (!card || !popup) return;

    const rect = card.getBoundingClientRect();
    const width = rect.width;
    const popupH = (width * 9 / 16 + 140) * 1.05;

    let top = rect.top;
    if (top + popupH > window.innerHeight - 8) top = window.innerHeight - popupH - 8;
    top = Math.max(8, top);

    popup.style.top = `${top}px`;
    popup.style.left = `${rect.left}px`;
    popup.style.width = `${width}px`;
  }, []);

  // ── Open popup ─────────────────────────────────────────────
  const openPopup = useCallback(() => {
    // If currently closing, cancel exit animation
    if (exitAnim.current) {
      exitAnim.current.cancel();
      exitAnim.current = null;
    }
    isOpen.current = true;
    setShowPopup(true);
  }, []);

  // ── Close popup with exit animation ────────────────────────
  const closePopup = useCallback(() => {
    const popup = popupRef.current;
    if (!popup || !isOpen.current) return;
    isOpen.current = false;

    // Cancel any pending exit
    if (exitAnim.current) exitAnim.current.cancel();

    exitAnim.current = popup.animate(...EXIT_ANIM);
    exitAnim.current.onfinish = () => {
      exitAnim.current = null;
      setShowPopup(false);
    };
  }, []);

  // ── Mouse handlers (card) ─────────────────────────────────
  const handleCardEnter = useCallback(() => {
    if (exitTimer.current) { clearTimeout(exitTimer.current); exitTimer.current = null; }
    // Cancel exit animation if fading out
    if (exitAnim.current) {
      exitAnim.current.cancel();
      exitAnim.current = null;
      // Popup is still mounted, re-play enter
      if (popupRef.current) {
        positionPopup();
        popupRef.current.animate(...ENTER_ANIM);
      }
      isOpen.current = true;
      return;
    }
    if (isOpen.current) return;
    hoverTimer.current = setTimeout(openPopup, 400);
  }, [openPopup, positionPopup]);

  const handleCardLeave = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    exitTimer.current = setTimeout(closePopup, 150);
  }, [closePopup]);

  // ── Mouse handlers (popup) ────────────────────────────────
  const handlePopupEnter = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    if (exitTimer.current) { clearTimeout(exitTimer.current); exitTimer.current = null; }
    if (exitAnim.current) {
      exitAnim.current.cancel();
      exitAnim.current = null;
      if (popupRef.current) popupRef.current.animate(...ENTER_ANIM);
      isOpen.current = true;
    }
  }, []);

  const handlePopupLeave = useCallback(() => {
    exitTimer.current = setTimeout(closePopup, 150);
  }, [closePopup]);

  // ── Play enter animation + position on mount ──────────────
  useEffect(() => {
    if (!showPopup) return;
    positionPopup();
    popupRef.current?.animate(...ENTER_ANIM);
  }, [showPopup, positionPopup]);

  // ── Dismiss popup on scroll (>25px threshold) ─────────────
  useEffect(() => {
    if (!showPopup) return;
    const startY = window.scrollY;
    const onScroll = () => {
      if (Math.abs(window.scrollY - startY) > 25) {
        if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
        if (exitTimer.current) { clearTimeout(exitTimer.current); exitTimer.current = null; }
        closePopup();
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [showPopup, closePopup]);

  // ── Video preview (HLS or MP4) ─────────────────────────────
  useEffect(() => {
    if (!showPopup || !video.manifest_url) return;
    const el = videoRef.current;
    if (!el) return;
    const isHls = video.manifest_url.endsWith(".m3u8");
    // Seek to the AI-selected preview moment; fall back to 20% of duration or 30s
    const previewStart = video.preview_start_time
      ?? (video.duration > 0 ? video.duration * 0.20 : 30);

    const startAndPlay = () => {
      el.currentTime = previewStart;
      el.play().catch(() => {});
    };

    if (!isHls) {
      el.src = video.manifest_url;
      el.addEventListener("loadedmetadata", startAndPlay, { once: true });
    } else if (Hls.isSupported()) {
      const hls = new Hls({ startLevel: 0, capLevelToPlayerSize: true });
      hls.loadSource(video.manifest_url);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, startAndPlay);
      hlsRef.current = hls;
    } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = video.manifest_url;
      el.addEventListener("loadedmetadata", startAndPlay, { once: true });
    }

    return () => {
      el.pause();
      el.removeAttribute("src");
      el.load();
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [showPopup, video.manifest_url]);

  // ── Watchlist + reaction status ────────────────────────────
  useEffect(() => {
    if (!showPopup || !isAuthenticated) return;
    api.get<{ in_watchlist: boolean }>(`/watchlist/${video.id}/status`)
      .then((s) => setInWatchlist(s.in_watchlist)).catch(() => {});
    api.get<{ user_reaction: string | null }>(`/videos/${video.id}/reactions`)
      .then((r) => setIsLiked(r.user_reaction === "like")).catch(() => {});
  }, [showPopup, isAuthenticated, video.id]);

  // ── Cleanup ────────────────────────────────────────────────
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    if (exitAnim.current) exitAnim.current.cancel();
  }, []);

  // ── Actions ────────────────────────────────────────────────
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  const toggleWatchlist = async (e: React.MouseEvent) => {
    stop(e);
    if (!isAuthenticated) return;
    try {
      if (inWatchlist) { await api.delete(`/watchlist/${video.id}`); setInWatchlist(false); }
      else { await api.post(`/watchlist/${video.id}`); setInWatchlist(true); }
    } catch { /* silent */ }
  };

  const toggleLike = async (e: React.MouseEvent) => {
    stop(e);
    if (!isAuthenticated) return;
    try {
      if (isLiked) { await api.delete(`/videos/${video.id}/react`); setIsLiked(false); }
      else { await api.post(`/videos/${video.id}/react`, { reaction: "like" }); setIsLiked(true); }
    } catch { /* silent */ }
  };

  const handlePlay = (e: React.MouseEvent) => { stop(e); navigate(`/watch/${video.id}`); };
  const handleMoreInfo = (e: React.MouseEvent) => { stop(e); navigate(`/watch/${video.id}`); };

  // ── Derived ────────────────────────────────────────────────
  const isHD = video.source_height != null && video.source_height >= 720;
  const ratingLabel =
    video.content_classification === "explicit" ? "18+"
      : video.content_classification === "mature" ? "U/A 16+" : "U/A";
  const ratingColor =
    video.content_classification === "explicit" ? "border-red-500/50 text-red-400"
      : video.content_classification === "mature" ? "border-yellow-500/50 text-yellow-400"
        : "border-green-500/50 text-green-400";

  const hasProgress = progressPercent != null && progressPercent > 0;
  const totalMins = video.duration > 0 ? Math.round(video.duration / 60) : 0;
  const watchedMins = progressSeconds != null ? Math.round(progressSeconds / 60) : 0;
  const showTimeLabel = hasProgress && totalMins > 0;

  const progressBar = hasProgress ? (
    <div className="absolute bottom-0 left-0 right-0">
      {showTimeLabel && (
        <div className="flex justify-end px-1.5 pb-0.5">
          <span className="rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-gray-300">
            {watchedMins} of {totalMins}m
          </span>
        </div>
      )}
      <div className="h-1 bg-gray-600/80">
        <div className="h-full bg-red-600" style={{ width: `${Math.min(progressPercent!, 100)}%` }} />
      </div>
    </div>
  ) : null;

  const circleBtn = (
    active: boolean,
    onClick: (e: React.MouseEvent) => void,
    icon: React.ReactNode,
    title: string,
  ) => (
    <button
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors hover:border-white hover:text-white ${
        active ? "border-white bg-white/20 text-white" : "border-gray-500 text-gray-400"
      }`}
      title={title}
    >
      {icon}
    </button>
  );

  // ── Portal popup ───────────────────────────────────────────
  const popup = showPopup
    ? createPortal(
        <div
          ref={popupRef}
          onMouseEnter={handlePopupEnter}
          onMouseLeave={handlePopupLeave}
          style={{ position: "fixed", opacity: 0, transformOrigin: "center top" }}
          className="z-[60] rounded-lg bg-[#181818] shadow-2xl shadow-black/80 ring-1 ring-white/10"
        >
          <div className="relative aspect-video overflow-hidden rounded-t-lg">
            {video.manifest_url ? (
              <video
                ref={videoRef}
                muted
                playsInline
                className="h-full w-full object-cover"
                poster={video.thumbnail_url || undefined}
              />
            ) : video.thumbnail_url ? (
              <img src={video.thumbnail_url} alt={video.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center bg-gray-900 text-gray-600">
                <Play size={32} />
              </div>
            )}
            {progressBar}
          </div>

          <div className="p-3">
            <div className="flex items-center gap-2">
              <button
                onClick={handlePlay}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-110"
                title="Play"
              >
                <Play size={16} className="ml-0.5 fill-current" />
              </button>
              {circleBtn(inWatchlist === true, toggleWatchlist, inWatchlist ? <Check size={14} /> : <Plus size={14} />, inWatchlist ? "Remove from watchlist" : "Add to watchlist")}
              {circleBtn(isLiked === true, toggleLike, <ThumbsUp size={14} className={isLiked ? "fill-current" : ""} />, isLiked ? "Unlike" : "Like")}
              <div className="flex-1" />
              {circleBtn(false, handleMoreInfo, <ChevronDown size={14} />, "More info")}
            </div>
            <p className="mt-2 truncate text-sm font-semibold text-white">{video.title}</p>
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              <span className={`rounded border px-1.5 py-0.5 font-medium ${ratingColor}`}>{ratingLabel}</span>
              {video.duration > 0 && <span className="text-gray-400">{formatDuration(video.duration)}</span>}
              {isHD && <span className="rounded border border-gray-500 px-1 py-0.5 text-[10px] font-semibold text-gray-400">HD</span>}
            </div>
            {video.tags.length > 0 && (
              <p className="mt-1.5 truncate text-xs text-gray-400">{video.tags.slice(0, 3).join(" \u00b7 ")}</p>
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      ref={cardRef}
      className="relative"
      onMouseEnter={handleCardEnter}
      onMouseLeave={handleCardLeave}
    >
      <Link to={`/watch/${video.id}`} className="group block">
        <div className="relative aspect-video overflow-hidden rounded-md bg-[var(--card)]">
          {video.thumbnail_url ? (
            <img
              src={video.thumbnail_url}
              alt={video.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-600">
              <Play size={24} />
            </div>
          )}
          {video.duration > 0 && !hasProgress && (
            <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white">
              {formatDuration(video.duration)}
            </span>
          )}
          {watchCount != null && watchCount > 0 && (
            <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
              <RotateCcw size={10} /> Watch Again
            </span>
          )}
          {progressBar}
        </div>
        <p className="mt-1.5 truncate text-sm font-medium group-hover:text-[var(--primary)]">
          {video.title}
        </p>
        <p className="text-xs text-gray-500">
          {watchCount != null && watchCount > 0
            ? `Watched ${watchCount} ${watchCount === 1 ? "time" : "times"}`
            : `${video.view_count.toLocaleString()} views`}
        </p>
      </Link>
      {popup}
    </div>
  );
}
