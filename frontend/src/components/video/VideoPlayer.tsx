import { useState, useRef, useEffect, useCallback } from "react";
import Hls from "hls.js";
import type { Level } from "hls.js";
import {
  Play,
  Pause,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  SkipBack,
  SkipForward,
  Loader2,
  Subtitles,
  Settings,
  Check,
  ChevronLeft,
  ChevronRight,
  Languages,
  Gauge,
  MonitorPlay,
} from "lucide-react";
import type { AudioTrack, SubtitleTrack } from "@/types/api";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// ── Types ────────────────────────────────────────────────────────────────────

export interface VideoPlayerProps {
  manifestUrl: string;
  posterUrl?: string;
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
  startTime?: number;
  autoPlay?: boolean;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
}

type SettingsPanel = "main" | "quality" | "speed" | "audio-subs";

// ── Component ────────────────────────────────────────────────────────────────

export default function VideoPlayer({
  manifestUrl,
  posterUrl,
  subtitleTracks = [],
  startTime = 0,
  autoPlay = false,
  onTimeUpdate,
  onEnded,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekPreviewRef = useRef<HTMLDivElement | null>(null);
  const volumeAreaRef = useRef<HTMLDivElement | null>(null);

  // Player state
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loading, setLoading] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Volume hover
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const volumeHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>("main");


  // Skip animation
  const [skipAnimation, setSkipAnimation] = useState<"back" | "forward" | null>(null);

  // HLS state
  const [hlsLevels, setHlsLevels] = useState<Level[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [hlsAudioTracks, setHlsAudioTracks] = useState<{ id: number; name: string; lang: string }[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState(0);
  const [activeSubtitle, setActiveSubtitle] = useState<string | null>(null);

  // Progress bar hover/drag
  const [progressHover, setProgressHover] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // ── Init HLS / MP4 ──────────────────────────────────────────────────────

  const isHls = manifestUrl?.endsWith(".m3u8");

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !manifestUrl) return;

    setLoading(true);

    // Direct MP4 playback (non-HLS source)
    if (!isHls) {
      el.src = manifestUrl;
      const onLoaded = () => {
        if (startTime > 0) el.currentTime = startTime;
        if (autoPlay) el.play().catch(() => {});
        setLoading(false);
      };
      el.addEventListener("loadedmetadata", onLoaded);
      return () => {
        el.removeEventListener("loadedmetadata", onLoaded);
        el.removeAttribute("src");
        el.load();
      };
    }

    // HLS playback
    if (Hls.isSupported()) {
      const hls = new Hls({
        startLevel: -1,
        capLevelToPlayerSize: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });

      hls.loadSource(manifestUrl);
      hls.attachMedia(el);

      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        setHlsLevels(data.levels);
        setCurrentLevel(-1);

        const audioTracks = hls.audioTracks.map((t, i) => ({
          id: i,
          name: t.name || t.lang || `Track ${i + 1}`,
          lang: t.lang || "",
        }));
        setHlsAudioTracks(audioTracks);

        if (startTime > 0) el.currentTime = startTime;
        if (autoPlay) el.play().catch(() => {});
        setLoading(false);
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        setCurrentLevel(data.level);
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          }
        }
      });

      hlsRef.current = hls;
    } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = manifestUrl;
      el.addEventListener("loadedmetadata", () => {
        if (startTime > 0) el.currentTime = startTime;
        if (autoPlay) el.play().catch(() => {});
        setLoading(false);
      });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [manifestUrl]);

  // ── Load subtitle tracks ──────────────────────────────────────────────────

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    while (el.firstChild) el.removeChild(el.firstChild);

    subtitleTracks.forEach((st) => {
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = st.label;
      track.srclang = st.language;
      track.src = st.file_url || `/media/${st.file_path}`;
      if (st.is_default) {
        track.default = true;
        setActiveSubtitle(st.language);
      }
      el.appendChild(track);
      if (track.track) {
        track.track.mode = st.is_default ? "showing" : "hidden";
      }
    });
  }, [subtitleTracks]);

  // ── Video element event handlers ───────────────────────────────────────────

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeupdate = () => {
      setCurrentTime(el.currentTime);
      onTimeUpdate?.(el.currentTime, el.duration);
    };
    const onDurationChange = () => setDuration(el.duration);
    const onProgress = () => {
      if (el.buffered.length > 0) {
        setBuffered(el.buffered.end(el.buffered.length - 1));
      }
    };
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onEndedHandler = () => {
      setPlaying(false);
      onEnded?.();
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTimeupdate);
    el.addEventListener("durationchange", onDurationChange);
    el.addEventListener("progress", onProgress);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("ended", onEndedHandler);

    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTimeupdate);
      el.removeEventListener("durationchange", onDurationChange);
      el.removeEventListener("progress", onProgress);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("ended", onEndedHandler);
    };
  }, [onTimeUpdate, onEnded]);

  // ── Controls auto-hide ─────────────────────────────────────────────────────

  const anyPanelOpen = settingsOpen;

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !anyPanelOpen) {
        setShowControls(false);
      }
    }, 3000);
  }, [anyPanelOpen]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = videoRef.current;
      if (!el) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          el.paused ? el.play() : el.pause();
          resetHideTimer();
          break;
        case "ArrowLeft":
          e.preventDefault();
          el.currentTime = Math.max(0, el.currentTime - 10);
          triggerSkipAnimation("back");
          resetHideTimer();
          break;
        case "ArrowRight":
          e.preventDefault();
          el.currentTime = Math.min(el.duration, el.currentTime + 10);
          triggerSkipAnimation("forward");
          resetHideTimer();
          break;
        case "ArrowUp":
          e.preventDefault();
          el.volume = Math.min(1, el.volume + 0.1);
          setVolume(el.volume);
          resetHideTimer();
          break;
        case "ArrowDown":
          e.preventDefault();
          el.volume = Math.max(0, el.volume - 0.1);
          setVolume(el.volume);
          resetHideTimer();
          break;
        case "m":
          e.preventDefault();
          el.muted = !el.muted;
          setMuted(el.muted);
          resetHideTimer();
          break;
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "c":
          e.preventDefault();
          // Toggle subtitles
          if (activeSubtitle) {
            selectSubtitle(null);
          } else if (subtitleTracks.length > 0 && subtitleTracks[0]) {
            selectSubtitle(subtitleTracks[0].language);
          }
          break;
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [resetHideTimer, activeSubtitle, subtitleTracks]);

  // ── Skip animation ─────────────────────────────────────────────────────────

  const triggerSkipAnimation = (dir: "back" | "forward") => {
    setSkipAnimation(dir);
    setTimeout(() => setSkipAnimation(null), 600);
  };

  // ── Fullscreen ─────────────────────────────────────────────────────────────

  const toggleFullscreen = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      c.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    el.paused ? el.play() : el.pause();
    resetHideTimer();
  };

  const toggleMute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = videoRef.current;
    if (!el) return;
    const val = parseFloat(e.target.value);
    el.volume = val;
    el.muted = val === 0;
    setVolume(val);
    setMuted(val === 0);
  };

  const seek = (e: React.MouseEvent) => {
    const el = videoRef.current;
    const bar = progressRef.current;
    if (!el || !bar) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = pct * el.duration;
    resetHideTimer();
  };

  const handleProgressHover = (e: React.MouseEvent) => {
    const bar = progressRef.current;
    const preview = seekPreviewRef.current;
    if (!bar || !preview || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    preview.textContent = formatTime(pct * duration);
    preview.style.left = `${pct * 100}%`;
    preview.style.display = "block";
    setProgressHover(true);
  };

  const handleProgressLeave = () => {
    if (seekPreviewRef.current) seekPreviewRef.current.style.display = "none";
    if (!isDragging) setProgressHover(false);
  };

  // ── Progress bar drag ──────────────────────────────────────────────────────

  const handleProgressMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    seek(e);

    const onMouseMove = (ev: MouseEvent) => {
      const el = videoRef.current;
      const bar = progressRef.current;
      if (!el || !bar) return;
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      el.currentTime = pct * el.duration;
    };

    const onMouseUp = () => {
      setIsDragging(false);
      setProgressHover(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const skip = (seconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration, el.currentTime + seconds));
    triggerSkipAnimation(seconds < 0 ? "back" : "forward");
    resetHideTimer();
  };

  // ── Quality selection ──────────────────────────────────────────────────────

  const setQuality = (level: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
    }
    setCurrentLevel(level);
  };

  // ── Audio track selection ──────────────────────────────────────────────────

  const selectAudioTrack = (trackId: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackId;
    }
    setCurrentAudioTrack(trackId);
  };

  // ── Subtitle selection ─────────────────────────────────────────────────────

  const selectSubtitle = (lang: string | null) => {
    const el = videoRef.current;
    if (!el) return;
    for (let i = 0; i < el.textTracks.length; i++) {
      const track = el.textTracks[i];
      if (track) {
        track.mode = track.language === lang ? "showing" : "hidden";
      }
    }
    setActiveSubtitle(lang);
  };

  // ── Playback speed ────────────────────────────────────────────────────────

  const changeSpeed = (speed: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.playbackRate = speed;
    setPlaybackSpeed(speed);
  };

  // ── Settings panel toggle ──────────────────────────────────────────────────

  const toggleSettings = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (settingsOpen) {
      setSettingsOpen(false);
      setSettingsPanel("main");
    } else {
      setSettingsOpen(true);
      setSettingsPanel("main");
    }
  };

  // ── Volume hover ───────────────────────────────────────────────────────────

  const handleVolumeEnter = () => {
    if (volumeHideTimer.current) clearTimeout(volumeHideTimer.current);
    setShowVolumeSlider(true);
  };

  const handleVolumeLeave = () => {
    volumeHideTimer.current = setTimeout(() => setShowVolumeSlider(false), 300);
  };

  // ── Computed ───────────────────────────────────────────────────────────────

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  const currentLevelLabel =
    currentLevel === -1
      ? "Auto"
      : hlsLevels[currentLevel]
        ? `${hlsLevels[currentLevel].height}p`
        : "Auto";

  const currentLevelHeight =
    currentLevel >= 0 && hlsLevels[currentLevel]
      ? hlsLevels[currentLevel].height
      : null;

  const autoSuffix =
    currentLevel === -1 && hlsRef.current && hlsRef.current.currentLevel >= 0
      ? ` (${hlsLevels[hlsRef.current.currentLevel]?.height ?? "?"}p)`
      : "";

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // ── Settings panel content ─────────────────────────────────────────────────

  const renderSettingsPanel = () => {
    switch (settingsPanel) {
      case "main":
        return (
          <div className="w-[280px]">
            {/* Playback Speed */}
            <button
              onClick={(e) => { e.stopPropagation(); setSettingsPanel("speed"); }}
              className="flex w-full items-center gap-3 px-4 py-3 text-sm text-white transition-colors hover:bg-white/10"
            >
              <Gauge size={18} className="text-gray-400" />
              <span className="flex-1 text-left">Playback speed</span>
              <span className="text-gray-400">{playbackSpeed === 1 ? "Normal" : `${playbackSpeed}x`}</span>
              <ChevronRight size={16} className="text-gray-500" />
            </button>

            {/* Quality */}
            {hlsLevels.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); setSettingsPanel("quality"); }}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm text-white transition-colors hover:bg-white/10"
              >
                <MonitorPlay size={18} className="text-gray-400" />
                <span className="flex-1 text-left">Quality</span>
                <span className="text-gray-400">{currentLevelLabel}{autoSuffix}</span>
                <ChevronRight size={16} className="text-gray-500" />
              </button>
            )}

            {/* Audio & Subtitles — always visible */}
            <button
              onClick={(e) => { e.stopPropagation(); setSettingsPanel("audio-subs"); }}
              className="flex w-full items-center gap-3 px-4 py-3 text-sm text-white transition-colors hover:bg-white/10"
            >
              <Subtitles size={18} className="text-gray-400" />
              <span className="flex-1 text-left">Audio & Subtitles</span>
              <ChevronRight size={16} className="text-gray-500" />
            </button>
          </div>
        );

      case "speed":
        return (
          <div className="w-[280px]">
            <button
              onClick={(e) => { e.stopPropagation(); setSettingsPanel("main"); }}
              className="flex w-full items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium text-white hover:bg-white/10"
            >
              <ChevronLeft size={16} />
              Playback speed
            </button>
            <div className="max-h-[280px] overflow-y-auto py-1">
              {PLAYBACK_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  onClick={(e) => { e.stopPropagation(); changeSpeed(speed); }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/10 ${
                    playbackSpeed === speed ? "text-white" : "text-gray-400"
                  }`}
                >
                  <span className="w-5">
                    {playbackSpeed === speed && <Check size={16} className="text-white" />}
                  </span>
                  {speed === 1 ? "Normal" : `${speed}x`}
                </button>
              ))}
            </div>
          </div>
        );

      case "quality":
        return (
          <div className="w-[280px]">
            <button
              onClick={(e) => { e.stopPropagation(); setSettingsPanel("main"); }}
              className="flex w-full items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium text-white hover:bg-white/10"
            >
              <ChevronLeft size={16} />
              Quality
            </button>
            <div className="py-1">
              <button
                onClick={(e) => { e.stopPropagation(); setQuality(-1); }}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/10 ${
                  currentLevel === -1 ? "text-white" : "text-gray-400"
                }`}
              >
                <span className="w-5">
                  {currentLevel === -1 && <Check size={16} className="text-white" />}
                </span>
                <span>Auto{autoSuffix}</span>
              </button>
              {[...hlsLevels]
                .map((level, i) => ({ level, i }))
                .sort((a, b) => b.level.height - a.level.height)
                .map(({ level, i }) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); setQuality(i); }}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/10 ${
                      currentLevel === i ? "text-white" : "text-gray-400"
                    }`}
                  >
                    <span className="w-5">
                      {currentLevel === i && <Check size={16} className="text-white" />}
                    </span>
                    <span>{level.height}p</span>
                    {level.height >= 720 && (
                      <span className={`rounded border px-1 py-0.5 text-[10px] font-bold ${
                        level.height >= 2160
                          ? "border-amber-400/50 text-amber-400"
                          : level.height >= 1440
                            ? "border-purple-400/50 text-purple-400"
                            : "border-blue-400/50 text-blue-400"
                      }`}>
                        {level.height >= 2160 ? "4K" : level.height >= 1440 ? "2K" : level.height >= 1080 ? "FHD" : "HD"}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          </div>
        );

      case "audio-subs":
        return (
          <div className="w-[420px]">
            <button
              onClick={(e) => { e.stopPropagation(); setSettingsPanel("main"); }}
              className="flex w-full items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium text-white hover:bg-white/10"
            >
              <ChevronLeft size={16} />
              Audio & Subtitles
            </button>
            <div className="flex divide-x divide-white/10">
              {/* Audio column */}
              <div className="flex-1 py-2">
                <p className="mb-1 px-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Audio
                </p>
                {hlsAudioTracks.length <= 1 ? (
                  <p className="px-4 py-2 text-sm text-gray-500">No alternate audio</p>
                ) : (
                  hlsAudioTracks.map((track) => (
                    <button
                      key={track.id}
                      onClick={(e) => { e.stopPropagation(); selectAudioTrack(track.id); }}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-white/10 ${
                        currentAudioTrack === track.id ? "text-white" : "text-gray-400"
                      }`}
                    >
                      <span className="w-5">
                        {currentAudioTrack === track.id && <Check size={14} className="text-white" />}
                      </span>
                      <Languages size={14} className="text-gray-500" />
                      {track.name}
                    </button>
                  ))
                )}
              </div>

              {/* Subtitles column */}
              <div className="flex-1 py-2">
                <p className="mb-1 px-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Subtitles
                </p>
                {subtitleTracks.length === 0 ? (
                  <p className="px-4 py-2 text-sm text-gray-500">No subtitles available</p>
                ) : (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); selectSubtitle(null); }}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-white/10 ${
                        !activeSubtitle ? "text-white" : "text-gray-400"
                      }`}
                    >
                      <span className="w-5">
                        {!activeSubtitle && <Check size={14} className="text-white" />}
                      </span>
                      Off
                    </button>
                    {subtitleTracks.map((st) => (
                      <button
                        key={st.id}
                        onClick={(e) => { e.stopPropagation(); selectSubtitle(st.language); }}
                        className={`flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-white/10 ${
                          activeSubtitle === st.language ? "text-white" : "text-gray-400"
                        }`}
                      >
                        <span className="w-5">
                          {activeSubtitle === st.language && <Check size={14} className="text-white" />}
                        </span>
                        {st.label}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        );
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="group relative aspect-video w-full overflow-hidden bg-black"
      onMouseMove={resetHideTimer}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-controls]")) return;
        if ((e.target as HTMLElement).closest("[data-settings]")) return;
        togglePlay();
        setSettingsOpen(false);
      }}
    >
      <video
        ref={videoRef}
        className="h-full w-full"
        playsInline
        poster={posterUrl}
      />

      {/* Loading spinner */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-12 w-12 animate-spin text-white/70" />
        </div>
      )}

      {/* Big center play button when paused */}
      {!playing && !loading && (
        <button
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-black/40 backdrop-blur-md transition-transform hover:scale-110">
            <Play size={36} className="ml-1.5 text-white" fill="white" />
          </div>
        </button>
      )}

      {/* Skip animation overlays */}
      {skipAnimation === "back" && (
        <div className="absolute left-[15%] top-1/2 -translate-x-1/2 -translate-y-1/2 animate-ping">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
            <SkipBack size={28} className="text-white" />
          </div>
        </div>
      )}
      {skipAnimation === "forward" && (
        <div className="absolute right-[15%] top-1/2 -translate-y-1/2 translate-x-1/2 animate-ping">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
            <SkipForward size={28} className="text-white" />
          </div>
        </div>
      )}

      {/* Controls overlay */}
      <div
        data-controls
        className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 ${
          showControls || anyPanelOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {/* Gradient */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

        <div className="relative px-3 pb-3 pt-20 sm:px-5">
          {/* Progress bar */}
          <div
            ref={progressRef}
            className={`group/progress relative mb-3 cursor-pointer transition-all ${
              progressHover || isDragging ? "h-[6px]" : "h-[3px]"
            }`}
            onMouseDown={handleProgressMouseDown}
            onMouseMove={handleProgressHover}
            onMouseLeave={handleProgressLeave}
            onMouseEnter={() => setProgressHover(true)}
          >
            {/* Track background */}
            <div className="absolute inset-0 rounded-full bg-white/20" />
            {/* Buffered */}
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-white/30"
              style={{ width: `${bufferedPct}%` }}
            />
            {/* Played */}
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-red-600"
              style={{ width: `${progressPct}%` }}
            />
            {/* Seek dot */}
            <div
              className={`absolute top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600 shadow-md transition-transform ${
                progressHover || isDragging ? "scale-100" : "scale-0"
              }`}
              style={{ left: `${progressPct}%` }}
            />
            {/* Seek preview tooltip */}
            <div
              ref={seekPreviewRef}
              className="absolute -top-9 hidden -translate-x-1/2 rounded-md bg-black/95 px-2.5 py-1 text-xs font-medium text-white shadow-lg"
            />
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="rounded-full p-2 text-white transition-colors hover:bg-white/10"
              title={playing ? "Pause (k)" : "Play (k)"}
            >
              {playing ? <Pause size={22} fill="white" /> : <Play size={22} className="ml-0.5" fill="white" />}
            </button>

            {/* Skip back */}
            <button
              onClick={() => skip(-10)}
              className="rounded-full p-2 text-white transition-colors hover:bg-white/10"
              title="Back 10s (←)"
            >
              <SkipBack size={20} />
            </button>

            {/* Skip forward */}
            <button
              onClick={() => skip(10)}
              className="rounded-full p-2 text-white transition-colors hover:bg-white/10"
              title="Forward 10s (→)"
            >
              <SkipForward size={20} />
            </button>

            {/* Volume group */}
            <div
              ref={volumeAreaRef}
              className="flex items-center"
              onMouseEnter={handleVolumeEnter}
              onMouseLeave={handleVolumeLeave}
            >
              <button
                onClick={toggleMute}
                className="rounded-full p-2 text-white transition-colors hover:bg-white/10"
                title={muted ? "Unmute (m)" : "Mute (m)"}
              >
                <VolumeIcon size={22} />
              </button>
              <div
                className={`overflow-hidden transition-all duration-200 ${
                  showVolumeSlider ? "w-20 opacity-100" : "w-0 opacity-0"
                }`}
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.02"
                  value={muted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/30 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
                />
              </div>
            </div>

            {/* Time display */}
            <span className="ml-1.5 select-none text-[13px] font-medium tabular-nums text-white/90">
              {formatTime(currentTime)}
              <span className="mx-1 text-white/40">/</span>
              {formatTime(duration)}
            </span>

            <div className="flex-1" />

            {/* CC toggle — simple on/off */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (activeSubtitle) {
                  selectSubtitle(null);
                } else if (subtitleTracks.length > 0) {
                  const def = subtitleTracks.find((s) => s.is_default) ?? subtitleTracks[0];
                  if (def) selectSubtitle(def.language);
                }
              }}
              className={`relative rounded-full p-2 transition-colors hover:bg-white/10 ${
                activeSubtitle ? "text-white" : "text-white/60"
              }`}
              title={`Subtitles (c)${activeSubtitle ? " — On" : " — Off"}`}
            >
              <Subtitles size={20} />
              {activeSubtitle && (
                <span className="absolute bottom-1 left-1/2 h-[2px] w-4 -translate-x-1/2 rounded-full bg-red-600" />
              )}
            </button>

            {/* Speed indicator (only when not 1x) */}
            {playbackSpeed !== 1 && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs font-bold text-white">
                {playbackSpeed}x
              </span>
            )}

            {/* Quality badge */}
            {currentLevelHeight && currentLevelHeight >= 720 && (
              <span className={`rounded border px-1 py-0.5 text-[10px] font-bold ${
                currentLevelHeight >= 2160
                  ? "border-amber-400/50 text-amber-400"
                  : currentLevelHeight >= 1440
                    ? "border-purple-400/50 text-purple-400"
                    : "border-white/30 text-white/80"
              }`}>
                {currentLevelHeight >= 2160 ? "4K" : currentLevelHeight >= 1440 ? "2K" : currentLevelHeight >= 1080 ? "FHD" : "HD"}
              </span>
            )}

            {/* Settings button */}
            <div className="relative" data-settings>
              <button
                onClick={toggleSettings}
                className={`rounded-full p-2 transition-all hover:bg-white/10 ${
                  settingsOpen ? "rotate-45 text-white" : "text-white"
                }`}
                title="Settings"
              >
                <Settings size={20} />
              </button>

              {/* Settings panel */}
              {settingsOpen && (
                <div
                  className="absolute bottom-full right-0 mb-2 overflow-hidden rounded-xl bg-[#1a1a1a]/95 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {renderSettingsPanel()}
                </div>
              )}
            </div>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="rounded-full p-2 text-white transition-colors hover:bg-white/10"
              title="Fullscreen (f)"
            >
              {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
