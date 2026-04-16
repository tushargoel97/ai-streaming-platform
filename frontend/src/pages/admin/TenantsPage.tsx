import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, Plus, X, Loader2, Edit3, Globe, ToggleLeft, ToggleRight, Trash2,
  Power, Wrench, Ticket, Image, FileText, ExternalLink, CheckCircle2,
  AlertCircle, Copy, RefreshCw, Shield,
} from "lucide-react";
import { api } from "@/api/client";
import type { AdminTenant, PaginatedResponse } from "@/types/api";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

const CONTENT_LEVELS = ["safe", "mature", "explicit"] as const;
const AGE_VERIFICATIONS = ["none", "click_through", "date_of_birth"] as const;
const DEFAULT_FEATURES: Record<string, boolean> = {
  live_streaming: true,
  live_chat: true,
  recommendations: true,
  search: true,
  watch_history: true,
};

export default function TenantsPage() {
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AdminTenant | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(null);
  const [confirmVariant, setConfirmVariant] = useState<"danger" | "default">("default");

  // Form fields
  const [formDomain, setFormDomain] = useState("");
  const [formSiteName, setFormSiteName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPrimaryColor, setFormPrimaryColor] = useState("#E50914");
  const [formSecondaryColor, setFormSecondaryColor] = useState("#141414");
  const [formBgColor, setFormBgColor] = useState("#000000");
  const [formMaxContent, setFormMaxContent] = useState("safe");
  const [formAgeVerification, setFormAgeVerification] = useState("none");
  const [formFeatures, setFormFeatures] = useState<Record<string, boolean>>({ ...DEFAULT_FEATURES });
  const [formSubscriptionsEnabled, setFormSubscriptionsEnabled] = useState(false);

  // Branding
  const [formLogoUrl, setFormLogoUrl] = useState("");
  const [formFaviconUrl, setFormFaviconUrl] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  // SEO / Metadata
  const [formMetaTitle, setFormMetaTitle] = useState("");
  const [formMetaDescription, setFormMetaDescription] = useState("");
  const [formMetaKeywords, setFormMetaKeywords] = useState("");
  const [formOgImageUrl, setFormOgImageUrl] = useState("");
  const [uploadingOgImage, setUploadingOgImage] = useState(false);
  const ogImageInputRef = useRef<HTMLInputElement>(null);

  // Custom domain
  const [formCustomDomain, setFormCustomDomain] = useState("");
  const [domainVerified, setDomainVerified] = useState(false);
  const [domainVerificationToken, setDomainVerificationToken] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ verified: boolean; message: string } | null>(null);

  // Form tab
  type FormTab = "general" | "branding" | "seo" | "domain" | "features";
  const [formTab, setFormTab] = useState<FormTab>("general");

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), page_size: String(pageSize) };
      if (search) params.search = search;
      const data = await api.get<PaginatedResponse<AdminTenant>>("/admin/tenants", params);
      setTenants(data.items);
      setTotal(data.total);
    } catch {
      setTenants([]);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const openCreate = () => {
    setEditing(null);
    setFormDomain("");
    setFormSiteName("");
    setFormSlug("");
    setFormDescription("");
    setFormPrimaryColor("#E50914");
    setFormSecondaryColor("#141414");
    setFormBgColor("#000000");
    setFormMaxContent("safe");
    setFormAgeVerification("none");
    setFormFeatures({ ...DEFAULT_FEATURES });
    setFormSubscriptionsEnabled(false);
    setFormLogoUrl("");
    setFormFaviconUrl("");
    setFormMetaTitle("");
    setFormMetaDescription("");
    setFormMetaKeywords("");
    setFormOgImageUrl("");
    setFormCustomDomain("");
    setDomainVerified(false);
    setDomainVerificationToken("");
    setVerifyResult(null);
    setFormTab("general");
    setError("");
    setShowModal(true);
  };

  const openEdit = (t: AdminTenant) => {
    setEditing(t);
    setFormDomain(t.domain);
    setFormSiteName(t.site_name);
    setFormSlug(t.slug);
    setFormDescription(t.description);
    setFormPrimaryColor(t.primary_color);
    setFormSecondaryColor(t.secondary_color);
    setFormBgColor(t.background_color);
    setFormMaxContent(t.max_content_level);
    setFormAgeVerification(t.age_verification);
    setFormFeatures({ ...DEFAULT_FEATURES, ...t.features });
    setFormSubscriptionsEnabled(t.subscriptions_enabled);
    setFormLogoUrl(t.logo_url);
    setFormFaviconUrl(t.favicon_url);
    setFormMetaTitle(t.meta_title);
    setFormMetaDescription(t.meta_description);
    setFormMetaKeywords(t.meta_keywords);
    setFormOgImageUrl(t.og_image_url);
    setFormCustomDomain(t.custom_domain);
    setDomainVerified(t.domain_verified);
    setDomainVerificationToken(t.domain_verification_token);
    setVerifyResult(null);
    setFormTab("general");
    setError("");
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = {
        domain: formDomain,
        site_name: formSiteName,
        ...(editing ? {} : { slug: formSlug || undefined }),
        description: formDescription,
        logo_url: formLogoUrl,
        favicon_url: formFaviconUrl,
        primary_color: formPrimaryColor,
        secondary_color: formSecondaryColor,
        background_color: formBgColor,
        meta_title: formMetaTitle,
        meta_description: formMetaDescription,
        meta_keywords: formMetaKeywords,
        og_image_url: formOgImageUrl,
        custom_domain: formCustomDomain,
        max_content_level: formMaxContent,
        age_verification: formAgeVerification,
        features: formFeatures,
        subscriptions_enabled: formSubscriptionsEnabled,
      };
      if (editing) {
        await api.patch(`/admin/tenants/${editing.id}`, body);
      } else {
        await api.post("/admin/tenants", body);
      }
      setShowModal(false);
      fetchTenants();
    } catch (err: unknown) {
      if (err && typeof err === "object" && "body" in err) {
        try {
          const parsed = JSON.parse((err as { body: string }).body);
          setError(parsed.detail || "Failed to save");
        } catch {
          setError("Failed to save");
        }
      } else {
        setError("Failed to save");
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleFeature = (key: string) => {
    setFormFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const uploadAsset = async (tenantId: string, assetType: "logo" | "favicon" | "og_image", file: File) => {
    const setUploading = assetType === "logo" ? setUploadingLogo : assetType === "favicon" ? setUploadingFavicon : setUploadingOgImage;
    const setUrl = assetType === "logo" ? setFormLogoUrl : assetType === "favicon" ? setFormFaviconUrl : setFormOgImageUrl;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await api.upload<{ url: string }>(`/admin/tenants/${tenantId}/upload/${assetType}`, formData);
      setUrl(result.url);
    } catch {
      setError(`Failed to upload ${assetType}`);
    } finally {
      setUploading(false);
    }
  };

  const handleVerifyDomain = async () => {
    if (!editing) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await api.post<{ verified: boolean; instruction: string; txt_records_found: string[] }>(
        `/admin/tenants/${editing.id}/verify-domain`,
      );
      if (result.verified) {
        setDomainVerified(true);
        setVerifyResult({ verified: true, message: "Domain verified successfully! Traffic will now route to this tenant." });
        fetchTenants();
      } else {
        setVerifyResult({
          verified: false,
          message: `TXT record not found. ${result.txt_records_found.length > 0 ? `Found: ${result.txt_records_found.join(", ")}` : "No TXT records found for _streamverify subdomain."}`,
        });
      }
    } catch {
      setVerifyResult({ verified: false, message: "Verification failed — DNS lookup error" });
    } finally {
      setVerifying(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const toggleActive = (t: AdminTenant) => {
    const action = t.is_active ? "Disable" : "Enable";
    setConfirmTitle(`${action} Site`);
    setConfirmMessage(
      t.is_active
        ? `Disable "${t.site_name}"? The site will go offline and users won't be able to access it.`
        : `Enable "${t.site_name}"? The site will go back online.`
    );
    setConfirmVariant(t.is_active ? "danger" : "default");
    setConfirmAction(() => async () => {
      await api.patch(`/admin/tenants/${t.id}`, { is_active: !t.is_active });
      fetchTenants();
    });
    setConfirmOpen(true);
  };

  const toggleMaintenance = (t: AdminTenant) => {
    const entering = !t.maintenance_mode;
    setConfirmTitle(entering ? "Enable Maintenance Mode" : "Exit Maintenance Mode");
    setConfirmMessage(
      entering
        ? `Put "${t.site_name}" into maintenance mode? Users will see a maintenance page instead of content.`
        : `Take "${t.site_name}" out of maintenance mode? The site will resume normal operation.`
    );
    setConfirmVariant(entering ? "danger" : "default");
    setConfirmAction(() => async () => {
      await api.patch(`/admin/tenants/${t.id}`, { maintenance_mode: entering });
      fetchTenants();
    });
    setConfirmOpen(true);
  };

  const requestDelete = (t: AdminTenant) => {
    setConfirmTitle("Delete Tenant");
    setConfirmMessage(
      `Permanently delete "${t.site_name}"? This will remove all associated categories, live streams, and data. This cannot be undone.`
    );
    setConfirmVariant("danger");
    setConfirmAction(() => async () => {
      await api.delete(`/admin/tenants/${t.id}`);
      fetchTenants();
    });
    setConfirmOpen(true);
  };

  const contentBadge = (level: string) => {
    const colors: Record<string, string> = {
      safe: "bg-green-500/20 text-green-400",
      mature: "bg-yellow-500/20 text-yellow-400",
      explicit: "bg-red-500/20 text-red-400",
    };
    return colors[level] || colors.safe;
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tenants</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} /> Add Tenant
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search tenants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : tenants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Globe size={40} className="mb-3 opacity-50" />
            <p>No tenants found. Create your first tenant to get started.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">Domain</th>
                <th className="px-4 py-3">Content Level</th>
                <th className="px-4 py-3">Age Gate</th>
                <th className="px-4 py-3">Sub/Pass</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {tenants.map((t) => (
                <tr key={t.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-8 w-8 rounded"
                        style={{ backgroundColor: t.primary_color }}
                      />
                      <div>
                        <p className="font-medium text-white">{t.site_name}</p>
                        <p className="text-xs text-gray-500">{t.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{t.domain}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${contentBadge(t.max_content_level)}`}>
                      {t.max_content_level}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{t.age_verification.replace("_", " ")}</td>
                  <td className="px-4 py-3">
                    {t.subscriptions_enabled ? (
                      <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">Enabled</span>
                    ) : (
                      <span className="rounded-full bg-gray-500/20 px-2 py-0.5 text-xs font-medium text-gray-500">Off</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!t.is_active ? (
                      <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">Disabled</span>
                    ) : t.maintenance_mode ? (
                      <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400">Maintenance</span>
                    ) : (
                      <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(t)}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                        title="Edit"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => toggleMaintenance(t)}
                        className={`rounded p-1.5 text-gray-400 hover:bg-white/10 ${t.maintenance_mode ? "text-yellow-400" : "hover:text-yellow-400"}`}
                        title={t.maintenance_mode ? "Exit maintenance" : "Maintenance mode"}
                      >
                        <Wrench size={16} />
                      </button>
                      <button
                        onClick={() => toggleActive(t)}
                        className={`rounded p-1.5 hover:bg-white/10 ${t.is_active ? "text-gray-400 hover:text-red-400" : "text-red-400 hover:text-green-400"}`}
                        title={t.is_active ? "Disable site" : "Enable site"}
                      >
                        <Power size={16} />
                      </button>
                      <button
                        onClick={() => requestDelete(t)}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400"
                        title="Delete tenant"
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
          <span>{total} tenants total</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded border border-[var(--border)] px-3 py-1 hover:bg-white/10 disabled:opacity-30"
            >
              Prev
            </button>
            <span className="flex items-center px-2">{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded border border-[var(--border)] px-3 py-1 hover:bg-white/10 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ===== Create/Edit Modal ===== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editing ? "Edit Tenant" : "Create Tenant"}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {error && <p className="mb-4 rounded bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

            {/* Tab nav */}
            <div className="mb-5 flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-1">
              {([
                { key: "general" as FormTab, label: "General", icon: <Globe size={14} /> },
                { key: "branding" as FormTab, label: "Branding", icon: <Image size={14} /> },
                { key: "seo" as FormTab, label: "SEO", icon: <FileText size={14} /> },
                { key: "domain" as FormTab, label: "Domain", icon: <ExternalLink size={14} /> },
                { key: "features" as FormTab, label: "Features", icon: <ToggleRight size={14} /> },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFormTab(tab.key)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                    formTab === tab.key
                      ? "bg-[var(--primary)] text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSave} className="space-y-5">
              {/* ── General tab ── */}
              {formTab === "general" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs text-gray-400">Site Name</label>
                      <input
                        type="text"
                        value={formSiteName}
                        onChange={(e) => setFormSiteName(e.target.value)}
                        placeholder="MovieFlix"
                        className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-400">Domain</label>
                      <input
                        type="text"
                        value={formDomain}
                        onChange={(e) => setFormDomain(e.target.value)}
                        placeholder="movieflix.com"
                        className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                        required
                      />
                    </div>
                  </div>

                  {!editing && (
                    <div>
                      <label className="mb-1 block text-xs text-gray-400">
                        Slug <span className="text-gray-500">(auto-generated if empty)</span>
                      </label>
                      <input
                        type="text"
                        value={formSlug}
                        onChange={(e) => setFormSlug(e.target.value)}
                        placeholder="movieflix"
                        className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                      />
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Description</label>
                    <textarea
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      rows={2}
                      className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                    />
                  </div>

                  {/* Content Settings */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs text-gray-400">Max Content Level</label>
                      <select
                        value={formMaxContent}
                        onChange={(e) => setFormMaxContent(e.target.value)}
                        className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none"
                      >
                        {CONTENT_LEVELS.map((l) => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-400">Age Verification</label>
                      <select
                        value={formAgeVerification}
                        onChange={(e) => setFormAgeVerification(e.target.value)}
                        className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none"
                      >
                        {AGE_VERIFICATIONS.map((v) => (
                          <option key={v} value={v}>{v.replace(/_/g, " ")}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Monetization */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setFormSubscriptionsEnabled((v) => !v)}
                      className="flex w-full items-center gap-3 rounded border border-[var(--border)] px-4 py-3 text-sm text-gray-300 hover:bg-white/5"
                    >
                      {formSubscriptionsEnabled ? (
                        <ToggleRight size={22} className="text-purple-400" />
                      ) : (
                        <ToggleLeft size={22} className="text-gray-500" />
                      )}
                      <Ticket size={16} className={formSubscriptionsEnabled ? "text-purple-400" : "text-gray-500"} />
                      <span>Subscriptions / Pass</span>
                      <span className={`ml-auto text-xs ${formSubscriptionsEnabled ? "text-purple-400" : "text-gray-500"}`}>
                        {formSubscriptionsEnabled ? "Enabled" : "Disabled"}
                      </span>
                    </button>
                  </div>
                </>
              )}

              {/* ── Branding tab ── */}
              {formTab === "branding" && (
                <>
                  {/* Logo + Favicon uploads */}
                  <div className="grid grid-cols-2 gap-6">
                    {/* Logo */}
                    <div>
                      <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">Logo</label>
                      <div
                        onClick={() => editing && logoInputRef.current?.click()}
                        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${
                          editing ? "cursor-pointer border-[var(--border)] hover:border-gray-500" : "border-[var(--border)] opacity-60"
                        }`}
                      >
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f && editing) uploadAsset(editing.id, "logo", f);
                          }}
                        />
                        {uploadingLogo ? (
                          <Loader2 size={24} className="animate-spin text-gray-400" />
                        ) : formLogoUrl ? (
                          <img src={formLogoUrl} alt="Logo" className="max-h-16 max-w-full object-contain" />
                        ) : (
                          <>
                            <Image size={24} className="mb-1 text-gray-500" />
                            <p className="text-xs text-gray-500">{editing ? "Click to upload" : "Save tenant first"}</p>
                          </>
                        )}
                      </div>
                      {formLogoUrl && (
                        <input
                          type="text"
                          value={formLogoUrl}
                          onChange={(e) => setFormLogoUrl(e.target.value)}
                          placeholder="Or paste URL"
                          className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs text-gray-400 outline-none focus:border-[var(--primary)]"
                        />
                      )}
                    </div>

                    {/* Favicon */}
                    <div>
                      <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">Favicon</label>
                      <div
                        onClick={() => editing && faviconInputRef.current?.click()}
                        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${
                          editing ? "cursor-pointer border-[var(--border)] hover:border-gray-500" : "border-[var(--border)] opacity-60"
                        }`}
                      >
                        <input
                          ref={faviconInputRef}
                          type="file"
                          accept="image/*,.ico"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f && editing) uploadAsset(editing.id, "favicon", f);
                          }}
                        />
                        {uploadingFavicon ? (
                          <Loader2 size={24} className="animate-spin text-gray-400" />
                        ) : formFaviconUrl ? (
                          <img src={formFaviconUrl} alt="Favicon" className="h-8 w-8 object-contain" />
                        ) : (
                          <>
                            <Shield size={24} className="mb-1 text-gray-500" />
                            <p className="text-xs text-gray-500">{editing ? "Click to upload" : "Save tenant first"}</p>
                          </>
                        )}
                      </div>
                      {formFaviconUrl && (
                        <input
                          type="text"
                          value={formFaviconUrl}
                          onChange={(e) => setFormFaviconUrl(e.target.value)}
                          placeholder="Or paste URL"
                          className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs text-gray-400 outline-none focus:border-[var(--primary)]"
                        />
                      )}
                    </div>
                  </div>

                  {!editing && (
                    <p className="rounded bg-blue-500/10 px-3 py-2 text-xs text-blue-400">
                      Create the tenant first, then come back to upload logo and favicon images.
                    </p>
                  )}

                  {/* Colors */}
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">Colors</label>
                    <div className="flex flex-wrap gap-4">
                      {([
                        { label: "Primary", value: formPrimaryColor, set: setFormPrimaryColor },
                        { label: "Secondary", value: formSecondaryColor, set: setFormSecondaryColor },
                        { label: "Background", value: formBgColor, set: setFormBgColor },
                      ] as const).map((c) => (
                        <div key={c.label}>
                          <label className="mb-1 block text-xs text-gray-500">{c.label}</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={c.value}
                              onChange={(e) => c.set(e.target.value)}
                              className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent"
                            />
                            <input
                              type="text"
                              value={c.value}
                              onChange={(e) => c.set(e.target.value)}
                              className="w-20 rounded border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs text-white outline-none"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Live preview */}
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">Preview</label>
                    <div
                      className="rounded-lg border border-[var(--border)] p-4"
                      style={{ backgroundColor: formBgColor }}
                    >
                      <div className="flex items-center gap-3 mb-3">
                        {formLogoUrl ? (
                          <img src={formLogoUrl} alt="" className="h-8 object-contain" />
                        ) : (
                          <div className="h-8 w-24 rounded" style={{ backgroundColor: formPrimaryColor, opacity: 0.3 }} />
                        )}
                        <span className="text-sm font-bold" style={{ color: formPrimaryColor }}>
                          {formSiteName || "Site Name"}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <div className="h-6 rounded px-3 py-1 text-xs text-white" style={{ backgroundColor: formPrimaryColor }}>
                          Primary Button
                        </div>
                        <div className="h-6 rounded px-3 py-1 text-xs text-white" style={{ backgroundColor: formSecondaryColor }}>
                          Secondary
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ── SEO tab ── */}
              {formTab === "seo" && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Meta Title</label>
                    <input
                      type="text"
                      value={formMetaTitle}
                      onChange={(e) => setFormMetaTitle(e.target.value)}
                      placeholder="MovieFlix — Stream Movies & Shows"
                      className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                    />
                    <p className="mt-1 text-[11px] text-gray-500">{formMetaTitle.length}/60 characters recommended</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Meta Description</label>
                    <textarea
                      value={formMetaDescription}
                      onChange={(e) => setFormMetaDescription(e.target.value)}
                      rows={3}
                      placeholder="Watch the latest movies, TV shows, and live streams on MovieFlix..."
                      className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                    />
                    <p className="mt-1 text-[11px] text-gray-500">{formMetaDescription.length}/160 characters recommended</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Meta Keywords</label>
                    <input
                      type="text"
                      value={formMetaKeywords}
                      onChange={(e) => setFormMetaKeywords(e.target.value)}
                      placeholder="streaming, movies, tv shows, live"
                      className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                    />
                  </div>

                  {/* OG Image */}
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">Social Share Image (OG Image)</label>
                    <div
                      onClick={() => editing && ogImageInputRef.current?.click()}
                      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${
                        editing ? "cursor-pointer border-[var(--border)] hover:border-gray-500" : "border-[var(--border)] opacity-60"
                      }`}
                    >
                      <input
                        ref={ogImageInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f && editing) uploadAsset(editing.id, "og_image", f);
                        }}
                      />
                      {uploadingOgImage ? (
                        <Loader2 size={24} className="animate-spin text-gray-400" />
                      ) : formOgImageUrl ? (
                        <img src={formOgImageUrl} alt="OG" className="max-h-24 max-w-full rounded object-contain" />
                      ) : (
                        <>
                          <Image size={24} className="mb-1 text-gray-500" />
                          <p className="text-xs text-gray-500">{editing ? "Upload 1200x630 image" : "Save tenant first"}</p>
                        </>
                      )}
                    </div>
                    {formOgImageUrl && (
                      <input
                        type="text"
                        value={formOgImageUrl}
                        onChange={(e) => setFormOgImageUrl(e.target.value)}
                        placeholder="Or paste URL"
                        className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-2 py-1 text-xs text-gray-400 outline-none focus:border-[var(--primary)]"
                      />
                    )}
                  </div>

                  {/* Search preview */}
                  <div>
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">Search Preview</label>
                    <div className="rounded-lg border border-[var(--border)] bg-white p-4">
                      <p className="text-sm text-blue-700 hover:underline">
                        {formMetaTitle || formSiteName || "Site Title"}
                      </p>
                      <p className="text-xs text-green-700">{formDomain || "example.com"}</p>
                      <p className="mt-1 text-xs text-gray-600">
                        {formMetaDescription || formDescription || "No description set."}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {/* ── Domain tab ── */}
              {formTab === "domain" && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Custom Domain</label>
                    <input
                      type="text"
                      value={formCustomDomain}
                      onChange={(e) => { setFormCustomDomain(e.target.value); setDomainVerified(false); setVerifyResult(null); }}
                      placeholder="watch.yourbrand.com"
                      className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                    />
                    <p className="mt-1 text-[11px] text-gray-500">
                      Enter the domain you own. You&apos;ll need to add DNS records to verify ownership.
                    </p>
                  </div>

                  {/* DNS setup instructions */}
                  {(formCustomDomain || domainVerificationToken) && (
                    <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-4">
                      <h3 className="text-sm font-medium text-white">DNS Setup Instructions</h3>

                      {/* Step 1: Verification */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-bold text-blue-400">1</span>
                          <span className="text-xs font-medium text-gray-300">Verify domain ownership (TXT record)</span>
                        </div>
                        <p className="ml-7 text-xs text-gray-500 mb-2">
                          Add this TXT record at your DNS provider (GoDaddy, Cloudflare, Namecheap, etc.):
                        </p>
                        <div className="ml-7 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-500 w-12">Host:</span>
                            <code className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-gray-300">
                              _streamverify{formCustomDomain ? `.${formCustomDomain}` : ""}
                            </code>
                            <button type="button" onClick={() => copyToClipboard(`_streamverify`)} className="text-gray-500 hover:text-white">
                              <Copy size={12} />
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-500 w-12">Type:</span>
                            <code className="rounded bg-black/30 px-2 py-1 text-xs text-gray-300">TXT</code>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-500 w-12">Value:</span>
                            <code className="flex-1 rounded bg-black/30 px-2 py-1 text-xs text-gray-300 select-all break-all">
                              {domainVerificationToken || "Save the tenant to generate a token"}
                            </code>
                            {domainVerificationToken && (
                              <button type="button" onClick={() => copyToClipboard(domainVerificationToken)} className="text-gray-500 hover:text-white">
                                <Copy size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Step 2: CNAME/A record */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-bold text-blue-400">2</span>
                          <span className="text-xs font-medium text-gray-300">Point domain to platform (CNAME or A record)</span>
                        </div>
                        <p className="ml-7 text-xs text-gray-500 mb-2">
                          Add a CNAME record pointing your domain to the platform:
                        </p>
                        <div className="ml-7 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-500 w-12">Host:</span>
                            <code className="rounded bg-black/30 px-2 py-1 text-xs text-gray-300">{formCustomDomain || "your-domain.com"}</code>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-500 w-12">Type:</span>
                            <code className="rounded bg-black/30 px-2 py-1 text-xs text-gray-300">CNAME</code>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-gray-500 w-12">Value:</span>
                            <code className="rounded bg-black/30 px-2 py-1 text-xs text-gray-300">{formDomain || "platform.example.com"}</code>
                          </div>
                        </div>
                      </div>

                      {/* Verify button */}
                      {editing && domainVerificationToken && (
                        <div className="ml-7 pt-2">
                          <button
                            type="button"
                            onClick={handleVerifyDomain}
                            disabled={verifying}
                            className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                          >
                            {verifying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Verify DNS
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Verification status */}
                  {domainVerified && (
                    <div className="flex items-center gap-2 rounded bg-green-500/10 px-3 py-2">
                      <CheckCircle2 size={16} className="text-green-400" />
                      <span className="text-sm text-green-400">Domain verified and active</span>
                    </div>
                  )}

                  {verifyResult && !verifyResult.verified && (
                    <div className="flex items-start gap-2 rounded bg-yellow-500/10 px-3 py-2">
                      <AlertCircle size={16} className="mt-0.5 shrink-0 text-yellow-400" />
                      <div>
                        <p className="text-sm text-yellow-400">{verifyResult.message}</p>
                        <p className="mt-1 text-xs text-gray-500">DNS changes can take up to 48 hours to propagate. Try again later.</p>
                      </div>
                    </div>
                  )}

                  {verifyResult?.verified && (
                    <div className="flex items-center gap-2 rounded bg-green-500/10 px-3 py-2">
                      <CheckCircle2 size={16} className="text-green-400" />
                      <span className="text-sm text-green-400">{verifyResult.message}</span>
                    </div>
                  )}
                </>
              )}

              {/* ── Features tab ── */}
              {formTab === "features" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.keys(formFeatures).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleFeature(key)}
                        className="flex items-center gap-2 rounded border border-[var(--border)] px-3 py-2 text-sm text-gray-300 hover:bg-white/5"
                      >
                        {formFeatures[key] ? (
                          <ToggleRight size={18} className="text-green-400" />
                        ) : (
                          <ToggleLeft size={18} className="text-gray-500" />
                        )}
                        {key.replace(/_/g, " ")}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Footer */}
              <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
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
                  {saving ? "Saving..." : editing ? "Save Changes" : "Create Tenant"}
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
        confirmLabel={confirmTitle.startsWith("Delete") ? "Delete" : "Confirm"}
        variant={confirmVariant}
        onConfirm={async () => {
          if (confirmAction) await confirmAction();
          setConfirmOpen(false);
          setConfirmAction(null);
        }}
        onCancel={() => { setConfirmOpen(false); setConfirmAction(null); }}
      />
    </div>
  );
}
