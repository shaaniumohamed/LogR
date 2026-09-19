import type { CloseReason, Position } from "./types";

/**
 * Parser for the Exness Personal Area CSV export
 * (Trading → History of orders → Download CSV).
 *
 * Header, as exported:
 *   ticket, opening_time_utc, closing_time_utc, type, lots,
 *   original_position_size, symbol, opening_price, closing_price,
 *   stop_loss, take_profit, commission, swap, profit, equity,
 *   margin_level, close_reason
 *
 * Every quirk handled below was found in a real export (docs/20 §1), not guessed.
 */

export interface ParseResult {
  positions: Position[];
  /** Rows the parser could not use, with the reason — surfaced, never silent. */
  skipped: { line: number; reason: string; raw: string }[];
  /** Exact repeats of an existing (ticket, closedAt) — the same exit twice. */
  duplicates: number;
  /** Broker totals for the reconciliation screen. */
  summary: {
    rows: number;
    parsed: number;
    net: number;
    symbols: Record<string, number>;
    closeReasons: Record<string, number>;
    from: Date | null;
    to: Date | null;
    withStop: number;
    withTarget: number;
  };
}

const REQUIRED = ["ticket", "opening_time_utc", "closing_time_utc", "type", "lots", "symbol"];

/**
 * A blank numeric cell means ZERO, not missing.
 *
 * Exness leaves `profit` empty on scratch trades whose P&L rounds to 0.00 — about
 * 1% of rows in a real export. Treating blank as missing silently drops those
 * trades and makes the imported net disagree with the broker's. `commission` and
 * `swap` are blank throughout on commission-free accounts for the same reason.
 */
function num(v: string | undefined): number {
  if (v == null) return 0;
  const t = v.trim();
  if (t === "") return 0;
  const n = Number(t.replace(/\s/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Optional price: blank genuinely means "not set" here, so null, not zero. */
function optPrice(v: string | undefined): number | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === "" || t === "0" || t === "0.0" || t === "0.00") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDate(v: string): Date | null {
  const t = v.trim();
  if (!t) return null;
  // Exness writes ISO-8601 without a zone suffix, and labels the column _utc.
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(t) && !/[Zz+]|[+-]\d{2}:\d{2}$/.test(t) ? `${t}Z` : t;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const CLOSE_REASONS: CloseReason[] = ["user", "tp", "sl", "so"];

/**
 * Identity of a close event. NOT the ticket alone — partial exits of one
 * position all share it (see the Position docstring).
 */
export function positionKey(ticket: string, closedAt: Date): string {
  return `${ticket}@${closedAt.toISOString()}`;
}

export function parseExnessCsv(text: string): ParseResult {
  const skipped: ParseResult["skipped"] = [];
  const positions: Position[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    throw new Error("That file has no data rows. Export from Personal Area → Trading → History of orders → Download CSV.");
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((r) => !header.includes(r));
  if (missing.length) {
    throw new Error(
      `This does not look like an Exness order-history export — missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
        `If you exported the Trading Analytics summary (a PDF of totals), that file has no per-trade rows and cannot be imported.`
    );
  }
  const idx = (k: string) => header.indexOf(k);
  const col = (cells: string[], k: string) => {
    const i = idx(k);
    return i === -1 ? undefined : cells[i];
  };

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const cells = splitCsvLine(raw);
    const ticket = (col(cells, "ticket") ?? "").trim();
    const openedAt = parseDate(col(cells, "opening_time_utc") ?? "");
    const closedAt = parseDate(col(cells, "closing_time_utc") ?? "");
    const typeRaw = (col(cells, "type") ?? "").trim().toLowerCase();

    if (!ticket) { skipped.push({ line: i + 1, reason: "no ticket", raw }); continue; }
    if (!openedAt || !closedAt) { skipped.push({ line: i + 1, reason: "unparseable timestamp", raw }); continue; }
    // Only directional trades. Balance operations and pending orders are not trades.
    if (typeRaw !== "buy" && typeRaw !== "sell") {
      skipped.push({ line: i + 1, reason: `not a trade (type="${typeRaw}")`, raw });
      continue;
    }
    const lots = num(col(cells, "lots"));
    if (lots <= 0) { skipped.push({ line: i + 1, reason: "zero volume", raw }); continue; }

    const reasonRaw = (col(cells, "close_reason") ?? "").trim().toLowerCase();
    const closeReason: CloseReason = (CLOSE_REASONS as string[]).includes(reasonRaw)
      ? (reasonRaw as CloseReason)
      : "unknown";

    // Same exit reported twice (overlapping exports pasted together). A partial
    // close is NOT this: it differs on closedAt, so it survives.
    const key = positionKey(ticket, closedAt);
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);

    positions.push({
      ticket,
      openedAt,
      closedAt,
      direction: typeRaw === "buy" ? "long" : "short",
      lots,
      symbol: (col(cells, "symbol") ?? "UNKNOWN").trim().toUpperCase(),
      openPrice: num(col(cells, "opening_price")),
      closePrice: num(col(cells, "closing_price")),
      stopLoss: optPrice(col(cells, "stop_loss")),
      takeProfit: optPrice(col(cells, "take_profit")),
      commission: num(col(cells, "commission")),
      swap: num(col(cells, "swap")),
      profit: num(col(cells, "profit")),
      closeReason,
    });
  }

  positions.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());

  const symbols: Record<string, number> = {};
  const closeReasons: Record<string, number> = {};
  for (const p of positions) {
    symbols[p.symbol] = (symbols[p.symbol] ?? 0) + 1;
    closeReasons[p.closeReason] = (closeReasons[p.closeReason] ?? 0) + 1;
  }

  return {
    positions,
    skipped,
    duplicates,
    summary: {
      rows: lines.length - 1,
      parsed: positions.length,
      net: round2(positions.reduce((s, p) => s + p.profit + p.commission + p.swap, 0)),
      symbols,
      closeReasons,
      from: positions[0]?.openedAt ?? null,
      to: positions[positions.length - 1]?.openedAt ?? null,
      withStop: positions.filter((p) => p.stopLoss !== null).length,
      withTarget: positions.filter((p) => p.takeProfit !== null).length,
    },
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
