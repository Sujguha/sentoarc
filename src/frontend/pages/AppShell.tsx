import { useEffect, useRef, useState } from "react";
import { Layout } from "../components/Layout";

interface JobSummary {
  id: string;
  status: string;
  totalPackages: number;
  completedPackages: number;
  failedPackages: number;
  createdAt: string;
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

const ERROR_MESSAGES: Record<string, string> = {
  filename_must_be_zip: "Please choose a .zip file.",
  free_limit_reached: "You've used all of your free uploads. Upgrade to Pro for unlimited uploads.",
  package_too_large: "That file is too large for the current plan limit.",
  size_bytes_required: "Couldn't read the file size — please try again.",
  already_uploaded: "This upload has already been submitted.",
  empty_upload: "The file appears to be empty.",
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file name after an error
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".zip")) {
      setUploadError("Please choose a .zip file.");
      return;
    }

    setSelectedFile(file);
    setUploadError(null);
    setUploading(true);
    setJobDetail(null);

    try {
      const initRes = await fetch("/api/uploads/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, sizeBytes: file.size }),
      });
      const initBody = (await initRes.json()) as { error?: string; jobId?: string; uploadUrl?: string };
      if (!initRes.ok || !initBody.uploadUrl || !initBody.jobId) {
        setUploadError(friendlyError(initBody.error));
        setUploading(false);
        return;
      }

      const uploadRes = await fetch(initBody.uploadUrl, { method: "PUT", body: file });
      const uploadBody = (await uploadRes.json()) as { error?: string };
      if (!uploadRes.ok) {
        setUploadError(friendlyError(uploadBody.error));
        setUploading(false);
        return;
      }

      setActiveJobId(initBody.jobId);
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
          Upload the SCORM ZIP that SAP Enable Now exported. We'll validate it, fix what we safely can, and give you
          back a package ready for WalkMe Learning Arc.
        </p>

        <div className="mt-6 rounded-lg border-2 border-dashed border-slate-300 p-8 text-center">
          <input id="file-input" type="file" accept=".zip" className="hidden" onChange={handleFileChange} disabled={uploading} />
          <label
            htmlFor="file-input"
            className="inline-block cursor-pointer rounded-md bg-slate-900 px-5 py-2.5 text-white disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Choose a SCORM ZIP"}
          </label>
          {selectedFile && !uploadError && (
            <p className="mt-3 text-sm text-slate-500">{selectedFile.name}</p>
          )}
          {uploadError && <p className="mt-3 text-sm text-red-600">{uploadError}</p>}
        </div>

        {jobDetail && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">Migration report</h2>
            <div className="mt-3 space-y-4">
              {jobDetail.packages.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{p.originalFilename}</span>
                    <StatusBadge status={p.status === "pending" || p.status === "queued" ? jobDetail.job.status : p.status} />
                  </div>
                  {p.scormVersionIn && (
                    <p className="mt-1 text-xs text-slate-500">
                      SCORM {p.scormVersionIn}
                      {p.scormVersionOut && p.scormVersionOut !== p.scormVersionIn ? ` → ${p.scormVersionOut}` : ""}
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
                    <a
                      href={`/api/jobs/${jobDetail.job.id}/download/${p.id}`}
                      className="mt-3 inline-block rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white"
                    >
                      Download fixed ZIP
                    </a>
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
                <li key={j.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-slate-600">{new Date(j.createdAt).toLocaleString()}</span>
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
