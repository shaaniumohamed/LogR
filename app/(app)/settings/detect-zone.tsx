"use client";

import { useEffect, useState } from "react";

/** Reads the browser's zone so the user does not have to hunt for their own city. */
export function DetectZone({ current }: { current: string }) {
  const [detected, setDetected] = useState<string | null>(null);
  useEffect(() => {
    try { setDetected(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* unavailable */ }
  }, []);

  if (!detected || detected === current) return null;
  return (
    <button
      type="button"
      className="text-[12.5px] font-semibold"
      style={{ color: "var(--c1)" }}
      onClick={(e) => {
        const form = e.currentTarget.closest("form");
        const select = form?.querySelector<HTMLSelectElement>('select[name="timeZone"]');
        if (!select) return;
        if (![...select.options].some((o) => o.value === detected)) {
          select.add(new Option(`${detected} (detected)`, detected), 0);
        }
        select.value = detected;
      }}
    >
      Use my current location ({detected})
    </button>
  );
}
