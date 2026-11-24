import { useState, useCallback, useRef } from "react";
import { useMountEffect } from "./useMountEffect";
import type { AppToast } from "../utils/studioHelpers";

interface ToastItem extends AppToast {
  id: number;
  pending?: boolean;
  /** True while the exit animation plays, just before removal. */
  leaving?: boolean;
}

const AUTO_DISMISS_MS = 3000;
const EXIT_MS = 160;
const MAX_TOASTS = 3;

let nextToastId = 1;

/**
 * Owner-local toasts (max 3), displayed in the shared StudioToastLayer layout.
 * Toasts without an action auto-dismiss after 3s, regardless of tone or presentation.
 * Optional actions stay available until completed, dismissed or displaced.
 * Feedback dismissal never changes the underlying operation or save guards.
 */
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const removeToast = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const dismissToast = useCallback(
    (id: number) => {
      clearTimer(id);
      // Mark leaving so the exit animation plays, then remove.
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      const timer = setTimeout(() => removeToast(id), EXIT_MS);
      timersRef.current.set(id, timer);
    },
    [clearTimer, removeToast],
  );

  const showToast = useCallback(
    (message: string, tone: AppToast["tone"] = "error", presentation?: AppToast["presentation"], action?: AppToast['action']): number => {
      const id = nextToastId++;
      let running = false, completed = false;
      const toastAction = action && { ...action, onClick: async () => {
        if (running || completed) return;
        running = true;
        setToasts(current => current.map(item => item.id === id ? { ...item, pending: true } : item));
        try { await action.onClick(); completed = true; dismissToast(id); }
        catch (error) { showToast(error instanceof Error ? error.message : 'Action not completed. Please try again.'); }
        finally {
          running = false;
          setToasts(current => current.map(item => item.id === id ? { ...item, pending: false } : item));
        }
      } };
      setToasts((prev) => {
        // Refresh an identical notice instead of stacking the same failure.
        const retained = prev.filter((toast) => {
          if (toast.message !== message || toast.tone !== tone || toast.presentation !== presentation || toast.action?.key !== action?.key) return true;
          clearTimer(toast.id);
          return false;
        });
        const next = [...retained, { id, message, tone, presentation, action: toastAction }];
        // Cap the stack; drop the oldest (and its pending timer).
        while (next.length > MAX_TOASTS) {
          const dropped = next.shift();
          if (dropped) clearTimer(dropped.id);
        }
        return next;
      });
      if (!action) {
        const timer = setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [clearTimer, dismissToast],
  );

  useMountEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
  });

  return { toasts, showToast, dismissToast };
}
