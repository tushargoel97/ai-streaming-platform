import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { TenantConfig } from "@/types/api";

interface AgeGateProps {
  config: TenantConfig;
  onVerified: () => void;
}

export default function AgeGate({ config, onVerified }: AgeGateProps) {
  const mode = config.age_verification;

  if (mode === "click_through") {
    return <ClickThroughGate siteName={config.site_name} onVerified={onVerified} />;
  }

  if (mode === "date_of_birth") {
    return <DobGate siteName={config.site_name} onVerified={onVerified} />;
  }

  return null;
}

function ClickThroughGate({ siteName, onVerified }: { siteName: string; onVerified: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black">
      <div className="mx-4 w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 text-center">
        <ShieldAlert size={48} className="mx-auto mb-4 text-yellow-500" />
        <h1 className="mb-2 text-xl font-bold text-white">{siteName}</h1>
        <p className="mb-6 text-sm text-gray-400">
          This site contains age-restricted content. By entering, you confirm that you are at least
          18 years old and are legally permitted to view such content in your jurisdiction.
        </p>
        <div className="flex gap-3">
          <a
            href="https://www.google.com"
            className="flex-1 rounded border border-[var(--border)] py-2.5 text-sm text-gray-400 hover:bg-white/5"
          >
            Leave
          </a>
          <button
            onClick={onVerified}
            className="flex-1 rounded bg-[var(--primary)] py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            I am 18 or older
          </button>
        </div>
      </div>
    </div>
  );
}

function DobGate({ siteName, onVerified }: { siteName: string; onVerified: () => void }) {
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    setError("");
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    const y = parseInt(year, 10);

    if (!m || !d || !y || m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) {
      setError("Please enter a valid date of birth.");
      return;
    }

    const dob = new Date(y, m - 1, d);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDiff = now.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
      age--;
    }

    if (age < 18) {
      setError("You must be at least 18 years old to access this site.");
      return;
    }

    onVerified();
  };

  const inputClass =
    "w-full rounded bg-black/40 px-3 py-2.5 text-center text-sm text-white outline-none focus:ring-1 focus:ring-[var(--primary)]";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black">
      <div className="mx-4 w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 text-center">
        <ShieldAlert size={48} className="mx-auto mb-4 text-yellow-500" />
        <h1 className="mb-2 text-xl font-bold text-white">{siteName}</h1>
        <p className="mb-6 text-sm text-gray-400">
          This site contains age-restricted content. Please enter your date of birth to verify your
          age.
        </p>

        <div className="mb-4 flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-500">Month</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="MM"
              maxLength={2}
              value={month}
              onChange={(e) => setMonth(e.target.value.replace(/\D/g, ""))}
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-500">Day</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="DD"
              maxLength={2}
              value={day}
              onChange={(e) => setDay(e.target.value.replace(/\D/g, ""))}
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-gray-500">Year</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="YYYY"
              maxLength={4}
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
              className={inputClass}
            />
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <div className="flex gap-3">
          <a
            href="https://www.google.com"
            className="flex-1 rounded border border-[var(--border)] py-2.5 text-sm text-gray-400 hover:bg-white/5"
          >
            Leave
          </a>
          <button
            onClick={handleSubmit}
            className="flex-1 rounded bg-[var(--primary)] py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Verify Age
          </button>
        </div>
      </div>
    </div>
  );
}
