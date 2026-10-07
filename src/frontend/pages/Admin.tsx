import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { StatsPanel, type ProcessingStats } from "../components/StatsPanel";
import { button, card, input as inputClass } from "../lib/ui";

interface Lead {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  companySize: string | null;
  message: string | null;
  status: "new" | "contacted" | "closed";
  createdAt: string;
}

interface OwnerResult {
  ownerType: "user" | "org";
  ownerId: string;
  label: string;
  tier: string;
  retentionDaysOverride: number | null;
}

interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  updatedAt: string;
}

const compactSelect =
  "rounded-lg border border-slate-300 px-2 py-1 text-xs transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10";
const compactInput =
  "rounded-lg border border-slate-300 px-2 py-1 text-xs transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10";

export default function Admin() {
  const [status, setStatus] = useState<"checking" | "authorized" | "forbidden">("checking");
  const [stats, setStats] = useState<ProcessingStats | null>(null);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadBusy, setLeadBusy] = useState<string | null>(null);

  const [ownerQuery, setOwnerQuery] = useState("");
  const [ownerResults, setOwnerResults] = useState<OwnerResult[]>([]);
  const [ownerSearchBusy, setOwnerSearchBusy] = useState(false);
  const [overrideBusy, setOverrideBusy] = useState<string | null>(null);
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, { tier: string; retentionDays: string }>>({});

  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [newFlagKey, setNewFlagKey] = useState("");
  const [newFlagDescription, setNewFlagDescription] = useState("");
  const [flagBusy, setFlagBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/ping")
      .then((res) => setStatus(res.ok ? "authorized" : "forbidden"))
      .catch(() => setStatus("forbidden"));
  }, []);

  function loadLeads() {
    fetch("/api/admin/leads")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setLeads((data as { leads: Lead[] }).leads))
      .catch(() => {});
  }

  function loadFlags() {
    fetch("/api/admin/feature-flags")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setFlags((data as { flags: FeatureFlag[] }).flags))
      .catch(() => {});
  }

  useEffect(() => {
    if (status !== "authorized") return;
    fetch("/api/admin/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setStats(data as ProcessingStats | null))
      .catch(() => setStats(null));
    loadLeads();
    loadFlags();
  }, [status]);

  async function updateLeadStatus(id: string, newStatus: Lead["status"]) {
    setLeadBusy(id);
    try {
      const res = await fetch(`/api/admin/leads/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status: newStatus } : l)));
      }
    } finally {
      setLeadBusy(null);
    }
  }

  async function searchOwners(e: React.FormEvent) {
    e.preventDefault();
    const q = ownerQuery.trim();
    if (!q) return;
    setOwnerSearchBusy(true);
    try {
      const res = await fetch(`/api/admin/owners/search?q=${encodeURIComponent(q)}`);
      const body = (await res.json().catch(() => null)) as { owners?: OwnerResult[] } | null;
      const owners = body?.owners ?? [];
      setOwnerResults(owners);
      setOverrideDrafts((prev) => {
        const next = { ...prev };
        for (const o of owners) {
          next[o.ownerId] ??= { tier: o.tier, retentionDays: o.retentionDaysOverride?.toString() ?? "" };
        }
        return next;
      });
    } finally {
      setOwnerSearchBusy(false);
    }
  }

  async function saveTier(owner: OwnerResult) {
    const draft = overrideDrafts[owner.ownerId];
    if (!draft) return;
    setOverrideBusy(owner.ownerId);
    try {
      await fetch(`/api/admin/subscriptions/${owner.ownerType}/${owner.ownerId}/tier`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: draft.tier }),
      });
      setOwnerResults((prev) => prev.map((o) => (o.ownerId === owner.ownerId ? { ...o, tier: draft.tier } : o)));
    } finally {
      setOverrideBusy(null);
    }
  }

  async function saveRetention(owner: OwnerResult) {
    const draft = overrideDrafts[owner.ownerId];
    if (!draft) return;
    const trimmed = draft.retentionDays.trim();
    const retentionDays = trimmed === "" ? null : Number(trimmed);
    if (retentionDays !== null && (!Number.isInteger(retentionDays) || retentionDays < 0)) return;
    setOverrideBusy(owner.ownerId);
    try {
      await fetch(`/api/admin/subscriptions/${owner.ownerType}/${owner.ownerId}/retention`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays }),
      });
      setOwnerResults((prev) => prev.map((o) => (o.ownerId === owner.ownerId ? { ...o, retentionDaysOverride: retentionDays } : o)));
    } finally {
      setOverrideBusy(null);
    }
  }

  async function toggleFlag(flag: FeatureFlag) {
    setFlagBusy(flag.key);
    try {
      await fetch(`/api/admin/feature-flags/${flag.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !flag.enabled }),
      });
      loadFlags();
    } finally {
      setFlagBusy(null);
    }
  }

  async function createFlag(e: React.FormEvent) {
    e.preventDefault();
    const key = newFlagKey.trim();
    if (!key) return;
    setFlagBusy(key);
    try {
      await fetch(`/api/admin/feature-flags/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false, description: newFlagDescription.trim() || null }),
      });
      setNewFlagKey("");
      setNewFlagDescription("");
      loadFlags();
    } finally {
      setFlagBusy(null);
    }
  }

  async function removeFlag(key: string) {
    setFlagBusy(key);
    try {
      await fetch(`/api/admin/feature-flags/${key}`, { method: "DELETE" });
      loadFlags();
    } finally {
      setFlagBusy(null);
    }
  }

  return (
    <Layout>
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">Admin</h1>
        {status === "checking" && <p className="mt-4 text-slate-600">Checking access…</p>}
        {status === "forbidden" && (
          <p className="mt-4 text-red-600">
            Not authorized — this page is restricted to the operator's allowlisted account.
          </p>
        )}
        {status === "authorized" && (
          <>
            <div className="mt-6">
              <h2 className="text-lg font-semibold text-slate-900">Platform-wide processing</h2>
              <p className="mt-1 text-sm text-slate-500">Across every user and organization, every tier.</p>
              <div className="mt-3">{stats && <StatsPanel stats={stats} />}</div>
            </div>

            <div className="mt-10">
              <h2 className="text-lg font-semibold text-slate-900">Sales leads</h2>
              <div className={`mt-3 ${card()}`}>
                {leads.length === 0 ? (
                  <p className="text-sm text-slate-500">No leads yet.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {leads.map((lead) => (
                      <li key={lead.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">
                            {lead.companyName} — {lead.contactName}
                          </p>
                          <p className="text-slate-500">
                            {lead.email}
                            {lead.companySize ? ` · ${lead.companySize}` : ""}
                          </p>
                          {lead.message && <p className="mt-1 text-slate-600">{lead.message}</p>}
                          <p className="mt-1 text-xs text-slate-400">{new Date(lead.createdAt).toLocaleString()}</p>
                        </div>
                        <select
                          value={lead.status}
                          onChange={(e) => updateLeadStatus(lead.id, e.target.value as Lead["status"])}
                          disabled={leadBusy === lead.id}
                          className={compactSelect}
                        >
                          <option value="new">New</option>
                          <option value="contacted">Contacted</option>
                          <option value="closed">Closed</option>
                        </select>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-10">
              <h2 className="text-lg font-semibold text-slate-900">Plan overrides</h2>
              <p className="mt-1 text-sm text-slate-500">Search by user email or organization name.</p>
              <form onSubmit={searchOwners} className="mt-3 flex gap-2">
                <input
                  value={ownerQuery}
                  onChange={(e) => setOwnerQuery(e.target.value)}
                  placeholder="email or org name"
                  className={inputClass("max-w-sm")}
                />
                <button type="submit" disabled={ownerSearchBusy} className={button("secondary", "md")}>
                  {ownerSearchBusy ? "Searching…" : "Search"}
                </button>
              </form>

              {ownerResults.length > 0 && (
                <div className={`mt-3 ${card()}`}>
                  <ul className="divide-y divide-slate-100">
                    {ownerResults.map((owner) => {
                      const draft = overrideDrafts[owner.ownerId] ?? {
                        tier: owner.tier,
                        retentionDays: owner.retentionDaysOverride?.toString() ?? "",
                      };
                      const busy = overrideBusy === owner.ownerId;
                      return (
                        <li key={owner.ownerId} className="py-3 text-sm">
                          <p className="font-medium text-slate-900">
                            {owner.label} <span className="text-xs font-normal capitalize text-slate-400">({owner.ownerType})</span>
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <select
                              value={draft.tier}
                              onChange={(e) =>
                                setOverrideDrafts((prev) => ({ ...prev, [owner.ownerId]: { ...draft, tier: e.target.value } }))
                              }
                              disabled={busy}
                              className={compactSelect}
                            >
                              <option value="free">Free</option>
                              <option value="pro">Pro</option>
                              <option value="metered">Metered</option>
                              <option value="enterprise">Enterprise</option>
                            </select>
                            <button onClick={() => saveTier(owner)} disabled={busy} className={button("secondary", "sm")}>
                              Save tier
                            </button>

                            <input
                              value={draft.retentionDays}
                              onChange={(e) =>
                                setOverrideDrafts((prev) => ({
                                  ...prev,
                                  [owner.ownerId]: { ...draft, retentionDays: e.target.value },
                                }))
                              }
                              placeholder="retention days (blank = default)"
                              disabled={busy}
                              className={`w-56 ${compactInput}`}
                            />
                            <button onClick={() => saveRetention(owner)} disabled={busy} className={button("secondary", "sm")}>
                              Save retention
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            <div className="mt-10">
              <h2 className="text-lg font-semibold text-slate-900">Feature flags</h2>
              <div className={`mt-3 ${card()}`}>
                {flags.length === 0 ? (
                  <p className="text-sm text-slate-500">No flags yet.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {flags.map((flag) => (
                      <li key={flag.key} className="flex items-center justify-between gap-3 py-3 text-sm">
                        <div className="min-w-0">
                          <p className="font-mono text-slate-900">{flag.key}</p>
                          {flag.description && <p className="text-slate-500">{flag.description}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleFlag(flag)}
                            disabled={flagBusy === flag.key}
                            className={button(flag.enabled ? "primary" : "secondary", "sm")}
                          >
                            {flag.enabled ? "Enabled" : "Disabled"}
                          </button>
                          <button
                            onClick={() => removeFlag(flag.key)}
                            disabled={flagBusy === flag.key}
                            className="text-xs text-red-600 transition-colors hover:text-red-800 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <form onSubmit={createFlag} className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <input
                    value={newFlagKey}
                    onChange={(e) => setNewFlagKey(e.target.value)}
                    placeholder="flag-key"
                    className={`w-40 ${compactInput} py-1.5`}
                  />
                  <input
                    value={newFlagDescription}
                    onChange={(e) => setNewFlagDescription(e.target.value)}
                    placeholder="description (optional)"
                    className={`min-w-[12rem] flex-1 ${compactInput} py-1.5`}
                  />
                  <button type="submit" disabled={!newFlagKey.trim()} className={button("primary", "sm")}>
                    Add flag
                  </button>
                </form>
              </div>
            </div>
          </>
        )}
      </section>
    </Layout>
  );
}
