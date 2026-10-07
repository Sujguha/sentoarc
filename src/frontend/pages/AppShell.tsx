import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Layout } from "../components/Layout";
import { button } from "../lib/ui";

interface ActiveWorkspace {
  id: string;
  name: string;
  role: "admin" | "editor" | "viewer";
}

interface JobSummary {
  id: string;
  status: string;
  totalPackages: number;
  completedPackages: number;
  failedPackages: number;
  createdAt: string;
  filenames: string[];
}

function jobDisplayName(filenames: string[], t: TFunction): string {
  if (filenames.length === 0) return "—";
  if (filenames.length === 1) return filenames[0]!;
  return `${filenames[0]} ${t("appShell.plusMoreFiles", { count: filenames.length - 1 })}`;
}

interface PackageIssue {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  fixApplied: boolean;
}

interface PackageDetail {
  id: string;
  originalFilename: string;
  status: string;
  inputFormat:
    | "scorm"
    | "pdf"
    | "mp4"
    | "webm"
    | "mov"
    | "pptx"
    | "ppt"
    | "docx"
    | "doc"
    | "html"
    | "mp3"
    | "wav"
    | "png"
    | "jpg"
    | "gif"
    | "svg"
    | null;
  scormVersionIn: string | null;
  scormVersionOut: string | null;
  errorMessage: string | null;
  issues: PackageIssue[];
}

interface JobDetail {
  job: JobSummary;
  packages: PackageDetail[];
}

const TERMINAL_JOB_STATUSES = new Set(["completed", "completed_with_errors", "failed"]);

const ALLOWED_EXTENSIONS = [
  ".zip",
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".html",
  ".htm",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".gif",
];

// We don't have a confirmed Learning Arc API (see CHANGELOG) — this opens
// WalkMe's own app so the user can drag the downloaded file in themselves.
// Deep-links straight to Assets > SCORM Packages (confirmed from a real
// account), where "+ Learning Asset" opens the Import SCORM package
// dialog. That dialog is pure client-side state -- the URL bar doesn't
// change when it opens -- so this is as close as a link alone can get;
// the one remaining step is clicking the import button themselves.
const WALKME_LEARNING_ARC_URL = "https://app.learningarc.com/management/assets";

// Prefers the server's own message (e.g. insufficient_balance includes
// the exact cost/balance figures) over the translated static map, which
// exists for error codes that never carry one. The server's own message
// is always English (it's not user-facing copy the server localizes),
// so this is a known gap for non-English users on those specific codes.
function friendlyError(body: { error?: string; message?: string } | undefined, t: TFunction): string {
  if (body?.message) return body.message;
  return (body?.error && t(`appShell.errors.${body.error}`, { defaultValue: "" })) || t("appShell.errors.generic");
}

const STATUS_STYLES: Record<string, string> = {
  pass: "bg-green-100 text-green-800",
  fixed: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
  pending: "bg-slate-100 text-slate-600",
  queued: "bg-slate-100 text-slate-600",
  processing: "bg-blue-100 text-blue-800",
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {t(`appShell.statusLabels.${status}`, { defaultValue: status.replace(/_/g, " ") })}
    </span>
  );
}

