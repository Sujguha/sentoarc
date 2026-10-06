import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";

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

function jobDisplayName(filenames: string[]): string {
  if (filenames.length === 0) return "—";
  if (filenames.length === 1) return filenames[0]!;
  return `${filenames[0]} + ${filenames.length - 1} more`;
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
  inputFormat: "scorm" | "pdf" | "mp4" | "pptx" | "html" | null;
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

const ALLOWED_EXTENSIONS = [".zip", ".pdf", ".mp4", ".pptx", ".html", ".htm"];

const ERROR_MESSAGES: Record<string, string> = {
  unsupported_file_type: "Please choose a SCORM ZIP, PDF, MP4, PPTX, or HTML file.",
  free_limit_reached: "You've used all of your free uploads. Upgrade to Pro for unlimited uploads.",
  package_too_large: "That file is too large for the current plan limit.",
  size_bytes_required: "Couldn't read the file size — please try again.",
  already_uploaded: "This upload has already been submitted.",
  empty_upload: "The file appears to be empty.",
  files_required: "Please choose at least one file.",
  too_many_files: "Too many files in one bulk upload — please split into smaller batches.",
  plan_upgrade_required: "Bulk upload (multiple files at once) requires a Pro plan.",
};

// We don't have a confirmed Learning Arc API (see CHANGELOG) — this opens
// WalkMe's own app so the user can drag the downloaded file in themselves.
// Deep-links straight to Assets > SCORM Packages (confirmed from a real
// account), where "+ Learning Asset" opens the Import SCORM package
// dialog. That dialog is pure client-side state -- the URL bar doesn't
// change when it opens -- so this is as close as a link alone can get;
// the one remaining step is clicking the import button themselves.
const WALKME_LEARNING_ARC_URL = "https://app.learningarc.com/management/assets";

const INPUT_FORMAT_LABELS: Record<string, string> = {
  scorm: "SCORM",
  pdf: "PDF",
  mp4: "Video",
  pptx: "PowerPoint",
  html: "HTML",
};

function friendlyError(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code]) ?? "Something went wrong — please try again.";
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
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function AppShell() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileCount, setSelectedFileCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const [tier, setTier] = useState<"free" | "pro" | "enterprise" | "metered">("free");
  const [workspace, setWorkspace] = useState<ActiveWorkspace | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isProOrEnterprise = tier === "pro" || tier === "enterprise" || tier === "metered";
  const isViewer = workspace?.role === "viewer";

  useEffect(() => {
    fetch("/api/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setTier((data as { tier: typeof tier }).tier))
      .catch(() => {});
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
    const initBody = (await initRes.json()) as { error?: string; jobId?: string; uploadUrl?: string };
    if (!initRes.ok || !initBody.uploadUrl || !initBody.jobId) {
      setUploadError(friendlyError(initBody.error));
      return;
    }

    const uploadRes = await fetch(initBody.uploadUrl, { method: "PUT", body: file });
    const uploadBody = (await uploadRes.json()) as { error?: string };
    if (!uploadRes.ok) {
      setUploadError(friendlyError(uploadBody.error));
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
      jobId?: string;
      packages?: { packageId: string; filename: string; uploadUrl: string }[];
    };
    if (!initRes.ok || !initBody.jobId || !initBody.packages) {
      setUploadError(friendlyError(initBody.error));
      return;
    }

    setActiveJobId(initBody.jobId);

    await Promise.all(
      initBody.packages.map(async (p, i) => {
        const res = await fetch(p.uploadUrl, { method: "PUT", body: files[i] });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setUploadError(friendlyError(body.error));
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
        setUploadError(ERROR_MESSAGES.unsupported_file_type!);
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
    } catch {
      setUploadError("Upload failed — please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Layout>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-bold text-slate-900">Upload a package</h1>
        <p className="mt-2 text-slate-600">
          Already have a SCORM ZIP from SAP Enable Now? We'll validate it and fix what we safely can. Have a PDF,
          video, slide deck, or web page instead? We'll package it into a SCORM 1.2 course ready for WalkMe
          Learning Arc.
        </p>

        {workspace && (
          <p className="mt-3 text-sm text-slate-500">
            Uploading as <strong className="text-slate-700">{workspace.name}</strong> ({workspace.role}) — shared
            with your team.{" "}
            <Link to="/organization" className="text-indigo-700 underline">
              Switch workspace
            </Link>
          </p>
        )}

        <div className="mt-6 rounded-lg border-2 border-dashed border-slate-300 p-8 text-center">
          {isViewer ? (
            <p className="text-sm text-slate-500">
              Viewers can see this team's uploads but can't add new ones.{" "}
              <Link to="/organization" className="text-indigo-700 underline">
                Switch to your personal workspace
              </Link>{" "}
              to upload your own packages.
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
              <label
                htmlFor="file-input"
                className="inline-block cursor-pointer rounded-md bg-slate-900 px-5 py-2.5 text-white disabled:opacity-50"
              >
                {uploading ? "Uploading…" : isProOrEnterprise ? "Choose file(s)" : "Choose a file"}
              </label>
            </>
          )}
          {!isViewer && (
            <p className="mt-2 text-xs text-slate-400">
              SCORM ZIP, PDF, MP4, PPTX, or HTML
              {isProOrEnterprise
                ? " — select multiple files, or a single ZIP containing several SCORM package ZIPs, to process them as one batch."
                : ". Upgrade to Pro to upload multiple packages at once."}
            </p>
          )}
          {selectedFile && !uploadError && (
            <p className="mt-3 text-sm text-slate-500">
              {selectedFileCount > 1 ? `${selectedFileCount} files selected` : selectedFile.name}
            </p>
          )}
          {uploadError && <p className="mt-3 text-sm text-red-600">{uploadError}</p>}
        </div>

        {jobDetail && (
          <div className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Migration report</h2>
              {isProOrEnterprise && (
                <a
                  href={`/api/jobs/${jobDetail.job.id}/export.csv`}
                  className="text-sm font-medium text-indigo-700 hover:underline"
                >
                  Export CSV
                </a>
              )}
            </div>
            <div className="mt-3 space-y-4">
              {jobDetail.packages.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-4">
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
                      <a
                        href={`/api/jobs/${jobDetail.job.id}/download/${p.id}`}
                        className="inline-block rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white"
                      >
                        Download SCORM package
                      </a>
                      <a
                        href={WALKME_LEARNING_ARC_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-white px-4 py-1.5 text-sm font-medium text-indigo-700"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <path d="M15 3h6v6" />
                          <path d="M10 14 21 3" />
                        </svg>
                        Open Import SCORM in WalkMe
                      </a>
                    </div>
                  )}
                </div>
              ))}
              {!TERMINAL_JOB_STATUSES.has(jobDetail.job.status) && (
                <p className="text-sm text-slate-500">Processing…</p>
              )}
            </div>
          </div>
        )}

        {recentJobs.length > 0 && (
          <div className="mt-12">
            <h2 className="text-lg font-semibold text-slate-900">Recent uploads</h2>
            <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200">
              {recentJobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{jobDisplayName(j.filenames)}</p>
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
