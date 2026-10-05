import { eq, sql } from "drizzle-orm";
import { createDb, type Db } from "./db/client";
import { job, pkg, packageIssue } from "./db/schema";
import { buildZip } from "./scorm/zip-utils";
import { fixPackage, type PackageIssue } from "./scorm/fixer";
import { detectFileType, type DetectedFileType } from "./scorm/detect";
import { wrapAsScorm } from "./scorm/wrapper";
import type { Env, ProcessingQueueMessage } from "../types/env";

const INPUT_FORMAT_BY_DETECTED_TYPE: Record<Exclude<DetectedFileType, "unknown">, "scorm" | "pdf" | "mp4" | "pptx" | "html"> = {
  "scorm-zip": "scorm",
  pdf: "pdf",
  mp4: "mp4",
  pptx: "pptx",
  html: "html",
  "html-zip": "html",
};

function deriveFixedKey(uploadKey: string): string {
  return uploadKey.replace(/\/[^/]+$/, "/fixed.zip");
}

export async function processPackageMessage(message: ProcessingQueueMessage, env: Env): Promise<void> {
  if (message.type !== "process") {
    // "unpack" (ZIP-of-ZIPs expansion) is a Phase 3 bulk-upload feature.
    return;
  }

  const db = createDb(env.DB);
  const now = () => new Date();

  await db.update(pkg).set({ status: "processing", updatedAt: now() }).where(eq(pkg.id, message.packageId));

  const [pkgRow] = await db
    .select({ originalFilename: pkg.originalFilename })
    .from(pkg)
    .where(eq(pkg.id, message.packageId))
    .limit(1);
  const originalFilename = pkgRow?.originalFilename ?? "package";

  const object = await env.PACKAGES_BUCKET.get(message.r2Key);
  if (!object) {
    await finishPackage(db, message, {
      status: "failed",
      errorMessage: "Uploaded file was not found in storage.",
      issues: [{ severity: "error", code: "UPLOAD_MISSING", message: "Uploaded file was not found in storage.", fixApplied: false }],
      inputFormat: null,
      scormVersionIn: null,
      scormVersionOut: null,
      r2KeyFixed: null,
    });
    return;
  }

  const bytes = new Uint8Array(await object.arrayBuffer());
  const detection = detectFileType(bytes);

  if (detection.type === "unknown") {
    const msg = "This file isn't a recognized format (SCORM ZIP, PDF, MP4, PPTX, or HTML) and couldn't be processed.";
    await finishPackage(db, message, {
      status: "failed",
      errorMessage: msg,
      issues: [{ severity: "error", code: "UNSUPPORTED_FILE_TYPE", message: msg, fixApplied: false }],
      inputFormat: null,
      scormVersionIn: null,
      scormVersionOut: null,
      r2KeyFixed: null,
    });
    return;
  }

  const inputFormat = INPUT_FORMAT_BY_DETECTED_TYPE[detection.type];

  if (detection.type === "scorm-zip") {
    const result = fixPackage(detection.files!);

    let r2KeyFixed: string | null = null;
    if (result.fixedZip) {
      r2KeyFixed = deriveFixedKey(message.r2Key);
      await env.PACKAGES_BUCKET.put(r2KeyFixed, result.fixedZip);
    }

    await finishPackage(db, message, {
      status: result.status,
      errorMessage: result.status === "failed" ? summarizeErrors(result.issues) : null,
      issues: result.issues,
      inputFormat,
      scormVersionIn: result.scormVersionIn,
      scormVersionOut: result.scormVersionOut,
      r2KeyFixed,
    });
    return;
  }

  // Non-SCORM input: generate a SCORM 1.2 wrapper around it.
  let wrapped;
  try {
    wrapped = wrapAsScorm(detection.type, bytes, originalFilename, detection.files);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to package this file as SCORM.";
    await finishPackage(db, message, {
      status: "failed",
      errorMessage: msg,
      issues: [{ severity: "error", code: "WRAP_FAILED", message: msg, fixApplied: false }],
      inputFormat,
      scormVersionIn: null,
      scormVersionOut: null,
      r2KeyFixed: null,
    });
    return;
  }

  const fixedZip = buildZip(wrapped.files);
  const r2KeyFixed = deriveFixedKey(message.r2Key);
  await env.PACKAGES_BUCKET.put(r2KeyFixed, fixedZip);

  await finishPackage(db, message, {
    status: "fixed",
    errorMessage: null,
    issues: [
      {
        severity: "info",
        code: "WRAPPED_AS_SCORM",
        message: `This file wasn't a SCORM package (detected as ${inputFormat.toUpperCase()}); a SCORM 1.2 wrapper was generated around it.`,
        fixApplied: true,
      },
    ],
    inputFormat,
    scormVersionIn: null,
    scormVersionOut: "1.2",
    r2KeyFixed,
  });
}

interface FinishArgs {
  status: "pass" | "fixed" | "failed";
  errorMessage: string | null;
  issues: PackageIssue[];
  inputFormat: "scorm" | "pdf" | "mp4" | "pptx" | "html" | null;
  scormVersionIn: string | null;
  scormVersionOut: string | null;
  r2KeyFixed: string | null;
}

async function finishPackage(db: Db, message: Extract<ProcessingQueueMessage, { type: "process" }>, args: FinishArgs) {
  const now = new Date();

  await db
    .update(pkg)
    .set({
      status: args.status,
      r2KeyFixed: args.r2KeyFixed,
      inputFormat: args.inputFormat,
      scormVersionIn: args.scormVersionIn,
      scormVersionOut: args.scormVersionOut,
      errorMessage: args.errorMessage,
      updatedAt: now,
    })
    .where(eq(pkg.id, message.packageId));

  if (args.issues.length > 0) {
    await db.insert(packageIssue).values(
      args.issues.map((issue) => ({
        id: crypto.randomUUID(),
        packageId: message.packageId,
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        fixApplied: issue.fixApplied,
        createdAt: now,
      }))
    );
  }

  await updateJobCounters(db, message.jobId, args.status);
}

async function updateJobCounters(db: Db, jobId: string, packageStatus: "pass" | "fixed" | "failed") {
  const now = new Date();

  if (packageStatus === "failed") {
    await db.update(job).set({ failedPackages: sql`${job.failedPackages} + 1`, updatedAt: now }).where(eq(job.id, jobId));
  } else {
    await db
      .update(job)
      .set({ completedPackages: sql`${job.completedPackages} + 1`, updatedAt: now })
      .where(eq(job.id, jobId));
  }

  const [row] = await db
    .select({ total: job.totalPackages, completed: job.completedPackages, failed: job.failedPackages })
    .from(job)
    .where(eq(job.id, jobId))
    .limit(1);

  if (row && row.completed + row.failed >= row.total) {
    const finalStatus = row.failed === 0 ? "completed" : row.completed === 0 ? "failed" : "completed_with_errors";
    await db.update(job).set({ status: finalStatus, updatedAt: new Date() }).where(eq(job.id, jobId));
  }
}

function summarizeErrors(issues: PackageIssue[]): string {
  return issues
    .filter((i) => i.severity === "error")
    .map((i) => i.message)
    .join(" ");
}
