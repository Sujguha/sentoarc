import { eq, sql } from "drizzle-orm";
import { createDb, type Db } from "./db/client";
import { job, pkg, packageIssue } from "./db/schema";
import { buildZip, decompressSingleEntry } from "./scorm/zip-utils";
import { fixPackage, type PackageIssue } from "./scorm/fixer";
import { detectFileType, type DetectedFileType } from "./scorm/detect";
import { wrapAsScorm } from "./scorm/wrapper";
import { resolvePlanTierFor } from "../middleware/require-plan";
import type { Env, ProcessingQueueMessage } from "../types/env";

const INPUT_FORMAT_BY_DETECTED_TYPE: Record<
  Exclude<DetectedFileType, "unknown" | "zip-of-zips">,
  "scorm" | "pdf" | "mp4" | "pptx" | "html"
> = {
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

// R2's single-shot put() needs a value of known length for a stream
// body (workerd rejects a plain hand-rolled ReadableStream like
// buildFixedZipStream's output with "must have a known length") --
// multipart upload is the actual supported path for streaming data
// whose total size isn't known ahead of time. Buffers into >= 5MiB
// parts (R2's multipart minimum for every part but the last) so memory
// stays bounded regardless of how large the rebuilt package is.
const MULTIPART_PART_SIZE = 5 * 1024 * 1024;

async function putFixedZip(bucket: R2Bucket, key: string, data: Uint8Array | ReadableStream<Uint8Array>): Promise<void> {
  if (data instanceof Uint8Array) {
    await bucket.put(key, data);
    return;
  }

  const upload = await bucket.createMultipartUpload(key);
  const parts: R2UploadedPart[] = [];

  async function uploadBuffered(chunks: Uint8Array[], size: number): Promise<void> {
    const combined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    parts.push(await upload.uploadPart(parts.length + 1, combined));
  }

  try {
    const reader = data.getReader();
    let buffer: Uint8Array[] = [];
    let bufferedBytes = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (value && value.length > 0) {
        buffer.push(value);
        bufferedBytes += value.length;
      }
      if (!done && bufferedBytes >= MULTIPART_PART_SIZE) {
        await uploadBuffered(buffer, bufferedBytes);
        buffer = [];
        bufferedBytes = 0;
      }
      if (done) {
        // Flush whatever's left as the final part -- always, even if
        // empty, when no part has been uploaded yet (complete() needs
        // at least one part).
        if (bufferedBytes > 0 || parts.length === 0) {
          await uploadBuffered(buffer, bufferedBytes);
        }
        break;
      }
    }

    await upload.complete(parts);
  } catch (err) {
    await upload.abort().catch(() => {});
    throw err;
  }
}

export async function processPackageMessage(message: ProcessingQueueMessage, env: Env): Promise<void> {
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

  if (detection.type === "zip-of-zips") {
    await expandZipOfZips(db, env, message, bytes, detection.names!);
    return;
  }

  const inputFormat = INPUT_FORMAT_BY_DETECTED_TYPE[detection.type];

  if (detection.type === "scorm-zip") {
    const tier = await resolveOwnerTier(db, message.jobId);
    const result = fixPackage(bytes, detection.names!, {
      // Pro/Enterprise/metered only -- see ValidatePackageOptions.
      checkTranslationPaths: tier === "pro" || tier === "enterprise" || tier === "metered",
    });

    let r2KeyFixed: string | null = null;
    if (result.fixedZip) {
      r2KeyFixed = deriveFixedKey(message.r2Key);
      await putFixedZip(env.PACKAGES_BUCKET, r2KeyFixed, result.fixedZip);
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

async function resolveOwnerTier(db: Db, jobId: string): Promise<"free" | "pro" | "enterprise" | "metered"> {
  const [jobRow] = await db
    .select({ ownerType: job.ownerType, ownerId: job.ownerId })
    .from(job)
    .where(eq(job.id, jobId))
    .limit(1);
  if (!jobRow) return "free";
  return (await resolvePlanTierFor(db, jobRow.ownerType as "user" | "org", jobRow.ownerId)).tier;
}

// A "bulk" upload: the container itself isn't a package, its entries are.
// Pro/Enterprise only -- Free stays "single packages only" per the
// pricing page. Each inner .zip is extracted (not re-compressed; its
// bytes already are a complete, valid .zip) into its own package row
// under the same job and re-enqueued through the normal "process" path,
// then the container row is replaced by however many packages were
// actually found -- it was never itself a real deliverable.
async function expandZipOfZips(
  db: Db,
  env: Env,
  message: Extract<ProcessingQueueMessage, { type: "process" }>,
  bytes: Uint8Array,
  innerNames: string[]
): Promise<void> {
  const tier = await resolveOwnerTier(db, message.jobId);

  if (tier === "free") {
    const msg =
      "This ZIP contains multiple SCORM packages. Bulk uploads (a ZIP of ZIPs) require a Pro plan — upgrade, or upload each package separately.";
    await finishPackage(db, message, {
      status: "failed",
      errorMessage: msg,
      issues: [{ severity: "error", code: "BULK_REQUIRES_PRO", message: msg, fixApplied: false }],
      inputFormat: null,
      scormVersionIn: null,
      scormVersionOut: null,
      r2KeyFixed: null,
    });
    return;
  }

  const now = new Date();
  const parentDir = message.r2Key.replace(/\/[^/]+\/[^/]+$/, ""); // strip "/<packageId>/original.ext"

  const newPackages: { id: string; r2Key: string }[] = [];
  for (const name of innerNames) {
    const innerBytes = decompressSingleEntry(bytes, name);
    if (!innerBytes || innerBytes.length === 0) continue;

    const newPackageId = crypto.randomUUID();
    const filename = name.split("/").pop() || name;
    const r2Key = `${parentDir}/${newPackageId}/original.zip`;

    await env.PACKAGES_BUCKET.put(r2Key, innerBytes);
    await db.insert(pkg).values({
      id: newPackageId,
      jobId: message.jobId,
      originalFilename: filename,
      r2KeyUpload: r2Key,
      status: "queued",
      sizeBytes: innerBytes.length,
      createdAt: now,
      updatedAt: now,
    });
    newPackages.push({ id: newPackageId, r2Key });
  }

  if (newPackages.length === 0) {
    const msg = "This looked like a bundle of SCORM packages, but none of the inner .zip files could be read.";
    await finishPackage(db, message, {
      status: "failed",
      errorMessage: msg,
      issues: [{ severity: "error", code: "BULK_EXPAND_FAILED", message: msg, fixApplied: false }],
      inputFormat: null,
      scormVersionIn: null,
      scormVersionOut: null,
      r2KeyFixed: null,
    });
    return;
  }

  // Replace the container row's slot in totalPackages with however many
  // real packages it actually contained, then enqueue each one — in that
  // order, so a fast consumer can never see a stale (too-low) total.
  await db
    .update(job)
    .set({ sourceType: "bulk_zip_of_zips", totalPackages: newPackages.length, updatedAt: now })
    .where(eq(job.id, message.jobId));
  await db.delete(pkg).where(eq(pkg.id, message.packageId));

  for (const p of newPackages) {
    const nextMessage: ProcessingQueueMessage = { type: "process", jobId: message.jobId, packageId: p.id, r2Key: p.r2Key };
    await env.PACKAGE_QUEUE.send(nextMessage);
  }
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
