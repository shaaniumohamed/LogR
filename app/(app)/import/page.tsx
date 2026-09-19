import ImportClient from "./import-client";

export default function ImportPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Import trade history</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink2)" }}>
          Exness Personal Area → Trading → History of orders → <b>Download CSV</b>.
          The export caps at 1,000 rows, so pull it in date chunks and drop each file
          here — re-importing an overlap is harmless.
        </p>
      </div>
      <ImportClient />
    </div>
  );
}
