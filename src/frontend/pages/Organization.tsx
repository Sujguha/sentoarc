import { useEffect, useState, useCallback } from "react";
import { Layout } from "../components/Layout";
import { authClient } from "../lib/auth-client";
import { button, card } from "../lib/ui";

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
}

interface MemberRow {
  id: string;
  userId: string;
  role: "admin" | "editor" | "viewer";
  user?: { email?: string; name?: string };
}

interface AuditEntry {
  id: string;
  action: string;
  actorUserId: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || crypto.randomUUID().slice(0, 8)
  );
}

export default function Organization() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<"admin" | "editor" | "viewer" | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [newOrgName, setNewOrgName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enterprise (creating a new org) is sales-assisted, not self-serve --
  // only the founder can actually create one (see
  // allowUserToCreateOrganization in auth/index.ts). /api/admin/ping is
  // an existing founder-only probe we reuse here rather than adding a
  // new endpoint just to expose this one boolean.
  const [isFounder, setIsFounder] = useState(false);

  const loadOrgs = useCallback(async () => {
    const { data } = await authClient.organization.list();
    setOrgs((data as OrgSummary[] | null) ?? []);
  }, []);

  const loadActive = useCallback(async () => {
    const res = await fetch("/api/organizations/active");
    const body = (await res.json()) as { active: { id: string; name: string; role: "admin" | "editor" | "viewer" } | null };
    setActiveOrgId(body.active?.id ?? null);
    setActiveRole(body.active?.role ?? null);
  }, []);

  const loadMembers = useCallback(async (orgId: string) => {
    const { data } = await authClient.organization.listMembers({ query: { organizationId: orgId } });
    setMembers(((data as { members?: MemberRow[] } | null)?.members ?? []) as MemberRow[]);
  }, []);

  const loadAuditLog = useCallback(async (orgId: string) => {
    const res = await fetch(`/api/organizations/${orgId}/audit-log`);
    if (!res.ok) {
      setAuditEntries([]);
      return;
    }
    const body = (await res.json()) as { entries: AuditEntry[] };
    setAuditEntries(body.entries);
  }, []);

  useEffect(() => {
    loadOrgs();
    loadActive();
    fetch("/api/admin/ping")
      .then((res) => setIsFounder(res.ok))
      .catch(() => setIsFounder(false));
  }, [loadOrgs, loadActive]);

  useEffect(() => {
    if (!activeOrgId) {
      setMembers([]);
      setAuditEntries([]);
      return;
    }
    loadMembers(activeOrgId);
    if (activeRole === "admin") loadAuditLog(activeOrgId);
  }, [activeOrgId, activeRole, loadMembers, loadAuditLog]);

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.organization.create({ name: newOrgName.trim(), slug: slugify(newOrgName) });
    if (err) {
      setError(err.message ?? "Couldn't create the organization.");
      setBusy(false);
      return;
    }
    setNewOrgName("");
    await loadOrgs();
    await loadActive();
    setBusy(false);
  }

  async function switchTo(orgId: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.organization.setActive({ organizationId: orgId });
    if (err) {
      setError(err.message ?? "Couldn't switch workspace.");
    } else {
      await loadActive();
    }
    setBusy(false);
  }

  async function leaveWorkspace() {
    setBusy(true);
    setError(null);
    await authClient.organization.setActive({ organizationId: null });
    await loadActive();
    setBusy(false);
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrgId || !inviteEmail.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.organization.inviteMember({
      email: inviteEmail.trim(),
      role: inviteRole,
      organizationId: activeOrgId,
    });
    if (err) {
      setError(err.message ?? "Couldn't send the invitation.");
    } else {
      setInviteEmail("");
      if (activeRole === "admin") await loadAuditLog(activeOrgId);
    }
    setBusy(false);
  }

  async function changeRole(memberId: string, role: "admin" | "editor" | "viewer") {
    if (!activeOrgId) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.organization.updateMemberRole({ memberId, role, organizationId: activeOrgId });
    if (err) {
      setError(err.message ?? "Couldn't update that member's role.");
    } else {
      await loadMembers(activeOrgId);
      await loadAuditLog(activeOrgId);
    }
    setBusy(false);
  }

  async function removeMember(memberIdOrEmail: string) {
    if (!activeOrgId) return;
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.organization.removeMember({ memberIdOrEmail, organizationId: activeOrgId });
    if (err) {
      setError(err.message ?? "Couldn't remove that member.");
    } else {
      await loadMembers(activeOrgId);
      await loadAuditLog(activeOrgId);
    }
    setBusy(false);
  }

  const activeOrg = orgs.find((o) => o.id === activeOrgId);

  return (
    <Layout>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">Organization</h1>
        <p className="mt-2 text-slate-600">
          Enterprise workspaces: invite teammates, share migration projects, and track who did what.
        </p>

        {error && <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

        <div className={`mt-8 ${card()}`}>
          <h2 className="font-medium text-slate-900">Your workspaces</h2>
          {orgs.length === 0 && <p className="mt-2 text-sm text-slate-500">You're not part of any organization yet.</p>}
          <ul className="mt-3 space-y-2">
            {orgs.map((org) => (
              <li
                key={org.id}
                className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm transition-colors hover:bg-slate-50"
              >
                <span className={org.id === activeOrgId ? "font-medium text-slate-900" : "text-slate-600"}>
                  {org.name} {org.id === activeOrgId && <span className="text-xs text-indigo-600">(active)</span>}
                </span>
                {org.id !== activeOrgId && (
                  <button
                    onClick={() => switchTo(org.id)}
                    disabled={busy}
                    className="text-xs font-medium text-indigo-700 transition-colors hover:text-indigo-900 disabled:opacity-50"
                  >
                    Switch to this workspace
                  </button>
                )}
              </li>
            ))}
          </ul>
          {activeOrgId && (
            <button
              onClick={leaveWorkspace}
              disabled={busy}
              className="mt-3 text-xs text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-50"
            >
              Go back to your personal workspace
            </button>
          )}

          {isFounder ? (
            <form onSubmit={createOrg} className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
              <input
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="New organization name"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
              <button type="submit" disabled={busy || !newOrgName.trim()} className={button("primary", "sm")}>
                Create
              </button>
            </form>
          ) : (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-600">
                Organizations are part of the Enterprise plan, set up with our team rather than self-serve.{" "}
                <a href="/#contact" className="font-medium text-indigo-700 transition-colors hover:text-indigo-900">
                  Contact sales
                </a>{" "}
                to get a workspace set up for your team.
              </p>
            </div>
          )}
        </div>

        {activeOrg && (
          <div className={`mt-6 ${card()}`}>
            <h2 className="font-medium text-slate-900">Members of {activeOrg.name}</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-700">{m.user?.email ?? m.userId}</span>
                  <div className="flex items-center gap-2">
                    {activeRole === "admin" ? (
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.id, e.target.value as "admin" | "editor" | "viewer")}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                      >
                        <option value="admin">Admin</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <span className="capitalize text-slate-500">{m.role}</span>
                    )}
                    {activeRole === "admin" && (
                      <button
                        onClick={() => removeMember(m.id)}
                        disabled={busy}
                        className="text-xs text-red-600 transition-colors hover:text-red-800 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {activeRole === "admin" && (
              <form onSubmit={invite} className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "editor" | "viewer")}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                >
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button type="submit" disabled={busy || !inviteEmail.trim()} className={button("primary", "sm")}>
                  Invite
                </button>
              </form>
            )}
          </div>
        )}

        {activeOrg && activeRole === "admin" && (
          <div className={`mt-6 ${card()}`}>
            <h2 className="font-medium text-slate-900">Audit log</h2>
            {auditEntries.length === 0 && <p className="mt-2 text-sm text-slate-500">No activity recorded yet.</p>}
            <ul className="mt-3 space-y-2 text-sm">
              {auditEntries.map((entry) => (
                <li key={entry.id} className="text-slate-600">
                  <span className="text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span> — {entry.action}
                  {entry.targetType ? ` (${entry.targetType})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </Layout>
  );
}