export default function AppShell() {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileCount, setSelectedFileCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const [tier, setTier] = useState<"free" | "pro" | "enterprise" | "metered">("free");
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [workspace, setWorkspace] = useState<ActiveWorkspace | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isProOrEnterprise = tier === "pro" || tier === "enterprise" || tier === "metered";
  const isViewer = workspace?.role === "viewer";

  const INPUT_FORMAT_LABELS: Record<string, string> = {
    scorm: t("appShell.inputFormatLabels.scorm"),
    pdf: t("appShell.inputFormatLabels.pdf"),
    mp4: t("appShell.inputFormatLabels.mp4"),
    webm: t("appShell.inputFormatLabels.mp4"),
    mov: t("appShell.inputFormatLabels.mp4"),
    pptx: t("appShell.inputFormatLabels.pptx"),
    ppt: t("appShell.inputFormatLabels.pptx"),
    docx: t("appShell.inputFormatLabels.docx"),
    doc: t("appShell.inputFormatLabels.docx"),
    html: t("appShell.inputFormatLabels.html"),
    mp3: t("appShell.inputFormatLabels.mp3"),
    wav: t("appShell.inputFormatLabels.mp3"),
    png: t("appShell.inputFormatLabels.png"),
    jpg: t("appShell.inputFormatLabels.png"),
    gif: t("appShell.inputFormatLabels.png"),
    svg: t("appShell.inputFormatLabels.png"),
  };

  function loadUsage() {
    fetch("/api/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const usage = data as { tier: typeof tier; balanceCents: number | null };
        setTier(usage.tier);
        setBalanceCents(usage.balanceCents);
      })
      .catch(() => {});
  }

  useEffect(() => {
    loadUsage();
    fetch("/api/organizations/active")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setWorkspace((data as { active: ActiveWorkspace | null } | null)?.active ?? null))
      .catch(() => {});
  }, []);

  function loadRecentJobs() {
    fetch("/api/jobs")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setRecentJobs((data as { jobs: JobSummary[] }).jobs))
      .catch(() => {});
  }

  useEffect(() => {
    loadRecentJobs();
  }, []);

  useEffect(() => {
    if (!activeJobId) return;

    async function poll() {
      const res = await fetch(`/api/jobs/${activeJobId}`);
      if (!res.ok) return;
      const data: JobDetail = await res.json();
      setJobDetail(data);
      if (TERMINAL_JOB_STATUSES.has(data.job.status) && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        loadRecentJobs();
        loadUsage();
      }
    }

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeJobId]);

  async function uploadSingle(file: File) {
    const initRes = await fetch("/api/uploads/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, sizeBytes: file.size }),
    });
    const initBody = (await initRes.json()) as { error?: string; message?: string; jobId?: string; uploadUrl?: string };
    if (!initRes.ok || !initBody.uploadUrl || !initBody.jobId) {
      setUploadError(friendlyError(initBody, t));
      return;
    }

    const uploadRes = await fetch(initBody.uploadUrl, { method: "PUT", body: file });
    const uploadBody = (await uploadRes.json()) as { error?: string; message?: string };
    if (!uploadRes.ok) {
      setUploadError(friendlyError(uploadBody, t));
      return;
    }

    setActiveJobId(initBody.jobId);
  }

  async function uploadBulk(files: File[]) {
    const initRes = await fetch("/api/uploads/bulk/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: files.map((f) => ({ filename: f.name, sizeBytes: f.size })) }),
    });
    const initBody = (await initRes.json()) as {
      error?: string;
      message?: string;
      jobId?: string;
      packages?: { packageId: string; filename: string; uploadUrl: string }[];
    };
    if (!initRes.ok || !initBody.jobId || !initBody.packages) {
      setUploadError(friendlyError(initBody, t));
      return;
    }

    setActiveJobId(initBody.jobId);

    await Promise.all(
      initBody.packages.map(async (p, i) => {
        const res = await fetch(p.uploadUrl, { method: "PUT", body: files[i] });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
          setUploadError(friendlyError(body, t));
        }
      })
    );
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file name after an error
    if (files.length === 0) return;

    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        setUploadError(t("appShell.errors.unsupported_file_type"));
        return;
      }
    }

    setSelectedFile(files[0] ?? null);
    setSelectedFileCount(files.length);
    setUploadError(null);
    setUploading(true);
    setJobDetail(null);

    try {
      if (files.length === 1) {
        await uploadSingle(files[0]!);
      } else {
        await uploadBulk(files);
      }
      loadUsage();
    } catch {
      setUploadError(t("appShell.errors.connection"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Layout>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">{t("appShell.title")}</h1>
        <p className="mt-2 text-slate-600">{t("appShell.intro")}</p>

        {workspace && (
          <p className="mt-3 text-sm text-slate-500">
            {t("appShell.uploadingAsPrefix")} <strong className="text-slate-700">{workspace.name}</strong>{" "}
            {t("appShell.uploadingAsSuffix", { role: workspace.role })}{" "}
            <Link to="/organization" className="text-indigo-700 underline transition-colors hover:text-indigo-900">
              {t("appShell.switchWorkspace")}
            </Link>
          </p>
        )}

        {tier === "metered" && balanceCents !== null && (
          <p className="mt-3 text-sm text-slate-600">
            {t("appShell.balance", { amount: `€${(balanceCents / 100).toFixed(2)}` })}{" "}
            <Link to="/account" className="text-indigo-700 underline transition-colors hover:text-indigo-900">
              {t("appShell.topUp")}
            </Link>
          </p>
        )}

        <div className="mt-6 rounded-xl border-2 border-dashed border-slate-300 p-8 text-center transition-colors hover:border-slate-400">
          {isViewer ? (
            <p className="text-sm text-slate-500">
              {t("appShell.viewerNotice")}{" "}
              <Link to="/organization" className="text-indigo-700 underline transition-colors hover:text-indigo-900">
                {t("appShell.switchToPersonal")}
              </Link>{" "}
              {t("appShell.toUploadOwnPackages")}
            </p>
          ) : (
            <>
              <input
                id="file-input"
                type="file"
                accept={ALLOWED_EXTENSIONS.join(",")}
                multiple={isProOrEnterprise}
                className="hidden"
                onChange={handleFileChange}
                disabled={uploading}
              />
              <label htmlFor="file-input" className={`cursor-pointer ${button("primary", "lg")}`}>
                {uploading ? t("appShell.uploading") : isProOrEnterprise ? t("appShell.chooseFiles") : t("appShell.chooseFile")}
              </label>
            </>
          )}
          {!isViewer && (
            <p className="mt-2 text-xs text-slate-400">
              {t("appShell.acceptedTypes")}
              {isProOrEnterprise ? t("appShell.hintBulk") : t("appShell.hintSingle")}
            </p>
          )}
          {selectedFile && !uploadError && (
            <p className="mt-3 text-sm text-slate-500">
              {selectedFileCount > 1 ? t("appShell.filesSelected", { count: selectedFileCount }) : selectedFile.name}
            </p>
          )}
          {uploadError && <p className="mt-3 text-sm text-red-600">{uploadError}</p>}
        </div>

        {jobDetail && (
          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">{t("appShell.migrationReport")}</h2>
              {isProOrEnterprise && (
                <a
                  href={`/api/jobs/${jobDetail.job.id}/export.csv`}
                  className="text-sm font-medium text-indigo-700 transition-colors hover:text-indigo-900 hover:underline"
                >
                  {t("appShell.exportCsv")}
                </a>
              )}
            </div>
            <div className="mt-3 space-y-4">
              {jobDetail.packages.map((p) => (
                <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{p.originalFilename}</span>
                    <StatusBadge status={p.status === "pending" || p.status === "queued" ? jobDetail.job.status : p.status} />
                  </div>
                  {p.inputFormat && (
                    <p className="mt-1 text-xs text-slate-500">
                      {p.inputFormat === "scorm" ? (
                        <>
                          SCORM {p.scormVersionIn}
                          {p.scormVersionOut && p.scormVersionOut !== p.scormVersionIn ? ` → ${p.scormVersionOut}` : ""}
                        </>
                      ) : (
                        <>
                          {INPUT_FORMAT_LABELS[p.inputFormat] ?? p.inputFormat} → packaged as SCORM {p.scormVersionOut}
                        </>
                      )}
                    </p>
                  )}
                  {p.issues.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm">
                      {p.issues.map((issue, i) => (
                        <li key={i} className="flex gap-2">
                          <span
                            className={
                              issue.severity === "error"
                                ? "text-red-600"
                                : issue.severity === "warning"
                                  ? "text-amber-600"
                                  : "text-slate-500"
                            }
                          >
                            {issue.severity === "error" ? "✕" : issue.fixApplied ? "✓" : "•"}
                          </span>
                          <span className="text-slate-600">{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(p.status === "pass" || p.status === "fixed") && (
                    <div className="mt-3 flex items-center gap-2">
                      <a href={`/api/jobs/${jobDetail.job.id}/download/${p.id}`} className={button("primary", "sm")}>
                        {t("appShell.downloadPackage")}
                      </a>
                      <a
                        href={WALKME_LEARNING_ARC_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 shadow-sm transition-colors hover:bg-indigo-50"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <path d="M15 3h6v6" />
                          <path d="M10 14 21 3" />
                        </svg>
                        {t("appShell.openInWalkMe")}
                      </a>
                    </div>
                  )}
                </div>
              ))}
              {!TERMINAL_JOB_STATUSES.has(jobDetail.job.status) && (
                <p className="text-sm text-slate-500">{t("appShell.processing")}</p>
              )}
            </div>
          </div>
        )}

        {recentJobs.length > 0 && (
          <div className="mt-12">
            <h2 className="text-lg font-semibold text-slate-900">{t("appShell.recentUploads")}</h2>
            <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-sm">
              {recentJobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{jobDisplayName(j.filenames, t)}</p>
                    <p className="text-slate-500">{new Date(j.createdAt).toLocaleString()}</p>
                  </div>
                  <StatusBadge status={j.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </Layout>
  );
}
