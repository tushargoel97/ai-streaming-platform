import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Loader2 } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";

interface Tier {
  id: string;
  name: string;
  slug: string;
  tier_level: number;
  price_monthly: string;
  price_yearly: string;
  currency: string;
  description: string;
  features: Record<string, boolean | string>;
  sort_order: number;
}

interface UserSub {
  has_subscription: boolean;
  tier?: { id: string; name: string; tier_level: number };
}

export default function PricingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentSub, setCurrentSub] = useState<UserSub | null>(null);
  const [annual, setAnnual] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get<{ items: Tier[] }>("/subscriptions/tiers");
        setTiers(data.items.sort((a, b) => a.sort_order - b.sort_order));
      } catch {
        /* no tiers */
      }

      if (isAuthenticated) {
        try {
          const sub = await api.get<UserSub>("/subscriptions/me");
          setCurrentSub(sub);
        } catch {
          /* ignore */
        }
      }
      setLoading(false);
    };
    load();
  }, [isAuthenticated]);

  if (loading) {
    return (
      <div className="flex items-center justify-center pt-32">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (tiers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center pt-32 text-gray-400">
        <p className="text-lg">No subscription plans available for this site.</p>
      </div>
    );
  }

  const currentTierLevel = currentSub?.tier?.tier_level ?? -1;

  const featureLabels: Record<string, string> = {
    ads: "Ad-free viewing",
    max_quality: "Max quality",
    downloads: "Offline downloads",
    live_events: "Live events",
    replays: "Full replays",
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Choose Your Plan</h1>
        <p className="mt-3 text-gray-400">
          Pick the plan that works for you. Upgrade or downgrade anytime.
        </p>

        {/* Annual toggle */}
        <div className="mt-8 inline-flex items-center gap-3 rounded-full bg-white/5 p-1">
          <button
            onClick={() => setAnnual(false)}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${!annual ? "bg-white text-black" : "text-gray-400 hover:text-white"}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${annual ? "bg-white text-black" : "text-gray-400 hover:text-white"}`}
          >
            Yearly
            <span className="ml-1.5 text-xs text-green-400">Save 15%+</span>
          </button>
        </div>
      </div>

      {/* Tier cards */}
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {tiers.map((tier) => {
          const price = annual ? tier.price_yearly : tier.price_monthly;
          const priceNum = parseFloat(price);
          const isCurrent = currentTierLevel === tier.tier_level;
          const isPopular = tier.tier_level === 1;

          return (
            <div
              key={tier.id}
              className={`relative flex flex-col rounded-2xl border p-8 transition-colors ${
                isPopular
                  ? "border-[var(--primary)] bg-white/[0.03]"
                  : "border-white/10 bg-white/[0.02]"
              }`}
            >
              {isPopular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--primary)] px-4 py-1 text-xs font-semibold text-white">
                  Most Popular
                </span>
              )}

              <h3 className="text-xl font-bold">{tier.name}</h3>
              <p className="mt-2 text-sm text-gray-400">{tier.description}</p>

              <div className="mt-6">
                {priceNum === 0 ? (
                  <span className="text-4xl font-bold">Free</span>
                ) : (
                  <>
                    <span className="text-4xl font-bold">
                      ${annual ? (priceNum / 12).toFixed(2) : priceNum.toFixed(2)}
                    </span>
                    <span className="text-gray-400">/mo</span>
                    {annual && priceNum > 0 && (
                      <p className="mt-1 text-sm text-gray-500">
                        ${priceNum.toFixed(2)} billed yearly
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Features */}
              <ul className="mt-6 flex-1 space-y-3">
                {Object.entries(tier.features).map(([key, val]) => {
                  const label = featureLabels[key] || key;
                  const enabled = val === true || (typeof val === "string" && val !== "false");
                  return (
                    <li
                      key={key}
                      className={`flex items-center gap-2 text-sm ${enabled ? "text-gray-200" : "text-gray-600 line-through"}`}
                    >
                      <Check size={16} className={enabled ? "text-green-400" : "text-gray-700"} />
                      {typeof val === "string" && val !== "true" && val !== "false"
                        ? `${label}: ${val}`
                        : label}
                    </li>
                  );
                })}
              </ul>

              {/* Action */}
              <div className="mt-8">
                {isCurrent ? (
                  <button
                    disabled
                    className="w-full rounded-lg bg-white/10 py-3 text-sm font-semibold text-gray-400"
                  >
                    Current Plan
                  </button>
                ) : priceNum === 0 ? (
                  <button
                    disabled
                    className="w-full rounded-lg border border-white/10 py-3 text-sm font-semibold text-gray-400"
                  >
                    Free
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      if (!isAuthenticated) {
                        navigate("/login");
                      }
                      // TODO: integrate with checkout endpoint
                    }}
                    className="w-full rounded-lg bg-[var(--primary)] py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    {currentTierLevel >= 0 && tier.tier_level > currentTierLevel
                      ? "Upgrade"
                      : "Subscribe"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
