import ImportClient from "./import-client";

export default function ImportPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Import trade history</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink2)" }}>
          Exness Personal Area → Trading → History of orders → <b>Download CSV</b>.
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--ink2)" }}>
          Drop the file here as often as you like. Trades already saved are matched on
          their broker ticket and skipped, so <b>re-importing an overlapping range only
          adds what is new</b> — you never have to track where you left off. If your
          broker limits how many rows one export returns, pull it in date chunks and
          drop each file in turn.
        </p>
      </div>
      <ImportClient />
    </div>
  );
}
