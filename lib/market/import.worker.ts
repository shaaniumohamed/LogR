import { httpMarketApi, runImport, type ImportProgress, type ImportReport } from "./importer";

/**
 * The import, off the main thread.
 *
 * Parsing a year of ticks is a minute or two of solid work; on the page's own
 * thread that is a frozen tab. Here the page stays responsive and only hears
 * progress messages. One file at a time, in the order chosen.
 */

export type WorkerIn =
  | { type: "start"; files: File[] }
  | { type: "cancel" };

export type WorkerOut =
  | { type: "progress"; index: number; name: string; progress: ImportProgress }
  | { type: "fileDone"; index: number; name: string; report: ImportReport }
  | { type: "done" }
  | { type: "error"; index: number; name: string; message: string; cancelled: boolean };

const scope = self as unknown as {
  postMessage(m: WorkerOut): void;
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
  location: Location;
};

let controller: AbortController | null = null;

scope.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "cancel") { controller?.abort(); return; }
  if (msg.type !== "start") return;

  controller = new AbortController();
  const { signal } = controller;
  const api = httpMarketApi(scope.location.origin, signal);
  for (const [index, file] of msg.files.entries()) {
    try {
      const report = await runImport({
        source: file, api, signal,
        onProgress: (progress) => scope.postMessage({ type: "progress", index, name: file.name, progress }),
      });
      scope.postMessage({ type: "fileDone", index, name: file.name, report });
    } catch (err) {
      const cancelled = signal.aborted || (err instanceof DOMException && err.name === "AbortError");
      scope.postMessage({
        type: "error", index, name: file.name, cancelled,
        message: cancelled ? "Cancelled." : err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }
  scope.postMessage({ type: "done" });
};
