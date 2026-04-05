import { useState, useEffect, useCallback } from "react";
import {
  Search, Trash2, Edit3, Plus, X, Loader2,
  Crown, Users, CalendarRange, Globe, Gift, Ban,
} from "lucide-react";
import { api } from "@/api/client";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

// ── Types ────────────────────────────────────────────────────────────────────

interface TierPrice {
  id?: string;
  currency: string;
  regions: string[];          // empty = global default
  price_monthly: string;
  price_yearly: string;
  gateway_price_id_monthly: string;
  gateway_price_id_yearly: string;
  is_default: boolean;
  sort_order: number;
}

interface SubscriptionTier {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  tier_level: number;
  description: string;
  features: Record<string, boolean>;
  prices: TierPrice[];
  is_active: boolean;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
}

interface UserSubscription {
  id: string;
  user_id: string;
  tenant_id: string;
  tier_id: string | null;
  tier_name: string | null;
  status: string;
  is_lifetime: boolean;
  billing_period: string;
  payment_provider: string | null;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  user_email: string | null;
  user_username: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface SeasonPassConfig {
  id: string;
  tenant_id: string;
  category_id: string;
  category_name: string;
  season_label: string;
  price: string;
  currency: string;
  gateway_price_id: string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  created_at: string | null;
}

interface Category {
  id: string;
  name: string;
  slug: string;
}

type Tab = "tiers" | "users" | "season-passes";

// ── Main Component ──────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const [tab, setTab] = useState<Tab>("tiers");

  const tabs: { key: Tab; label: string; icon: typeof Crown }[] = [
    { key: "tiers", label: "Tiers", icon: Crown },
    { key: "users", label: "User Subscriptions", icon: Users },
    { key: "season-passes", label: "Season Passes", icon: CalendarRange },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Subscriptions</h1>

      {/* Tab Bar */}
      <div className="mb-6 flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-1">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "bg-[var(--primary)] text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {tab === "tiers" && <TiersTab />}
      {tab === "users" && <UserSubscriptionsTab />}
      {tab === "season-passes" && <SeasonPassesTab />}
    </div>
  );
}

// ── Tiers Tab ───────────────────────────────────────────────────────────────

