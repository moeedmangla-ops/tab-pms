"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6">
      <h1 className="h2 mb-2">This page could not be shown</h1>
      <p className="text-muted">Either your role does not have access to it, or something went wrong. If you think you should have access, ask an administrator.</p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-muted">Reference: {error.digest}</p>}
      <button className="btn mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
