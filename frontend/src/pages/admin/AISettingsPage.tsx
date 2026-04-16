import { useEffect, useRef, useState } from "react";
import {
  Brain,
  Download,
  Trash2,
  Loader2,
  Check,
  RefreshCw,
  Cpu,
  Cloud,
  Play,
  AlertCircle,
  Eye,
  ScanSearch,
  MessageSquare,
  Search,
  X,
  ExternalLink,
  Tag,
  Zap,
  HardDrive,
} from "lucide-react";

import { API_URL as API } from "@/lib/constants";

interface AIConfig {
  use_external_llm: boolean;
  external_provider: string;
  external_api_key_set: boolean;
  external_model: string;
  local_model: string;
  scene_analysis_model: string;
  embedding_model: string;
  auto_analyze_uploads: boolean;
  smart_search_enabled: boolean;
  recommendation_reasons: boolean;
}

interface ModelEntry {
  name: string;
  description: string;
  size_mb: number;
  downloaded: boolean;
  active: boolean;
  vision?: boolean;
  file_size_mb?: number;
  context_length?: number;
  parameters?: string;
  tags?: string[];
  strengths?: string;
}

interface HFSearchResult {
  repo_id: string;
  filename: string;
  mmproj_filename?: string;
  downloads: number;
  likes: number;
  pipeline_tag: string;
  architecture: string;
  context_length: number;
  estimated_size_mb: number;
  vision: boolean;
  tags: string[];
  in_catalog: boolean;
  available_files: string[];
}

interface DownloadProgress {
  progress: number;
  downloaded_mb: number;
  total_mb: number;
  status: string;
}

function getToken() {
  return localStorage.getItem("access_token") || "";
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  };
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const TAG_COLORS: Record<string, string> = {
  fast: "bg-green-500/20 text-green-400",
  reasoning: "bg-amber-500/20 text-amber-400",
  coding: "bg-cyan-500/20 text-cyan-400",
  json: "bg-indigo-500/20 text-indigo-400",
  vision: "bg-blue-500/20 text-blue-400",
  multilingual: "bg-pink-500/20 text-pink-400",
  new: "bg-yellow-500/20 text-yellow-400",
  quality: "bg-purple-500/20 text-purple-400",
  math: "bg-orange-500/20 text-orange-400",
  lightweight: "bg-emerald-500/20 text-emerald-400",
  general: "bg-gray-500/20 text-gray-400",
  instruction: "bg-slate-500/20 text-slate-400",
  community: "bg-teal-500/20 text-teal-400",
};

