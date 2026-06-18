"use client";
import { useEffect, useRef } from "react";

/**
 * Живое обновление данных страницы без F5.
 * Вызывает callback каждые intervalMs, только когда вкладка видима,
 * и сразу при возвращении на вкладку.
 */
export function useAutoRefresh(callback: () => void, intervalMs = 30000, enabled = true) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") cbRef.current();
    };
    const id = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") cbRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, enabled]);
}
