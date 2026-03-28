import { useEffect, useRef, useCallback, useState } from "react";
import { WS_URL } from "@/lib/constants";

interface UsePlayerSessionOptions {
  videoId: string;
  enabled?: boolean;
}

/**
 * WebSocket hook for VOD player sessions.
 *
 * Connects to /ws/player/{videoId}, sends periodic heartbeat messages
 * with playback position and quality, and receives real-time viewer counts.
 */
export function usePlayerSession({ videoId, enabled = true }: UsePlayerSessionOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentTimeRef = useRef(0);
  const qualityRef = useRef("");
  const [viewerCount, setViewerCount] = useState(0);

  useEffect(() => {
    if (!enabled || !videoId) return;

    const token = localStorage.getItem("access_token");
    const url = `${WS_URL}/player/${videoId}${token ? `?token=${token}` : ""}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      // Ping every 30s
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);

      // Heartbeat every 15s
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "heartbeat",
              current_time: currentTimeRef.current,
              quality: qualityRef.current,
            })
          );
        }
      }, 15000);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "viewer_count") {
          setViewerCount(data.viewer_count);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      if (pingRef.current) clearInterval(pingRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };

    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [videoId, enabled]);

  /** Call this from the player's timeupdate handler */
  const updateTime = useCallback((time: number) => {
    currentTimeRef.current = time;
  }, []);

  /** Call this when quality level changes */
  const updateQuality = useCallback((quality: string) => {
    qualityRef.current = quality;
  }, []);

  return { viewerCount, updateTime, updateQuality };
}
