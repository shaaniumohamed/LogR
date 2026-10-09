/**
 * Small sounds for the replay, made on the spot with the Web Audio API — no
 * files to download. A soft tick when an order fills; one neutral "done" when
 * a trade closes, the same for a win as for a loss (the point is noticing the
 * moment, not a jingle that rewards the outcome); a chime when the replay
 * pauses by itself; a low buzz when an action is refused.
 *
 * Browsers only allow sound after the person has touched the page, iOS most
 * of all, so `unlock()` is called from the first press or key.
 */
export type SoundKind = "fill" | "close" | "pause" | "error";

export function createSounds() {
  let ctx: AudioContext | null = null;

  const unlock = () => {
    if (typeof window === "undefined") return;
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch { return; }
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  };

  const tone = (freq: number, at: number, dur: number, type: OscillatorType = "sine", level = 0.12) => {
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(level, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  return {
    unlock,
    play(kind: SoundKind) {
      if (!ctx || ctx.state !== "running") return;
      if (kind === "fill") tone(1046, 0, 0.06, "sine", 0.08);
      else if (kind === "close") { tone(587, 0, 0.12); tone(880, 0.09, 0.16); }
      else if (kind === "pause") tone(659, 0, 0.18, "triangle", 0.1);
      else tone(196, 0, 0.14, "square", 0.05);
    },
    dispose() { void ctx?.close().catch(() => undefined); ctx = null; },
  };
}
