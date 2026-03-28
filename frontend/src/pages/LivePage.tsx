import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, Users, AlertTriangle, ArrowLeft, CreditCard, Ticket } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import type { LiveStream } from "@/types/api";
import LivePlayer from "@/components/live/LivePlayer";
import LiveChat from "@/components/live/LiveChat";

export default function LivePage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated } = useAuthStore();
  const [stream, setStream] = useState<LiveStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseLoading, setPurchaseLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .get<LiveStream>(`/live/streams/${id}`)
      .then((data) => {
        setStream(data);
        if (data.status !== "live") {
          setError("This stream is not currently live.");
        }
      })
      .catch(() => setError("Stream not found"))
      .finally(() => setLoading(false));
  }, [id]);

  // Poll viewer count
  useEffect(() => {
    if (!id || !stream || stream.status !== "live") return;
    const interval = setInterval(() => {
      api
        .get<LiveStream>(`/live/streams/${id}`)
        .then((data) => {
          setStream((prev) => (prev ? { ...prev, viewer_count: data.viewer_count } : prev));
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [id, stream?.status]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center pt-16">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !stream) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 pt-16 text-gray-400">
        <AlertTriangle size={48} className="opacity-50" />
        <p>{error || "Stream not found"}</p>
        <Link to="/" className="text-sm text-[var(--primary)] hover:underline">
          <ArrowLeft size={14} className="mr-1 inline" />
          Back to home
        </Link>
      </div>
    );
  }

  const hasAccess = !stream.access || stream.access.has_access;
  const isPpvLocked = stream.is_ppv && !hasAccess;

  const handlePurchase = async () => {
    if (!id || !isAuthenticated) return;
    setPurchaseLoading(true);
    try {
      const result = await api.post<{ checkout_url: string }>("/subscriptions/ppv-checkout", {
        live_stream_id: id,
        success_url: window.location.href,
        cancel_url: window.location.href,
      });
      if (result.checkout_url) {
        window.location.href = result.checkout_url;
      }
    } catch {
      /* ignore */
    } finally {
      setPurchaseLoading(false);
    }
  };

  return (
    <div className="pt-16">
      <div className="flex flex-col lg:flex-row">
        {/* Player + Info */}
        <div className="flex-1">
          {isPpvLocked ? (
            <div className="relative flex aspect-video items-center justify-center bg-black">
              <div className="relative z-10 flex max-w-md flex-col items-center gap-4 rounded-xl bg-black/80 p-8 text-center backdrop-blur-md">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-500/20">
                  <Ticket size={28} className="text-purple-400" />
                </div>
                <h2 className="text-xl font-bold">Pay-Per-View Event</h2>
                <p className="text-sm text-gray-400">
                  {stream.access?.reason === "login_required"
                    ? "Sign in to purchase access to this live event."
                    : "Purchase access to watch this live event."}
                </p>
                {stream.ppv_price && (
                  <p className="text-2xl font-bold text-purple-400">
                    {stream.ppv_currency} {parseFloat(stream.ppv_price).toFixed(2)}
                  </p>
                )}
                {!isAuthenticated ? (
                  <Link
                    to="/login"
                    className="mt-2 rounded-lg bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
                  >
                    Sign In
                  </Link>
                ) : (
                  <button
                    onClick={handlePurchase}
                    disabled={purchaseLoading}
                    className="mt-2 flex items-center gap-2 rounded-lg bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                  >
                    {purchaseLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <CreditCard size={16} />
                    )}
                    Purchase Access
                  </button>
                )}
              </div>
            </div>
          ) : stream.status === "live" && stream.manifest_url ? (
            <LivePlayer manifestUrl={stream.manifest_url} />
          ) : (
            <div className="flex aspect-video items-center justify-center bg-black text-gray-500">
              Stream is offline
            </div>
          )}

          <div className="px-4 py-4 lg:px-6">
            <div className="flex items-center gap-3">
              {stream.status === "live" && (
                <span className="flex items-center gap-1.5 rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  Live
                </span>
              )}
              {stream.is_ppv && (
                <span className="rounded bg-purple-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
                  PPV
                </span>
              )}
              <div className="flex items-center gap-1 text-sm text-gray-400">
                <Users size={14} />
                <span>{stream.viewer_count} watching</span>
              </div>
            </div>
            <h1 className="mt-2 text-xl font-bold lg:text-2xl">{stream.title}</h1>
            {stream.description && (
              <p className="mt-2 text-sm text-gray-400">{stream.description}</p>
            )}
          </div>
        </div>

        {/* Chat Sidebar */}
        <aside className="h-[calc(100vh-4rem)] w-full border-l border-[var(--border)] bg-[var(--secondary)] lg:w-80">
          <LiveChat streamId={id!} className="h-full" />
        </aside>
      </div>
    </div>
  );
}
