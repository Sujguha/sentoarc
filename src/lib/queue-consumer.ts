import { eq, sql } from "drizzle-orm";
import { createDb, type Db } from "./db/client";
import { job, pkg, packageIssue } from "./db/schema";
import { safeUnzip, ZipSecurityError } from "./scorm/zip-utils";
import { fixPackage, type PackageIssue } from "./scorm/fixer";
import type { Env, ProcessingQueueMessage } from "../types/env";

export async function processPackageMessage(message: ProcessingQueueMessage, env: Env): Promise<void> {
  if (message.type !== "process") {
    // "unpack" (ZIP-of-ZIPs expansion) is a Phase 3 bulk-upload feature.
    return;
  }

  const db = createDb(env.DB);
  const now = () => new Date();

  await db.update(pkg).set({ status: "processing", updatedAt: now() }).where(eq(pkg.id, message.packageId));

  const object = await env.PACKAGES_BUCKET.get(message.r2Key);
  if (!object) {
    await finishPackage(db, message, {
      status: "failed",
      errorMessage: "Uploaded file was not found in storage.",
      issues: [{ severity: "error", code: "UPLOAD_MISSING", message: "Uploaded file was not found in storage.", fixApplied: false }],
      scormVersionIn: null,
      scormVersionOut: null,
      r2KeyFixed: null,
    });
    return;
  }

  const bytes = new Uint8Array(await object.arrayBuffer());

  let unzippedFiles;
  try {
    unzippedFiles = safeUnzip(bytes).files;
  } catch (err) {
    const message_ = err instanceof ZipSecurityError ? err.message : "The uploaded file is not a valid ZIP archive.";
    await finishPackage(db, message, {
      status: "failed",
      errorMessage: message_,
      issues: [{ severity: "error", code: "ZIP_REJECTED", message: message_, fixApplied: false }],
      scormVersionIn: null,
      scormVersionOut: null,
      r2KeyFixed: null,
    });
    return;
  }

  const result = fixPackage(unzippedFiles);

  let r2KeyFixed: string | null = null;
  if (result.fixedZip) {
    r2KeyFixed = message.r2Key.replace(/original\.zip$/, "fixed.zip");
    await env.PACKAGES_BUCKET.put(r2KeyFixed, result.fixedZip);
  }

  await finishPackage(db, message, {
    status: result.status,
    errorMessage: result.status === "failed" ? summarizeErrors(result.issues) : null,
    issues: result.issues,
    scormVersionIn: result.scormVersionIn,
    scormVersionOut: result.scormVersionOut,
    r2KeyFixed,
  });
}

interface FinishArgs {
  status: "pass" | "fixed" | "failed";
  errorMessage: string | null;
  issues: PackageIssue[];
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
