import { useState, useEffect, useRef, useCallback } from "react";
import { Send, LogIn } from "lucide-react";
import { WS_URL } from "@/lib/constants";
import type { ChatMessage } from "@/types/api";

interface LiveChatProps {
  streamId: string;
  className?: string;
}

export default function LiveChat({ streamId, className = "" }: LiveChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const token = localStorage.getItem("access_token");
  const isLoggedIn = !!token;

  const connect = useCallback(() => {
    const params = token ? `?token=${token}` : "";
    const ws = new WebSocket(`${WS_URL}/chat/${streamId}${params}`);

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg: ChatMessage = JSON.parse(event.data);
        if (msg.type === "pong") return;
        if (msg.type === "viewer_count") {
          // Handled by parent via onViewerCount if needed,
          // but also display as internal state
          setMessages((prev) => {
            // Replace the last viewer_count message instead of stacking
            const filtered = prev.filter((m) => m.type !== "viewer_count");
            return [...filtered, msg];
          });
          return;
        }
        setMessages((prev) => [...prev.slice(-200), msg]); // Keep last 200
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 3s
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [streamId, token]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Ping to keep alive
  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "message", content: trimmed }));
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const visibleMessages = messages.filter((m) => m.type !== "viewer_count");

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-[var(--border)] px-4">
        <h3 className="text-sm font-medium">Live Chat</h3>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
          />
          <span className="text-xs text-gray-500">
            {connected ? "Connected" : "Reconnecting..."}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {visibleMessages.length === 0 && (
          <p className="py-8 text-center text-xs text-gray-500">
            No messages yet. Say hello!
          </p>
        )}
        {visibleMessages.map((msg, i) => (
          <div key={i} className="mb-1.5">
            {msg.type === "system" ? (
              <p className="text-xs italic text-gray-500">{msg.content}</p>
            ) : msg.type === "error" ? (
              <p className="text-xs text-red-400">{msg.content}</p>
            ) : (
              <p className="text-sm">
                <span className="font-medium text-blue-400">{msg.username}</span>
                <span className="ml-1.5 text-gray-300">{msg.content}</span>
              </p>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--border)] p-3">
        {isLoggedIn ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Send a message..."
              maxLength={500}
              className="flex-1 rounded bg-[var(--card)] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-500 focus:ring-1 focus:ring-[var(--primary)]"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="rounded bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </div>
        ) : (
          <a
            href="/login"
            className="flex items-center justify-center gap-2 rounded bg-[var(--card)] px-3 py-2.5 text-sm text-gray-400 transition-colors hover:text-white"
          >
            <LogIn size={14} />
            Log in to chat
          </a>
        )}
      </div>
    </div>
  );
}
