import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";

export default function Landing() {
  return (
    <Layout>
      <Hero />
      <Problem />
      <HowItWorks />
      <PricingTeaser />
      <Faq />
      <Contact />
    </Layout>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-20 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
        Get your training content into WalkMe Learning Arc —
        <span className="text-slate-500"> without the SCORM headaches</span>
      </h1>
      <p className="mt-6 text-lg text-slate-600">
        Already have a SCORM package from SAP Enable Now? We validate it and fix what we safely can. Have a PDF,
        video, slide deck, or web page instead? We package it into a SCORM course for you. Either way, you get a
        package WalkMe Learning Arc will actually track correctly.
      </p>
      <div className="mt-8 flex justify-center gap-4">
        <Link to="/sign-up" className="rounded-md bg-slate-900 px-5 py-2.5 text-white">
          Try it free
        </Link>
        <Link to="/pricing" className="rounded-md border border-slate-300 px-5 py-2.5">
          See pricing
        </Link>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">
        SAP Enable Now exports don't import cleanly — and not everything is SCORM to begin with
      </h2>
      <p className="mt-4 text-slate-600">
        SAP Enable Now can export learning packages as SCORM, but WalkMe
        Learning Arc only accepts SCORM 1.2 ZIP files — and real-world
        exports commonly fail or track badly once imported: the wrong SCORM
        version, a missing or mis-cased launch file, and content marked as
        <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-sm">
          asset
        </code>
        instead of
        <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-sm">
          sco
        </code>
        so completion is never recorded.
      </p>
      <p className="mt-4 text-slate-600">
        And plenty of useful training material was never SCORM at all — a PDF guide, a recorded walkthrough video,
        a slide deck, a one-off web page. Getting any of that into WalkMe Learning Arc normally means repackaging
        it by hand. SENtoArc does that part too.
      </p>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { title: "Upload", body: "A SCORM ZIP from SEN, or a PDF, video, slide deck, or web page." },
    { title: "Validate or package", body: "SCORM gets checked for version, manifest, launch file, and scormtype issues. Everything else gets built into a fresh SCORM 1.2 course." },
    { title: "Auto-fix", body: "Safe fixes are applied automatically; anything risky is flagged instead of guessed." },
    { title: "Download", body: "Get back a SCORM package ready for WalkMe, plus a per-package report." },
  ];
  return (
    <section className="mx-auto max-w-4xl px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">How it works</h2>
      <ol className="mt-6 grid gap-6 sm:grid-cols-2">
        {steps.map((step, i) => (
          <li key={step.title} className="rounded-lg border border-slate-200 p-5">
            <span className="text-sm font-medium text-slate-400">Step {i + 1}</span>
            <h3 className="mt-1 font-semibold text-slate-900">{step.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PricingTeaser() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-12 text-center">
      <h2 className="text-2xl font-semibold text-slate-900">Simple pricing</h2>
      <p className="mt-4 text-slate-600">
        Start free with up to a handful of packages. Upgrade to Pro for bulk
        migrations, or talk to us about Enterprise if you have multiple
        teams.
      </p>
      <Link to="/pricing" className="mt-6 inline-block text-slate-900 underline">
        View full pricing →
      </Link>
    </section>
  );
}

function Faq() {
  const items = [
    {
      q: "What exactly do I upload?",
      a: "A SCORM ZIP that SAP Enable Now itself exported (we don't read SEN's internal workspace format, only its SCORM output), or a PDF, MP4 video, PPTX, or HTML file to be packaged into SCORM from scratch.",
    },
    {
      q: "Does PDF/video/slide packaging look the same as a real SCORM course?",
      a: "It's a simple, single-screen launch page that embeds your content and tracks completion — for video, automatically when it ends; for everything else, with a Mark Complete button. PowerPoint files currently link out for download rather than rendering slide-by-slide in the browser.",
    },
    {
      q: "Can every package be auto-fixed?",
      a: "No — some issues (like SCORM 2004 sequencing that can't be safely downgraded) are flagged rather than guessed at, with a clear explanation in the report.",
    },
    {
      q: "Is my content stored permanently?",
      a: "No. Uploaded and fixed files are automatically deleted after a retention period tied to your plan (see pricing for details).",
    },
  ];
  return (
    <section className="mx-auto max-w-4xl px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">FAQ</h2>
      <dl className="mt-6 space-y-6">
        {items.map((item) => (
          <div key={item.q}>
            <dt className="font-medium text-slate-900">{item.q}</dt>
            <dd className="mt-1 text-sm text-slate-600">{item.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Contact() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setStatus("sending");
    try {
      const res = await fetch("/api/contact-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.get("companyName"),
          contactName: form.get("contactName"),
          email: form.get("email"),
          companySize: form.get("companySize"),
          message: form.get("message"),
        }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section id="contact" className="mx-auto max-w-2xl px-6 py-12">
      <h2 className="text-2xl font-semibold text-slate-900">Enterprise? Let's talk</h2>
      <p className="mt-4 text-slate-600">
        Multiple teams, shared projects, and SSO-ready roles are handled on
        an Enterprise plan. Tell us about your migration and we'll follow up.
      </p>
      {status === "sent" ? (
        <p className="mt-6 rounded-md bg-green-50 p-4 text-green-800">
          Thanks — we'll be in touch shortly.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <input name="companyName" required placeholder="Company name" className="w-full rounded-md border border-slate-300 px-3 py-2" />
          <input name="contactName" required placeholder="Your name" className="w-full rounded-md border border-slate-300 px-3 py-2" />
          <input name="email" required type="email" placeholder="Work email" className="w-full rounded-md border border-slate-300 px-3 py-2" />
          <input name="companySize" placeholder="Company size (optional)" className="w-full rounded-md border border-slate-300 px-3 py-2" />
          <textarea name="message" placeholder="Anything we should know?" className="w-full rounded-md border border-slate-300 px-3 py-2" rows={3} />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-md bg-slate-900 px-5 py-2.5 text-white disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Contact sales"}
          </button>
          {status === "error" && (
            <p className="text-sm text-red-600">Something went wrong — please try again.</p>
          )}
        </form>
      )}
    </section>
  );
}
