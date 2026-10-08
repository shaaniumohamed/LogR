import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { runImport, type ChunkDescription, type ManifestChunk, type MarketApi } from "@/lib/market/importer";
import { decodeBars, decodeTicks } from "@/lib/core/market/format";
import { gunzip, sha256Hex } from "@/lib/core/market/bytes";
import { rollup, ticksToM1 } from "@/lib/core/market/bars";
import type { Resolution } from "@/lib/core/market/periods";

/** The server and bucket, in memory, with the same rules as the real routes. */
function fakeStore() {
  const objects = new Map<string, Uint8Array>();
  const catalogue = new Map<string, ChunkDescription & { url: string }>();
  const pendingPut = new Map<string, ChunkDescription>();
  const calls = { requestUpload: 0, put: 0, commit: 0, download: 0, skip: 0 };
  const id = (m: { resolution: string; period: string }) => `${m.resolution}:${m.period}`;
  const api: MarketApi = {
    async manifest(_symbol, resolution, from, to) {
      return [...catalogue.values()]
        .filter((c) => c.resolution === resolution && (!from || c.period >= from) && (!to || c.period <= to))
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((c): ManifestChunk => ({ period: c.period, sha256: c.sha256, url: c.url, rows: c.rows }));
    },
    async requestUpload(meta) {
      calls.requestUpload++;
      if (catalogue.get(id(meta))?.sha256 === meta.sha256) { calls.skip++; return { skip: true }; }
      const url = `mem://${meta.resolution}/${meta.period}/${meta.sha256}`;
      pendingPut.set(url, meta);
      return { key: url, url };
    },
    async put(url, body) { calls.put++; objects.set(url, body); },
    async commit(meta) {
      calls.commit++;
      const url = `mem://${meta.resolution}/${meta.period}/${meta.sha256}`;
      const body = objects.get(url);
      if (!body || body.length !== meta.bytes || (await sha256Hex(body)) !== meta.sha256) throw new Error("bad commit");
      catalogue.set(id(meta), { ...meta, url });
    },
    async download(url) { calls.download++; return objects.get(url)!; },
  };
  const read = async (resolution: Resolution, period: string) => {
    const c = catalogue.get(`${resolution}:${period}`);
    if (!c) return null;
    const raw = await gunzip(objects.get(c.url)!);
    return resolution === "tick" ? decodeTicks(raw) : decodeBars(raw);
  };
  return { api, catalogue, calls, read };
}

/** Exness-format CSV text: one tick every `step` seconds from `from` to `to` (UTC ms). */
function csv(from: number, to: number, step = 20, header = true) {
  const lines = header ? ["Exness\tSymbol\tTimestamp\tBid\tAsk"] : [];
  let i = 0;
  for (let t = from; t < to; t += step * 1000, i++) {
    const bid = (2600 + Math.sin(i / 50) * 5 + (i % 7) / 1000).toFixed(3);
    const ask = (Number(bid) + 0.16).toFixed(3);
    lines.push(`exness\tXAUUSDm\t${new Date(t).toISOString().replace("T", " ")}\t${bid}\t${ask}`);
  }
  return lines.join("\n") + "\n";
}

const zipOf = (name: string, text: string) => new Blob([zipSync({ [name]: strToU8(text) }) as BlobPart]);

