"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface Shot {
  id: string;
  url: string;
  caption: string | null;
  width: number | null;
  height: number | null;
}

/** Long edge, in pixels. A phone screenshot is ~1200 wide; this keeps detail. */
const MAX_EDGE = 1600;
const QUALITY = 0.82;

/**
 * Shrink and re-encode before anything leaves the phone.
 *
 * A modern phone screenshot is three to six megabytes of PNG. Sending that
 * over mobile data to store a picture of a chart is slow enough that nobody
 * does it twice, and it would fill a free storage tier in a few hundred
 * trades. Re-encoded at sixteen hundred pixels it lands around two hundred
 * kilobytes with no visible loss on a chart — flat colour and thin lines are
 * exactly what WebP is good at.
 *
 * Doing it here rather than on the server also means the upload is small,
 * which is the part the trader actually waits for.
 */
async function compress(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize images.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) => {
    // WebP everywhere that matters, including Safari since 14. The JPEG fallback
    // is for anything that quietly returns a PNG instead, which would undo the
    // whole point of this function.
    canvas.toBlob((b) => resolve(b), "image/webp", QUALITY);
  });
  if (blob && blob.type === "image/webp") return { blob, width, height };

  const jpeg = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", QUALITY);
  });
  if (!jpeg) throw new Error("This browser could not re-encode the image.");
  return { blob: jpeg, width, height };
}

export function Screenshots({ identityHash, shots, enabled }: {
  identityHash: string;
  shots: Shot[];
  enabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Shot | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  if (!enabled) {
    return (
      <div className="mt-3 rounded-lg p-3 text-[12.5px] leading-relaxed"
           style={{ background: "var(--s3)", color: "var(--ink2)" }}>
        <b>Screenshots are not switched on.</b> They need somewhere to live: make a free
        Cloudflare R2 bucket, then set <code className="num">R2_ACCOUNT_ID</code>,{" "}
        <code className="num">R2_ACCESS_KEY_ID</code>, <code className="num">R2_SECRET_ACCESS_KEY</code>{" "}
        and <code className="num">R2_BUCKET</code> in your host&rsquo;s environment variables.
        Ten gigabytes is free, and reading them back costs nothing.
      </div>
    );
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(null);
    try {
      for (const file of Array.from(files).slice(0, 6)) {
        const { blob, width, height } = await compress(file);
        const form = new FormData();
        form.set("file", new File([blob], "shot", { type: blob.type }));
        form.set("identityHash", identityHash);
        form.set("width", String(width));
        form.set("height", String(height));
        const r = await fetch("/api/screenshots", { method: "POST", body: form });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError([j.error, j.detail, j.hint].filter(Boolean).join(" "));
          break;
        }
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That image could not be read.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/screenshots?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setBusy(false);
    setOpen(null);
    router.refresh();
  }

  return (
    <div className="mt-3">
      {shots.length > 0 && (
        <ul className="mb-3 grid grid-cols-3 gap-2">
          {shots.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(s)}
                      className="block w-full overflow-hidden rounded-lg"
                      style={{ border: "1px solid var(--line)", aspectRatio: "4 / 3" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={s.caption ?? "Chart screenshot"}
                     className="h-full w-full object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept="image/*" multiple className="hidden"
               onChange={(e) => upload(e.target.files)} />
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
                className="rounded-lg px-3.5 py-2 text-[13px] font-semibold"
                style={{ background: "var(--ink)", color: "var(--plane)", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Working…" : shots.length ? "Add another" : "Add a screenshot"}
        </button>
        <span className="text-[11px]" style={{ color: "var(--ink3)" }}>
          shrunk on your phone before it is sent
        </span>
      </div>

      {error && <p className="mt-2 text-[12.5px]" style={{ color: "var(--loss)" }}>{error}</p>}

      {open && (
        // A plain fixed overlay rather than a dialog element: it has to work the
        // same in an installed web app on iOS, where <dialog> support arrived late.
        <div className="fixed inset-0 z-50 flex flex-col"
             style={{ background: "color-mix(in srgb, var(--plane) 96%, transparent)" }}
             onClick={() => setOpen(null)}>
          <div className="flex items-center justify-between gap-3 px-4 py-3"
               style={{ borderBottom: "1px solid var(--line)" }}>
            <span className="truncate text-[13px]">{open.caption ?? "Chart screenshot"}</span>
            <div className="flex items-center gap-4">
              <button type="button" className="tap text-[12.5px]" style={{ color: "var(--loss)" }}
                      onClick={(e) => { e.stopPropagation(); remove(open.id); }}>
                Remove
              </button>
              <button type="button" className="tap text-[13px] font-semibold"
                      onClick={() => setOpen(null)}>Close</button>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={open.url} alt={open.caption ?? "Chart screenshot"}
                 className="max-h-full max-w-full object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
