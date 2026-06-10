import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex } from "../../lib/color";

// Loosely-typed EyeDropper API (Chromium-only, no @types). We only need open().
type EyeDropperResult = { sRGBHex: string };
type EyeDropperInstance = { open: () => Promise<EyeDropperResult> };
type EyeDropperCtor = new () => EyeDropperInstance;
function getEyeDropper(): EyeDropperCtor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const ctor = (window as unknown as { EyeDropper?: unknown }).EyeDropper;
  return typeof ctor === "function" ? (ctor as EyeDropperCtor) : null;
}

const POPOVER_HEIGHT_ESTIMATE = 240;
const POPOVER_WIDTH = 212;

/**
 * A trigger swatch that opens a custom, app-themed color picker popover
 * (SV square + hue slider + hex input + optional per-region opacity slider and
 * eyedropper). Replaces the native, un-styleable `<input type="color">`.
 *
 * The popover is positioned with `position: fixed` from the trigger's bounding
 * rect so the region list's `overflow-y:auto` cannot clip it (no portal needed).
 */
export function ColorField({
  label,
  color,
  onColor,
  opacity,
  onOpacity,
}: {
  label: string;
  color: string;
  onColor: (hex: string) => void;
  opacity?: number;
  onOpacity?: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  // Local HSV so dragging the SV square / hue slider works even at greys (where
  // the hex alone loses hue). Synced from the `color` prop whenever it changes
  // to a hex that differs from the hex our local HSV currently produces.
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  useEffect(() => {
    if (hsvToHex(hsv.h, hsv.s, hsv.v).toLowerCase() !== color.toLowerCase()) {
      setHsv(hexToHsv(color));
    }
    // Only react to external color changes, not our own hsv updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  const { h, s, v } = hsv;

  const computePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + 6;
    const height = popoverRef.current?.offsetHeight ?? POPOVER_HEIGHT_ESTIMATE;
    if (top + height > vh) {
      const above = rect.top - 6 - height;
      top = above >= 8 ? above : Math.max(8, vh - height - 8);
    }
    let left = rect.left;
    if (left + POPOVER_WIDTH > vw - 8) {
      left = vw - 8 - POPOVER_WIDTH;
    }
    if (left < 8) {
      left = 8;
    }
    setPos({ left, top });
  }, []);

  // Position on open (and keep it correct on scroll/resize, which also closes).
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    computePosition();
  }, [open, computePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Dismiss on Escape and outside pointerdown; restore focus to the trigger.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  const setFromHsv = (next: { h: number; s: number; v: number }) => {
    setHsv(next);
    onColor(hsvToHex(next.h, next.s, next.v));
  };

  const svRef = useRef<HTMLDivElement>(null);
  const handleSvPointer = (clientX: number, clientY: number) => {
    const el = svRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const ns = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    const nv = rect.height > 0 ? 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) : 0;
    setFromHsv({ h, s: ns, v: nv });
  };

  const eyeDropper = getEyeDropper();
  const pickFromScreen = async () => {
    const Ctor = getEyeDropper();
    if (!Ctor) {
      return;
    }
    try {
      const result = await new Ctor().open();
      if (result?.sRGBHex) {
        onColor(result.sRGBHex);
      }
    } catch {
      // User cancelled or the API failed; ignore.
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="color-field-trigger"
        style={{ background: color }}
        aria-label={`Edit ${label} color`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (!next) {
              triggerRef.current?.focus();
            }
            return next;
          });
        }}
      />
      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`${label} color`}
          className="color-popover"
          style={{ position: "fixed", left: pos.left, top: pos.top }}
        >
          <div
            ref={svRef}
            className="color-sv"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${Math.round(
                h,
              )}, 100%, 50%)`,
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              handleSvPointer(event.clientX, event.clientY);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                handleSvPointer(event.clientX, event.clientY);
              }
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
          >
            <div
              className="color-sv-thumb"
              style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
            />
          </div>

          <input
            type="range"
            className="color-hue"
            min={0}
            max={360}
            value={Math.round(h)}
            aria-label={`${label} hue`}
            onChange={(event) => setFromHsv({ h: Number(event.target.value), s, v })}
          />

          <input
            type="text"
            className="color-hex"
            aria-label={`${label} color`}
            value={color}
            spellCheck={false}
            onChange={(event) => {
              const raw = event.target.value.trim();
              const stripped = raw.startsWith("#") ? raw.slice(1) : raw;
              if (/^[0-9a-fA-F]{3}$/.test(stripped) || /^[0-9a-fA-F]{6}$/.test(stripped)) {
                const six =
                  stripped.length === 3
                    ? stripped[0] + stripped[0] + stripped[1] + stripped[1] + stripped[2] + stripped[2]
                    : stripped;
                onColor(`#${six.toLowerCase()}`);
              }
            }}
          />

          {opacity !== undefined && onOpacity ? (
            <div className="color-opacity-row">
              <span className="region-opacity-label">Opacity</span>
              <input
                type="range"
                className="region-opacity"
                min={0}
                max={100}
                step={1}
                value={Math.round(opacity * 100)}
                aria-label={`${label} opacity`}
                onChange={(event) => onOpacity(Number(event.target.value) / 100)}
              />
              <span className="region-opacity-value">{Math.round(opacity * 100)}%</span>
            </div>
          ) : null}

          {eyeDropper ? (
            <button
              type="button"
              className="color-eyedropper"
              aria-label={`Pick ${label} color from screen`}
              onClick={pickFromScreen}
            >
              Pick from screen
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