describe("runImport", () => {
  // 30 Dec 2024 22:00 → 2 Jan 2025 06:00: two months, two years, four days.
  const FROM = Date.UTC(2024, 11, 30, 22), TO = Date.UTC(2025, 0, 2, 6);

  it("files ticks by day, minutes by month, hours and days by year", async () => {
    const s = fakeStore();
    const progress: string[] = [];
    const r = await runImport({ source: zipOf("XAUUSDm_2024.csv", csv(FROM, TO)), api: s.api, onProgress: (p) => progress.push(p.phase) });

    expect(r.symbol).toBe("XAUUSD");
    expect(r.sourceSymbol).toBe("XAUUSDm");
    expect([r.firstDay, r.lastDay, r.days]).toEqual(["2024-12-30", "2025-01-02", 4]);
    expect(r.parse.malformed + r.parse.badPrice).toBe(0);
    expect(progress.at(-1)).toBe("done");
    expect([...s.catalogue.keys()].sort()).toEqual([
      "d1:2024", "d1:2025", "h1:2024", "h1:2025", "m1:2024-12", "m1:2025-01",
      "tick:2024-12-30", "tick:2024-12-31", "tick:2025-01-01", "tick:2025-01-02",
    ]);

    // Every tick is stored, and the candles are the ones the ticks make.
    const days = await Promise.all(["2024-12-30", "2024-12-31", "2025-01-01", "2025-01-02"].map((d) => s.read("tick", d)));
    const total = days.reduce((n, d) => n + d!.count, 0);
    expect(total).toBe(r.ticks);
    const dec = await s.read("m1", "2025-01");
    const fromTicks = ticksToM1(days[2] as never);
    expect(Array.from((dec as never as { time: Uint32Array }).time).slice(0, 5)).toEqual(Array.from(fromTicks.time).slice(0, 5));
    const h1 = await s.read("h1", "2024") as ReturnType<typeof decodeBars>;
    const m1Dec = await s.read("m1", "2024-12") as ReturnType<typeof decodeBars>;
    expect(h1.close).toEqual(rollup(m1Dec, 3600).close);
    const d1 = await s.read("d1", "2024") as ReturnType<typeof decodeBars>;
    expect(Array.from(d1.time)).toEqual([Date.UTC(2024, 11, 30) / 1000, Date.UTC(2024, 11, 31) / 1000]);
  });

  it("skips everything when the same file is imported again", async () => {
    const s = fakeStore();
    const file = zipOf("a.csv", csv(FROM, TO));
    await runImport({ source: file, api: s.api });
    const putsAfterFirst = s.calls.put;
    const again = await runImport({ source: file, api: s.api });
    expect(again.uploaded).toBe(0);
    expect(again.skipped).toBe(10);
    expect(s.calls.put).toBe(putsAfterFirst);
  });

  it("joins a day split across two files, and keeps stored days the new file does not bring", async () => {
    const s = fakeStore();
    const split = Date.UTC(2025, 0, 2, 12);
    // First file: 1 Jan – noon on 2 Jan. Second: noon on 2 Jan – 3 Jan.
    await runImport({ source: zipOf("a.csv", csv(Date.UTC(2025, 0, 1), split)), api: s.api });
    const before = await s.read("m1", "2025-01") as ReturnType<typeof decodeBars>;
    await runImport({ source: zipOf("b.csv", csv(split, Date.UTC(2025, 0, 4))), api: s.api });

    const jan2 = await s.read("tick", "2025-01-02") as ReturnType<typeof decodeTicks>;
    expect(jan2.count).toBe(86_400 / 20); // both halves, nothing doubled
    const jan1 = await s.read("tick", "2025-01-01") as ReturnType<typeof decodeTicks>;
    expect(jan1.count).toBe(86_400 / 20); // untouched by the second file

    const after = await s.read("m1", "2025-01") as ReturnType<typeof decodeBars>;
    // 1 Jan's minutes survive the second import; 2 and 3 Jan are complete.
    expect(Array.from(after.time).filter((t) => t < Date.UTC(2025, 0, 2) / 1000)).toEqual(
      Array.from(before.time).filter((t) => t < Date.UTC(2025, 0, 2) / 1000));
    expect(after.count).toBe(3 * 1440);
    const h1 = await s.read("h1", "2025") as ReturnType<typeof decodeBars>;
    expect(h1.count).toBe(3 * 24);
  });

  it("reads a plain CSV as well as a zip", async () => {
    const s = fakeStore();
    const r = await runImport({ source: new Blob([csv(Date.UTC(2025, 0, 6), Date.UTC(2025, 0, 6, 1))]), api: s.api });
    expect(r.days).toBe(1);
    expect(s.catalogue.has("tick:2025-01-06")).toBe(true);
  });

  it("stops when cancelled", async () => {
    const s = fakeStore();
    const ac = new AbortController();
    ac.abort();
    await expect(runImport({ source: zipOf("a.csv", csv(FROM, TO)), api: s.api, signal: ac.signal })).rejects.toThrow(/cancelled/);
  });

  it("surfaces a failed upload instead of reporting success", async () => {
    const s = fakeStore();
    s.api.put = async () => { throw new Error("network down"); };
    await expect(runImport({ source: zipOf("a.csv", csv(FROM, TO)), api: s.api })).rejects.toThrow(/network down/);
  });
});