function TiersTab() {
  const [tiers, setTiers] = useState<SubscriptionTier[]>([]);
  const [tenants, setTenants] = useState<{ id: string; site_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SubscriptionTier | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formTenantId, setFormTenantId] = useState("");
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formTierLevel, setFormTierLevel] = useState(0);
  const [formDescription, setFormDescription] = useState("");
  const [formFeatures, setFormFeatures] = useState<Record<string, boolean>>({});
  const [formIsActive, setFormIsActive] = useState(true);
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [formPrices, setFormPrices] = useState<TierPrice[]>([]);

  const emptyPrice = (): TierPrice => ({
    currency: "USD",
    regions: [],
    price_monthly: "0",
    price_yearly: "0",
    gateway_price_id_monthly: "",
    gateway_price_id_yearly: "",
    is_default: false,
    sort_order: 0,
  });

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<SubscriptionTier | null>(null);

  const fetchTiers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: SubscriptionTier[] }>("/admin/subscriptions/tiers");
      setTiers(data.items);
    } catch {
      setTiers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTiers();
    api.get<{ items: { id: string; site_name: string }[] }>("/admin/tenants").then((d) => setTenants(d.items)).catch(() => {});
  }, [fetchTiers]);

  const slugify = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const fmtPrice = (amount: string | number, currency: string) => {
    const n = Number(amount);
    try {
      return new Intl.NumberFormat("en", {
        style: "currency",
        currency: currency || "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${currency} ${n.toFixed(2)}`;
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormTenantId(tenants[0]?.id || "");
    setFormName("");
    setFormSlug("");
    setFormTierLevel(tiers.length);
    setFormDescription("");
    setFormFeatures({});
    setFormIsActive(true);
    setFormSortOrder(tiers.length);
    setFormPrices([{ ...emptyPrice(), is_default: true }]);
    setShowModal(true);
  };

  const openEdit = (tier: SubscriptionTier) => {
    setEditing(tier);
    setFormTenantId(tier.tenant_id);
    setFormName(tier.name);
    setFormSlug(tier.slug);
    setFormTierLevel(tier.tier_level);
    setFormDescription(tier.description);
    setFormFeatures(tier.features || {});
    setFormIsActive(tier.is_active);
    setFormSortOrder(tier.sort_order);
    setFormPrices(
      (tier.prices || []).map((p) => ({
        ...p,
        price_monthly: String(p.price_monthly),
        price_yearly: String(p.price_yearly),
        gateway_price_id_monthly: p.gateway_price_id_monthly || "",
        gateway_price_id_yearly: p.gateway_price_id_yearly || "",
        regions: p.regions || [],
      }))
    );
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const payload = {
      tenant_id: formTenantId,
      name: formName,
      slug: formSlug || slugify(formName),
      tier_level: formTierLevel,
      description: formDescription,
      features: formFeatures,
      is_active: formIsActive,
      sort_order: formSortOrder,
      prices: formPrices.map((p, i) => ({
        ...p,
        price_monthly: parseFloat(p.price_monthly) || 0,
        price_yearly: parseFloat(p.price_yearly) || 0,
        gateway_price_id_monthly: p.gateway_price_id_monthly || null,
        gateway_price_id_yearly: p.gateway_price_id_yearly || null,
        sort_order: i,
      })),
    };

    try {
      if (editing) {
        await api.patch(`/admin/subscriptions/tiers/${editing.id}`, payload);
      } else {
        await api.post("/admin/subscriptions/tiers", payload);
      }
      setShowModal(false);
      fetchTiers();
    } catch {
      // keep modal open
    } finally {
      setSaving(false);
    }
  };

  const updatePrice = (idx: number, patch: Partial<TierPrice>) => {
    setFormPrices((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const setDefaultPrice = (idx: number) => {
    setFormPrices((prev) => prev.map((p, i) => ({ ...p, is_default: i === idx })));
  };

  const removePrice = (idx: number) => {
    setFormPrices((prev) => {
      const removed = prev[idx];
      const next = prev.filter((_, i) => i !== idx);
      // if we removed the default and there's still a row, make the first one default
      if (removed?.is_default && next.length > 0) {
        next[0] = { ...next[0]!, is_default: true };
      }
      return next;
    });
  };

  const requestDelete = (tier: SubscriptionTier) => {
    setConfirmTarget(tier);
    setConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!confirmTarget) return;
    try {
      await api.delete(`/admin/subscriptions/tiers/${confirmTarget.id}`);
      fetchTiers();
    } catch {
      // silent
    } finally {
      setConfirmOpen(false);
      setConfirmTarget(null);
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Define subscription tiers for your platform. Higher tier levels grant access to more content.
        </p>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} /> Add Tier
        </button>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : tiers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Crown size={40} className="mb-3 opacity-50" />
            <p>No subscription tiers yet. Create your first tier to get started.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Pricing</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Features</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {tiers.map((tier) => (
                <tr key={tier.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-medium text-white">{tier.name}</span>
                      <span className="ml-2 text-xs text-gray-500">{tier.slug}</span>
                    </div>
                    {tier.description && (
                      <p className="mt-0.5 text-xs text-gray-500 truncate max-w-[200px]">{tier.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const tenant = tenants.find((t) => t.id === tier.tenant_id);
                      return tenant ? (
                        <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-300">
                          {tenant.site_name}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">
                      {tier.tier_level}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {(tier.prices || []).length === 0 ? (
                      <span className="text-xs text-gray-600">—</span>
                    ) : (
                      <div className="space-y-1">
                        {tier.prices.map((p, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                            {Number(p.price_monthly) === 0 ? (
                              <span className="text-green-400">Free</span>
                            ) : (
                              <span className="text-gray-300">
                                {fmtPrice(p.price_monthly, p.currency)}/mo
                              </span>
                            )}
                            {p.regions && p.regions.length > 0 && (
                              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-400">
                                {p.regions.join(", ")}
                              </span>
                            )}
                            {p.is_default && (
                              <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-400">default</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        tier.is_active
                          ? "bg-green-500/20 text-green-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {tier.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-[200px]">
                    <div className="truncate">
                      {Object.entries(tier.features || {})
                        .filter(([, v]) => v)
                        .map(([k]) => k)
                        .join(", ") || "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(tier)}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                        title="Edit"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => requestDelete(tier)}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editing ? "Edit Tier" : "Create Tier"}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Tenant *</label>
                <select
                  value={formTenantId}
                  onChange={(e) => setFormTenantId(e.target.value)}
                  required
                  disabled={!!editing}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)] disabled:opacity-60"
                >
                  <option value="">Select a tenant...</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>{t.site_name}</option>
                  ))}
                </select>
                {editing && (
                  <p className="mt-1 text-[11px] text-gray-500">Tenant cannot be changed after creation.</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Name *</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      if (!editing) setFormSlug(slugify(e.target.value));
                    }}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Slug</label>
                  <input
                    type="text"
                    value={formSlug}
                    onChange={(e) => setFormSlug(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Tier Level</label>
                  <input
                    type="number"
                    value={formTierLevel}
                    onChange={(e) => setFormTierLevel(Number(e.target.value))}
                    min={0}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Sort Order</label>
                  <input
                    type="number"
                    value={formSortOrder}
                    onChange={(e) => setFormSortOrder(Number(e.target.value))}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Description</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs text-gray-400">Features</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "hd_streaming", label: "HD Streaming" },
                    { key: "4k_streaming", label: "4K Streaming" },
                    { key: "downloads", label: "Downloads" },
                    { key: "no_ads", label: "No Ads" },
                    { key: "multiple_screens", label: "Multiple Screens" },
                    { key: "offline_viewing", label: "Offline Viewing" },
                    { key: "early_access", label: "Early Access" },
                    { key: "live_streams", label: "Live Streams" },
                    { key: "exclusive_content", label: "Exclusive Content" },
                    { key: "priority_support", label: "Priority Support" },
                  ].map(({ key, label }) => (
                    <label
                      key={key}
                      className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm transition-colors ${
                        formFeatures[key]
                          ? "border-[var(--primary)] bg-[var(--primary)]/10 text-white"
                          : "border-[var(--border)] bg-[var(--secondary)] text-gray-400 hover:border-gray-500"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!!formFeatures[key]}
                        onChange={(e) =>
                          setFormFeatures((prev) => ({ ...prev, [key]: e.target.checked }))
                        }
                        className="sr-only"
                      />
                      <div
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          formFeatures[key]
                            ? "border-[var(--primary)] bg-[var(--primary)]"
                            : "border-gray-600"
                        }`}
                      >
                        {formFeatures[key] && (
                          <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Pricing */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                    <Globe size={13} />
                    Pricing
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setFormPrices((prev) => [
                        ...prev,
                        { ...emptyPrice(), sort_order: prev.length },
                      ])
                    }
                    className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] text-gray-300 hover:bg-white/20"
                  >
                    <Plus size={11} /> Add Price
                  </button>
                </div>

                {formPrices.length === 0 ? (
                  <p className="rounded border border-dashed border-[var(--border)] py-3 text-center text-[11px] text-gray-600">
                    No prices yet. Add at least one price row.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {formPrices.map((p, idx) => (
                      <div
                        key={idx}
                        className={`rounded border bg-[var(--secondary)] p-3 ${
                          p.is_default ? "border-[var(--primary)]/50" : "border-[var(--border)]"
                        }`}
                      >
                        {/* Row header */}
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setDefaultPrice(idx)}
                              title="Set as default"
                              className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                p.is_default
                                  ? "bg-[var(--primary)] text-white"
                                  : "bg-white/10 text-gray-400 hover:bg-white/20"
                              }`}
                            >
                              {p.is_default ? "Default" : "Set default"}
                            </button>
                            {p.regions.length === 0 ? (
                              <span className="text-[10px] text-gray-500">Global fallback</span>
                            ) : (
                              <span className="text-[10px] text-blue-400">{p.regions.join(", ")}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removePrice(idx)}
                            className="rounded p-1 text-gray-500 hover:text-red-400"
                          >
                            <X size={13} />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="mb-0.5 block text-[10px] text-gray-500">Currency</label>
                            <input
                              type="text"
                              value={p.currency}
                              maxLength={3}
                              placeholder="USD"
                              onChange={(e) => updatePrice(idx, { currency: e.target.value.toUpperCase() })}
                              className="w-full rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--primary)]"
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[10px] text-gray-500">Monthly</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={p.price_monthly}
                              onChange={(e) => updatePrice(idx, { price_monthly: e.target.value })}
                              className="w-full rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--primary)]"
                            />
                          </div>
                          <div>
                            <label className="mb-0.5 block text-[10px] text-gray-500">Yearly</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={p.price_yearly}
                              onChange={(e) => updatePrice(idx, { price_yearly: e.target.value })}
                              className="w-full rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--primary)]"
                            />
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-0.5 block text-[10px] text-gray-500">Regions (ISO codes, comma-separated)</label>
                            <input
                              type="text"
                              value={p.regions.join(", ")}
                              placeholder="IN, GB, AU — leave blank for global"
                              onChange={(e) =>
                                updatePrice(idx, {
                                  regions: e.target.value
                                    .split(",")
                                    .map((s) => s.trim().toUpperCase())
                                    .filter(Boolean),
                                })
                              }
                              className="w-full rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--primary)]"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="mb-0.5 block text-[10px] text-gray-500">Gateway ID (Monthly)</label>
                              <input
                                type="text"
                                value={p.gateway_price_id_monthly}
                                placeholder="price_..."
                                onChange={(e) => updatePrice(idx, { gateway_price_id_monthly: e.target.value })}
                                className="w-full rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--primary)]"
                              />
                            </div>
                            <div>
                              <label className="mb-0.5 block text-[10px] text-gray-500">Gateway ID (Yearly)</label>
                              <input
                                type="text"
                                value={p.gateway_price_id_yearly}
                                placeholder="price_..."
                                onChange={(e) => updatePrice(idx, { gateway_price_id_yearly: e.target.value })}
                                className="w-full rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs text-white outline-none focus:border-[var(--primary)]"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="rounded border-[var(--border)]"
                />
                <label htmlFor="isActive" className="text-sm text-gray-300">Active</label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : editing ? <Edit3 size={14} /> : <Plus size={14} />}
                  {saving ? "Saving..." : editing ? "Save" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete Tier"
        message={`Delete tier "${confirmTarget?.name}"? Users on this tier will lose access.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => { setConfirmOpen(false); setConfirmTarget(null); }}
      />
    </>
  );
}

// ── User Subscriptions Tab ──────────────────────────────────────────────────

function UserSubscriptionsTab() {
  const [subs, setSubs] = useState<UserSubscription[]>([]);
  const [tiers, setTiers] = useState<SubscriptionTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Grant form
  const [grantEmail, setGrantEmail] = useState("");
  const [grantTierId, setGrantTierId] = useState("");
  const [grantIsLifetime, setGrantIsLifetime] = useState(false);
  const [grantBillingPeriod, setGrantBillingPeriod] = useState("monthly");

  // Search for user
  const [userSearchResults, setUserSearchResults] = useState<{ id: string; email: string; username: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [, setSearchingUsers] = useState(false);

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});

  const fetchSubs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      const data = await api.get<{ items: UserSubscription[]; total: number }>(
        "/admin/subscriptions/users",
        params
      );
      setSubs(data.items);
    } catch {
      setSubs([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  const fetchTiers = useCallback(async () => {
    try {
      const data = await api.get<{ items: SubscriptionTier[] }>("/admin/subscriptions/tiers");
      setTiers(data.items);
    } catch {
      setTiers([]);
    }
  }, []);

  useEffect(() => {
    fetchSubs();
    fetchTiers();
  }, [fetchSubs, fetchTiers]);

  const searchUsers = async (query: string) => {
    setGrantEmail(query);
    if (query.length < 2) {
      setUserSearchResults([]);
      return;
    }
    setSearchingUsers(true);
    try {
      const data = await api.get<{ items: { id: string; email: string; username: string }[] }>(
        "/admin/users",
        { search: query, page_size: "5" }
      );
      setUserSearchResults(data.items);
    } catch {
      setUserSearchResults([]);
    } finally {
      setSearchingUsers(false);
    }
  };

  const openGrant = () => {
    setGrantEmail("");
    setGrantTierId(tiers[0]?.id || "");
    setGrantIsLifetime(false);
    setGrantBillingPeriod("monthly");
    setSelectedUserId("");
    setUserSearchResults([]);
    setShowGrantModal(true);
  };

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !grantTierId) return;
    setSaving(true);
    try {
      await api.post("/admin/subscriptions/grant", {
        user_id: selectedUserId,
        tier_id: grantTierId,
        is_lifetime: grantIsLifetime,
        billing_period: grantBillingPeriod,
      });
      setShowGrantModal(false);
      fetchSubs();
    } catch {
      // keep modal open
    } finally {
      setSaving(false);
    }
  };

  const revokeSubscription = (sub: UserSubscription) => {
    setConfirmTitle("Revoke Subscription");
    setConfirmMessage(`Revoke subscription for ${sub.user_email || sub.user_username}? They will lose access.`);
    setConfirmAction(() => async () => {
      try {
        await api.post("/admin/subscriptions/revoke", { user_id: sub.user_id });
        fetchSubs();
      } catch {
        // silent
      }
      setConfirmOpen(false);
    });
    setConfirmOpen(true);
  };

  const deleteSubscription = (sub: UserSubscription) => {
    setConfirmTitle("Delete Subscription Record");
    setConfirmMessage(`Permanently delete subscription record for ${sub.user_email || sub.user_username}?`);
    setConfirmAction(() => async () => {
      try {
        await api.delete(`/admin/subscriptions/users/${sub.id}`);
        fetchSubs();
      } catch {
        // silent
      }
      setConfirmOpen(false);
    });
    setConfirmOpen(true);
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: "bg-green-500/20 text-green-400",
      cancelled: "bg-red-500/20 text-red-400",
      expired: "bg-yellow-500/20 text-yellow-400",
      past_due: "bg-orange-500/20 text-orange-400",
    };
    return (
      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || "bg-gray-500/20 text-gray-400"}`}>
        {status}
      </span>
    );
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by email or username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-[var(--primary)]"
          />
        </div>
        <button
          onClick={openGrant}
          className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Gift size={16} /> Grant Subscription
        </button>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : subs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Users size={40} className="mb-3 opacity-50" />
            <p>No subscriptions found.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {subs.map((sub) => (
                <tr key={sub.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-medium text-white">{sub.user_username}</span>
                      <p className="text-xs text-gray-500">{sub.user_email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-300">{sub.tier_name || "—"}</td>
                  <td className="px-4 py-3">{statusBadge(sub.status)}</td>
                  <td className="px-4 py-3">
                    {sub.is_lifetime ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">
                        <Crown size={12} /> Lifetime
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 capitalize">{sub.billing_period}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {sub.current_period_end
                      ? `Ends ${new Date(sub.current_period_end).toLocaleDateString()}`
                      : sub.is_lifetime
                      ? "Forever"
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {sub.status === "active" && (
                        <button
                          onClick={() => revokeSubscription(sub)}
                          className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-yellow-400"
                          title="Revoke"
                        >
                          <Ban size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => deleteSubscription(sub)}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Grant Modal */}
      {showGrantModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Grant Subscription</h2>
              <button onClick={() => setShowGrantModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleGrant} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Search User *</label>
                <input
                  type="text"
                  value={grantEmail}
                  onChange={(e) => searchUsers(e.target.value)}
                  placeholder="Type email or username..."
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
                {userSearchResults.length > 0 && !selectedUserId && (
                  <div className="mt-1 rounded border border-[var(--border)] bg-[var(--secondary)]">
                    {userSearchResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => {
                          setSelectedUserId(u.id);
                          setGrantEmail(u.email);
                          setUserSearchResults([]);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-white/10"
                      >
                        {u.username} — {u.email}
                      </button>
                    ))}
                  </div>
                )}
                {selectedUserId && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-green-400">User selected</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUserId("");
                        setGrantEmail("");
                      }}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      (change)
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Tier *</label>
                <select
                  value={grantTierId}
                  onChange={(e) => setGrantTierId(e.target.value)}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  required
                >
                  <option value="">Select tier...</option>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (Level {t.tier_level})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Billing Period</label>
                  <select
                    value={grantBillingPeriod}
                    onChange={(e) => setGrantBillingPeriod(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={grantIsLifetime}
                      onChange={(e) => setGrantIsLifetime(e.target.checked)}
                      className="rounded border-[var(--border)]"
                    />
                    Lifetime grant
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowGrantModal(false)}
                  className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !selectedUserId || !grantTierId}
                  className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />}
                  {saving ? "Granting..." : "Grant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel="Confirm"
        onConfirm={confirmAction}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

// ── Season Passes Tab ───────────────────────────────────────────────────────

function SeasonPassesTab() {
  const [configs, setConfigs] = useState<SeasonPassConfig[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SeasonPassConfig | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formSeasonLabel, setFormSeasonLabel] = useState("");
  const [formPrice, setFormPrice] = useState("0");
  const [formCurrency, setFormCurrency] = useState("USD");
  const [formValidFrom, setFormValidFrom] = useState("");
  const [formValidUntil, setFormValidUntil] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [formGatewayPrice, setFormGatewayPrice] = useState("");

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<SeasonPassConfig | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: SeasonPassConfig[] }>("/admin/subscriptions/season-passes");
      setConfigs(data.items);
    } catch {
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await api.get<Category[]>("/admin/categories");
      setCategories(data);
    } catch {
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
    fetchCategories();
  }, [fetchConfigs, fetchCategories]);

  const openCreate = () => {
    setEditing(null);
    setFormCategoryId(categories[0]?.id || "");
    setFormSeasonLabel("");
    setFormPrice("0");
    setFormCurrency("USD");
    setFormValidFrom("");
    setFormValidUntil("");
    setFormIsActive(true);
    setFormGatewayPrice("");
    setShowModal(true);
  };

  const openEdit = (config: SeasonPassConfig) => {
    setEditing(config);
    setFormCategoryId(config.category_id);
    setFormSeasonLabel(config.season_label);
    setFormPrice(config.price);
    setFormCurrency(config.currency);
    setFormValidFrom(config.valid_from?.slice(0, 16) || "");
    setFormValidUntil(config.valid_until?.slice(0, 16) || "");
    setFormIsActive(config.is_active);
    setFormGatewayPrice(config.gateway_price_id || "");
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      category_id: formCategoryId,
      season_label: formSeasonLabel,
      price: formPrice,
      currency: formCurrency,
      valid_from: formValidFrom ? new Date(formValidFrom).toISOString() : undefined,
      valid_until: formValidUntil ? new Date(formValidUntil).toISOString() : undefined,
      is_active: formIsActive,
      gateway_price_id: formGatewayPrice || null,
    };
    try {
      if (editing) {
        await api.patch(`/admin/subscriptions/season-passes/${editing.id}`, payload);
      } else {
        await api.post("/admin/subscriptions/season-passes", payload);
      }
      setShowModal(false);
      fetchConfigs();
    } catch {
      // keep modal open
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (config: SeasonPassConfig) => {
    setConfirmTarget(config);
    setConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!confirmTarget) return;
    try {
      await api.delete(`/admin/subscriptions/season-passes/${confirmTarget.id}`);
      fetchConfigs();
    } catch {
      // silent
    } finally {
      setConfirmOpen(false);
      setConfirmTarget(null);
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Season passes give users access to all live streams in a category for a time period.
        </p>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} /> Add Season Pass
        </button>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : configs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <CalendarRange size={40} className="mb-3 opacity-50" />
            <p>No season passes configured.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">Season Label</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Valid Period</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {configs.map((c) => (
                <tr key={c.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 font-medium text-white">{c.season_label}</td>
                  <td className="px-4 py-3 text-gray-300">{c.category_name}</td>
                  <td className="px-4 py-3 text-gray-300">{c.currency} {c.price}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {c.valid_from ? new Date(c.valid_from).toLocaleDateString() : "?"} —{" "}
                    {c.valid_until ? new Date(c.valid_until).toLocaleDateString() : "?"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.is_active
                          ? "bg-green-500/20 text-green-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(c)}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                        title="Edit"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => requestDelete(c)}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editing ? "Edit Season Pass" : "Create Season Pass"}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Category *</label>
                <select
                  value={formCategoryId}
                  onChange={(e) => setFormCategoryId(e.target.value)}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  required
                  disabled={!!editing}
                >
                  <option value="">Select category...</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Season Label *</label>
                <input
                  type="text"
                  value={formSeasonLabel}
                  onChange={(e) => setFormSeasonLabel(e.target.value)}
                  placeholder='e.g. "2026 Season", "IPL 2026"'
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Price *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Currency</label>
                  <input
                    type="text"
                    value={formCurrency}
                    onChange={(e) => setFormCurrency(e.target.value.toUpperCase())}
                    maxLength={3}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Valid From *</label>
                  <input
                    type="datetime-local"
                    value={formValidFrom}
                    onChange={(e) => setFormValidFrom(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Valid Until *</label>
                  <input
                    type="datetime-local"
                    value={formValidUntil}
                    onChange={(e) => setFormValidUntil(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Gateway Price ID</label>
                <input
                  type="text"
                  value={formGatewayPrice}
                  onChange={(e) => setFormGatewayPrice(e.target.value)}
                  placeholder="price_..."
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="spIsActive"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="rounded border-[var(--border)]"
                />
                <label htmlFor="spIsActive" className="text-sm text-gray-300">Active</label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : editing ? <Edit3 size={14} /> : <Plus size={14} />}
                  {saving ? "Saving..." : editing ? "Save" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete Season Pass"
        message={`Delete season pass "${confirmTarget?.season_label}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => { setConfirmOpen(false); setConfirmTarget(null); }}
      />
    </>
  );
}
