import { useRef, useEffect, useState } from "react";
import Hls from "hls.js";
import { Loader2, Volume2, VolumeX, Maximize } from "lucide-react";

interface LivePlayerProps {
  manifestUrl: string;
  autoPlay?: boolean;
}

export default function LivePlayer({ manifestUrl, autoPlay = true }: LivePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true); // Start muted for autoplay
  const [showControls, setShowControls] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !manifestUrl) return;

    setLoading(true);
    setError(null);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        liveDurationInfinity: true,
        // Faster recovery for live
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 6,
        levelLoadingTimeOut: 10000,
        fragLoadingTimeOut: 20000,
      });

      hls.loadSource(manifestUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        if (autoPlay) {
          video.play().catch(() => {
            // Autoplay blocked — stay muted
            video.muted = true;
            video.play().catch(() => {});
          });
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Try to recover
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setError("Stream unavailable");
              hls.destroy();
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS
      video.src = manifestUrl;
      video.addEventListener("loadedmetadata", () => {
        setLoading(false);
        if (autoPlay) video.play().catch(() => {});
      });
    } else {
      setError("HLS playback not supported");
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [manifestUrl, autoPlay]);

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  };

  return (
    <div
      ref={containerRef}
      className="group relative aspect-video bg-black"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShowControls(false)}
    >
      <video
        ref={videoRef}
        className="h-full w-full"
        muted={muted}
        playsInline
      />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <Loader2 className="h-10 w-10 animate-spin text-white" />
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <p className="text-gray-400">{error}</p>
        </div>
      )}

      {/* Live badge */}
      {!error && !loading && (
        <div className="absolute left-4 top-4">
          <span className="flex items-center gap-1.5 rounded bg-red-600 px-2.5 py-1 text-xs font-bold uppercase text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            Live
          </span>
        </div>
      )}

      {/* Controls overlay */}
      {showControls && !error && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
          <div className="flex items-center justify-end gap-3">
            <button onClick={toggleMute} className="text-white hover:text-gray-300">
              {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <button onClick={toggleFullscreen} className="text-white hover:text-gray-300">
              <Maximize size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