export default function AISettingsPage() {
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({});
  const [loadingModel, setLoadingModel] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<HFSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  // Form state for external API key
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [aiHealthy, setAiHealthy] = useState<boolean | null>(null);

  // Progress polling ref
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API}/admin/ai/settings`, { headers: authHeaders() });
      if (res.ok) setConfig(await res.json());
    } catch {
      setError("Failed to load AI settings");
    }
  };

  const fetchModels = async () => {
    try {
      const res = await fetch(`${API}/admin/ai/models`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setModels(data.downloaded || []);
      }
    } catch {
      /* models panel will show empty */
    }
  };

  const checkHealth = async () => {
    try {
      const res = await fetch(`${API}/admin/ai/health`, { headers: authHeaders() });
      setAiHealthy(res.ok);
    } catch {
      setAiHealthy(false);
    }
  };

  const pollProgress = async () => {
    try {
      const res = await fetch(`${API}/admin/ai/models/progress`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setDownloadProgress(data);
        // If no active downloads, stop polling
        if (Object.keys(data).length === 0 && progressInterval.current) {
          clearInterval(progressInterval.current);
          progressInterval.current = null;
        }
      }
    } catch {
      /* ignore */
    }
  };

  const startProgressPolling = () => {
    if (progressInterval.current) return;
    progressInterval.current = setInterval(pollProgress, 1000);
  };

  useEffect(() => {
    Promise.all([fetchConfig(), fetchModels(), checkHealth()]).then(() => setLoading(false));
    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current);
    };
  }, []);

  const updateConfig = async (updates: Partial<AIConfig & { external_api_key?: string }>) => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${API}/admin/ai/settings`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setSuccess("Settings saved");
        setTimeout(() => setSuccess(""), 2000);
      } else {
        setError("Failed to save settings");
      }
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const searchModels = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `${API}/admin/ai/models/search?q=${encodeURIComponent(query)}&limit=15`,
        { headers: authHeaders() },
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      }
    } catch {
      setError("Search failed — AI service may be offline");
    } finally {
      setSearching(false);
    }
  };

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (value.trim().length >= 2) {
      searchTimeout.current = setTimeout(() => searchModels(value), 400);
    } else {
      setSearchResults([]);
    }
  };

  const downloadModel = async (
    name: string,
    opts?: { repo_id?: string; filename?: string; mmproj_filename?: string },
  ) => {
    setDownloading(name);
    setError("");
    startProgressPolling();
    try {
      const res = await fetch(`${API}/admin/ai/models/download`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ model_name: name, ...opts }),
      });
      if (res.ok) {
        await fetchModels();
        setSuccess(`Model ${name} downloaded`);
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(`Failed to download ${name}`);
      }
    } catch {
      setError(`Failed to download ${name}`);
    } finally {
      setDownloading(null);
      // Final progress poll
      setTimeout(pollProgress, 500);
    }
  };

  const loadModel = async (name: string) => {
    setLoadingModel(name);
    setError("");
    try {
      const res = await fetch(`${API}/admin/ai/models/load`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ model_name: name }),
      });
      if (res.ok) {
        await fetchModels();
        setSuccess(`Model ${name} loaded`);
        setTimeout(() => setSuccess(""), 2000);
      } else {
        setError(`Failed to load ${name}`);
      }
    } catch {
      setError(`Failed to load ${name}`);
    } finally {
      setLoadingModel(null);
    }
  };

  const deleteModel = async (name: string) => {
    if (!confirm(`Delete model ${name}? You'll need to re-download it.`)) return;
    setDeletingModel(name);
    try {
      const res = await fetch(`${API}/admin/ai/models/${name}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok) {
        await fetchModels();
        setSuccess(`Model ${name} deleted`);
        setTimeout(() => setSuccess(""), 2000);
      }
    } catch {
      setError(`Failed to delete ${name}`);
    } finally {
      setDeletingModel(null);
    }
  };

  if (loading || !config)
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Brain size={28} />
            AI Settings
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Configure local LLM, external providers, and AI features
          </p>
        </div>
        <div className="flex items-center gap-3">
          {aiHealthy !== null && (
            <span
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full ${aiHealthy ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}
            >
              <span className={`w-2 h-2 rounded-full ${aiHealthy ? "bg-green-400" : "bg-red-400"}`} />
              AI Service {aiHealthy ? "Online" : "Offline"}
            </span>
          )}
          <button
            onClick={() => { checkHealth(); fetchModels(); }}
            className="p-2 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Status messages */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-3 text-sm text-green-400">
          <Check size={16} /> {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── LLM Provider Card ── */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-6 space-y-5">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            {config.use_external_llm ? <Cloud size={20} /> : <Cpu size={20} />}
            LLM Provider
          </h2>

          {/* Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white">Use External AI Provider</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {config.use_external_llm
                  ? "Using cloud API (Claude/OpenAI) with local fallback"
                  : "Using local LLM (free, no API key) with external fallback"}
              </p>
            </div>
            <button
              onClick={() => updateConfig({ use_external_llm: !config.use_external_llm })}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${config.use_external_llm ? "bg-purple-600" : "bg-gray-600"}`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform mt-0.5 ${config.use_external_llm ? "translate-x-5 ml-0.5" : "translate-x-0.5"}`}
              />
            </button>
          </div>

          {/* Per-task model selectors */}
          <div className="space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Per-Task Models</p>

            {/* Text / reasoning tasks */}
            <div>
              <label className="text-sm text-gray-400 flex items-center gap-1.5 mb-1.5">
                <MessageSquare size={13} /> Content Analysis &amp; Search (text)
              </label>
              <select
                value={config.local_model}
                onChange={(e) => updateConfig({ local_model: e.target.value })}
                className="w-full rounded-lg border border-[var(--border)] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
              >
                {models.filter((m) => !m.vision).map((m) => (
                  <option key={m.name} value={m.name} disabled={!m.downloaded}>
                    {m.name} {m.downloaded ? (m.active ? "(active)" : "") : "(not downloaded)"}
                  </option>
                ))}
                {models.filter((m) => !m.vision).length === 0 && (
                  <option value={config.local_model}>{config.local_model}</option>
                )}
              </select>
            </div>

            {/* Vision / scene analysis */}
            <div>
              <label className="text-sm text-gray-400 flex items-center gap-1.5 mb-1.5">
                <ScanSearch size={13} /> Scene Analysis — preview frame selection (vision)
              </label>
              <select
                value={config.scene_analysis_model}
                onChange={(e) => updateConfig({ scene_analysis_model: e.target.value })}
                className="w-full rounded-lg border border-[var(--border)] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
              >
                {models.map((m) => (
                  <option key={m.name} value={m.name} disabled={!m.downloaded}>
                    {m.name}
                    {m.vision ? " [vision]" : " [text-only]"}
                    {!m.downloaded ? " (not downloaded)" : m.active ? " (active)" : ""}
                  </option>
                ))}
                {models.length === 0 && (
                  <option value={config.scene_analysis_model}>{config.scene_analysis_model}</option>
                )}
              </select>
              <p className="text-xs text-gray-600 mt-1">
                Vision models analyze actual video frames. Text-only models use metadata heuristics.
              </p>
            </div>
          </div>

          {/* External provider config */}
          <div className="space-y-3 pt-2 border-t border-[var(--border)]">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              External Provider {config.use_external_llm ? "(Primary)" : "(Fallback)"}
            </p>

            <div>
              <label className="text-sm text-gray-400 block mb-1.5">Provider</label>
              <select
                value={config.external_provider}
                onChange={(e) => updateConfig({ external_provider: e.target.value })}
                className="w-full rounded-lg border border-[var(--border)] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
              >
                <option value="anthropic">Anthropic Claude</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>

            <div>
              <label className="text-sm text-gray-400 block mb-1.5">API Key</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder={config.external_api_key_set ? "••••••••••••••" : "Not set"}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder-gray-600"
                />
                <button
                  onClick={() => {
                    if (apiKeyInput.trim()) {
                      updateConfig({ external_api_key: apiKeyInput.trim() });
                      setApiKeyInput("");
                    }
                  }}
                  disabled={!apiKeyInput.trim() || saving}
                  className="rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
              {config.external_api_key_set && (
                <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                  <Check size={12} /> API key configured
                </p>
              )}
            </div>

            <div>
              <label className="text-sm text-gray-400 block mb-1.5">Model</label>
              <input
                type="text"
                value={config.external_model}
                onChange={(e) => updateConfig({ external_model: e.target.value })}
                className="w-full rounded-lg border border-[var(--border)] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
                placeholder="claude-sonnet-4-5-20241022"
              />
            </div>
          </div>
        </div>

        {/* ── Feature Toggles Card ── */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-6 space-y-5">
          <h2 className="text-lg font-semibold text-white">AI Features</h2>

          {[
            {
              key: "smart_search_enabled" as const,
              label: "Smart Search",
              desc: "Use LLM to understand natural language search queries",
            },
            {
              key: "auto_analyze_uploads" as const,
              label: "Auto-Analyze Uploads",
              desc: "Automatically suggest tags and classification for new uploads",
            },
            {
              key: "recommendation_reasons" as const,
              label: "Recommendation Reasons",
              desc: "Generate human-readable reasons for why videos are recommended",
            },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white">{label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              </div>
              <button
                onClick={() => updateConfig({ [key]: !config[key] })}
                disabled={saving}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${config[key] ? "bg-purple-600" : "bg-gray-600"}`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform mt-0.5 ${config[key] ? "translate-x-5 ml-0.5" : "translate-x-0.5"}`}
                />
              </button>
            </div>
          ))}

          <div className="pt-3 border-t border-[var(--border)]">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Embedding Model</p>
            <div className="flex items-center gap-2 rounded-lg bg-[#0a0a0a] px-3 py-2">
              <Cpu size={14} className="text-gray-500" />
              <span className="text-sm text-gray-300">{config.embedding_model}</span>
              <span className="text-xs text-gray-600 ml-auto">384-dim, local, free</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Local Models Card ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--secondary)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Cpu size={20} />
            Local LLM Models
          </h2>
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
              showSearch
                ? "bg-purple-600 text-white"
                : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Search size={14} />
            {showSearch ? "Close Search" : "Search HuggingFace"}
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Download and manage GGUF models. All run locally on CPU — no API keys or GPU needed. Search HuggingFace to discover new models.
        </p>

        {/* ── HuggingFace Search Panel ── */}
        {showSearch && (
          <div className="mb-6 rounded-lg border border-purple-500/30 bg-purple-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Search size={16} className="text-purple-400" />
              <h3 className="text-sm font-medium text-purple-300">Search HuggingFace Models</h3>
            </div>
            <div className="relative mb-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder="Search for models... (e.g. gemma 4, llama 3, phi, qwen, deepseek)"
                className="w-full rounded-lg border border-purple-500/30 bg-[#0a0a0a] px-3 py-2 pl-9 text-sm text-white placeholder-gray-600"
              />
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); setSearchResults([]); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {searching && (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-3">
                <Loader2 size={14} className="animate-spin" /> Searching HuggingFace...
              </div>
            )}
            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {searchResults.map((r) => (
                  <div
                    key={r.repo_id + r.filename}
                    className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[#0a0a0a] px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white truncate">{r.repo_id.split("/")[1]?.replace(/-GGUF$/i, "")}</span>
                        {r.vision && (
                          <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">
                            <Eye size={10} /> VISION
                          </span>
                        )}
                        {r.in_catalog && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">
                            IN CATALOG
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 truncate">{r.repo_id}</p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-600">
                        <span className="flex items-center gap-1">
                          <Download size={10} /> {formatDownloads(r.downloads)}
                        </span>
                        {r.estimated_size_mb > 0 && (
                          <span className="flex items-center gap-1">
                            <HardDrive size={10} /> ~{(r.estimated_size_mb / 1024).toFixed(1)} GB
                          </span>
                        )}
                        {r.context_length > 0 && (
                          <span>{r.context_length.toLocaleString()} ctx</span>
                        )}
                        {r.architecture && <span>{r.architecture}</span>}
                      </div>
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {r.tags.slice(0, 5).map((tag) => (
                          <span
                            key={tag}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TAG_COLORS[tag] || "bg-gray-500/20 text-gray-400"}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <p className="text-[11px] text-gray-600 mt-1">
                        File: {r.filename}
                        {r.available_files.length > 1 && ` (+${r.available_files.length - 1} variants)`}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {r.in_catalog ? (
                        <span className="text-[11px] text-green-400">Already added</span>
                      ) : (
                        <button
                          onClick={() => {
                            const name = r.repo_id.split("/")[1]?.replace(/-GGUF$/i, "").toLowerCase().replace(/[^a-z0-9.-]/g, "-") || r.repo_id;
                            downloadModel(name, {
                              repo_id: r.repo_id,
                              filename: r.filename,
                              mmproj_filename: r.mmproj_filename || undefined,
                            });
                          }}
                          disabled={downloading !== null}
                          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          <Download size={12} /> Download
                        </button>
                      )}
                      <a
                        href={`https://huggingface.co/${r.repo_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300"
                      >
                        <ExternalLink size={10} /> View on HF
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
              <p className="text-xs text-gray-500 py-3 text-center">No GGUF models found for "{searchQuery}"</p>
            )}
          </div>
        )}

        {/* ── Catalog Models List ── */}
        <div className="space-y-3">
          {models.map((m) => {
            const progress = downloadProgress[m.name];
            const isDownloading = downloading === m.name || (progress && progress.status === "downloading");

            return (
              <div
                key={m.name}
                className={`rounded-lg border px-4 py-3 ${
                  m.active
                    ? "border-purple-500/50 bg-purple-500/5"
                    : "border-[var(--border)] bg-[#0a0a0a]"
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{m.name}</span>
                      {m.parameters && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-300 font-medium">
                          {m.parameters}
                        </span>
                      )}
                      {m.vision && (
                        <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">
                          <Eye size={10} /> VISION
                        </span>
                      )}
                      {m.active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-medium">
                          ACTIVE
                        </span>
                      )}
                      {m.downloaded && !m.active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">
                          READY
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{m.description}</p>

                    {/* Capability tags */}
                    {m.tags && m.tags.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        <Tag size={10} className="text-gray-600" />
                        {m.tags.map((tag) => (
                          <span
                            key={tag}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TAG_COLORS[tag] || "bg-gray-500/20 text-gray-400"}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Strengths */}
                    {m.strengths && (
                      <p className="text-[11px] text-gray-600 mt-1 flex items-start gap-1">
                        <Zap size={10} className="shrink-0 mt-0.5 text-amber-500/60" />
                        {m.strengths}
                      </p>
                    )}

                    <p className="text-xs text-gray-600 mt-1">
                      {m.downloaded && m.file_size_mb
                        ? `${m.file_size_mb.toLocaleString()} MB on disk`
                        : `~${(m.size_mb / 1024).toFixed(1)} GB`}
                      {m.context_length ? ` · ${m.context_length.toLocaleString()} ctx` : ""}
                      {m.vision ? " · requires mmproj" : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!m.downloaded ? (
                      <button
                        onClick={() => downloadModel(m.name)}
                        disabled={downloading !== null}
                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isDownloading ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Download size={14} />
                        )}
                        {isDownloading ? "Downloading..." : "Download"}
                      </button>
                    ) : (
                      <>
                        {!m.active && (
                          <button
                            onClick={() => loadModel(m.name)}
                            disabled={loadingModel !== null}
                            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs text-white hover:bg-purple-700 disabled:opacity-50"
                          >
                            {loadingModel === m.name ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Play size={14} />
                            )}
                            Load
                          </button>
                        )}
                        <button
                          onClick={() => deleteModel(m.name)}
                          disabled={deletingModel !== null}
                          className="p-1.5 rounded-lg text-gray-500 hover:bg-red-500/10 hover:text-red-400"
                        >
                          {deletingModel === m.name ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Download progress bar */}
                {isDownloading && progress && progress.progress > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                      <span>{progress.status === "downloading mmproj" ? "Downloading vision module..." : "Downloading..."}</span>
                      <span>
                        {progress.downloaded_mb.toFixed(0)} / {progress.total_mb.toFixed(0)} MB ({progress.progress.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${Math.min(progress.progress, 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {models.length === 0 && (
            <div className="text-center py-8 text-gray-500 text-sm">
              <Cpu size={32} className="mx-auto mb-2 opacity-30" />
              AI service unavailable or no models in catalog
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
