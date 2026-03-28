import { useEffect, useState } from "react";
import {
  Brain,
  Download,
  Trash2,
  Loader2,
  Check,
  X,
  RefreshCw,
  Cpu,
  Cloud,
  Play,
  AlertCircle,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "/api/v1";

interface AIConfig {
  use_external_llm: boolean;
  external_provider: string;
  external_api_key_set: boolean;
  external_model: string;
  local_model: string;
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
  file_size_mb?: number;
  context_length?: number;
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

export default function AISettingsPage() {
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [loadingModel, setLoadingModel] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Form state for external API key (separate since backend doesn't expose it)
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [aiHealthy, setAiHealthy] = useState<boolean | null>(null);

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

  useEffect(() => {
    Promise.all([fetchConfig(), fetchModels(), checkHealth()]).then(() => setLoading(false));
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

  const downloadModel = async (name: string) => {
    setDownloading(name);
    setError("");
    try {
      const res = await fetch(`${API}/admin/ai/models/download`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ model_name: name }),
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

          {/* Local model selector */}
          <div>
            <label className="text-sm text-gray-400 block mb-1.5">Local Model</label>
            <select
              value={config.local_model}
              onChange={(e) => updateConfig({ local_model: e.target.value })}
              className="w-full rounded-lg border border-[var(--border)] bg-[#0a0a0a] px-3 py-2 text-sm text-white"
            >
              {models.map((m) => (
                <option key={m.name} value={m.name} disabled={!m.downloaded}>
                  {m.name} {m.downloaded ? (m.active ? "(active)" : "") : "(not downloaded)"}
                </option>
              ))}
              {models.length === 0 && <option value={config.local_model}>{config.local_model}</option>}
            </select>
          </div>

          {/* External provider config (always visible for fallback) */}
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
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Cpu size={20} />
          Local LLM Models
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Download and manage GGUF models. They run entirely on CPU inside the AI container — no API keys or GPU needed.
        </p>

        <div className="space-y-3">
          {models.map((m) => (
            <div
              key={m.name}
              className={`flex items-center gap-4 rounded-lg border px-4 py-3 ${
                m.active
                  ? "border-purple-500/50 bg-purple-500/5"
                  : "border-[var(--border)] bg-[#0a0a0a]"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{m.name}</span>
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
                <p className="text-xs text-gray-600 mt-0.5">
                  {m.downloaded && m.file_size_mb
                    ? `${m.file_size_mb.toLocaleString()} MB on disk`
                    : `~${(m.size_mb / 1024).toFixed(1)} GB`}
                  {m.context_length ? ` · ${m.context_length.toLocaleString()} ctx` : ""}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {!m.downloaded ? (
                  <button
                    onClick={() => downloadModel(m.name)}
                    disabled={downloading !== null}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {downloading === m.name ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    {downloading === m.name ? "Downloading..." : "Download"}
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
          ))}

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
