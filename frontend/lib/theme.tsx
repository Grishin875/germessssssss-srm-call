"use client";
import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode   = "light" | "dark" | "system";
export type AccentColor = "indigo" | "blue" | "violet" | "rose" | "emerald" | "orange";
export type Density     = "normal" | "compact";

// Сдержанная корпоративная палитра. По умолчанию — синий (фирменный).
export const ACCENT_COLORS: Record<AccentColor, { label: string; primary: string; hover: string; light: string; text: string }> = {
  blue:    { label: "Синий",    primary: "#2563eb", hover: "#1d4ed8", light: "#eff4ff", text: "#1d4ed8" },
  indigo:  { label: "Индиго",   primary: "#4f46e5", hover: "#4338ca", light: "#eef2ff", text: "#4338ca" },
  violet:  { label: "Фиолет",  primary: "#7c3aed", hover: "#6d28d9", light: "#f5f3ff", text: "#6d28d9" },
  emerald: { label: "Зелёный", primary: "#059669", hover: "#047857", light: "#ecfdf5", text: "#047857" },
  orange:  { label: "Оранжев.", primary: "#ea580c", hover: "#c2410c", light: "#fff7ed", text: "#c2410c" },
  rose:    { label: "Бордо",    primary: "#e11d48", hover: "#be123c", light: "#fff1f2", text: "#be123c" },
};

interface ThemeCtx {
  mode: ThemeMode;
  accent: AccentColor;
  density: Density;
  setMode:    (m: ThemeMode) => void;
  setAccent:  (a: AccentColor) => void;
  setDensity: (d: Density) => void;
  isDark: boolean;
}

const Ctx = createContext<ThemeCtx>({
  mode: "system", accent: "blue", density: "normal", isDark: false,
  setMode: () => {}, setAccent: () => {}, setDensity: () => {},
});

export function useTheme() { return useContext(Ctx); }

function applyMode(mode: ThemeMode) {
  const prefersDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = mode === "dark" || (mode === "system" && prefersDark);
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  return isDark;
}

function applyAccent(accent: AccentColor) {
  const c = ACCENT_COLORS[accent];
  const el = document.documentElement;
  el.style.setProperty("--primary",              c.primary);
  el.style.setProperty("--primary-hover",        c.hover);
  el.style.setProperty("--primary-active",       c.hover);
  el.style.setProperty("--primary-light",        c.light);
  el.style.setProperty("--primary-text",         c.text);
  el.style.setProperty("--sidebar-active-border", c.primary);
  el.style.setProperty("--sidebar-active",       c.primary);
}

function applyDensity(density: Density) {
  const el = document.documentElement;
  if (density === "compact") {
    el.style.setProperty("--field-height",    "30px");
    el.style.setProperty("--field-height-sm", "24px");
    el.style.setProperty("--field-height-lg", "36px");
    el.style.setProperty("--radius",          "7px");
  } else {
    el.style.removeProperty("--field-height");
    el.style.removeProperty("--field-height-sm");
    el.style.removeProperty("--field-height-lg");
    el.style.removeProperty("--radius");
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode,    setModeState]    = useState<ThemeMode>("system");
  const [accent,  setAccentState]  = useState<AccentColor>("blue");
  const [density, setDensityState] = useState<Density>("normal");
  const [isDark,  setIsDark]       = useState(false);

  useEffect(() => {
    const savedMode    = (localStorage.getItem("germess_theme")   as ThemeMode)   || "system";
    const savedAccent  = (localStorage.getItem("germess_accent")  as AccentColor) || "blue";
    const savedDensity = (localStorage.getItem("germess_density") as Density)     || "normal";

    setModeState(savedMode);
    setAccentState(savedAccent);
    setDensityState(savedDensity);
    setIsDark(applyMode(savedMode));
    applyAccent(savedAccent);
    applyDensity(savedDensity);

    // React to system theme change
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (savedMode === "system") setIsDark(applyMode("system"));
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  function setMode(m: ThemeMode) {
    setModeState(m);
    localStorage.setItem("germess_theme", m);
    setIsDark(applyMode(m));
  }

  function setAccent(a: AccentColor) {
    setAccentState(a);
    localStorage.setItem("germess_accent", a);
    applyAccent(a);
  }

  function setDensity(d: Density) {
    setDensityState(d);
    localStorage.setItem("germess_density", d);
    applyDensity(d);
  }

  return (
    <Ctx.Provider value={{ mode, accent, density, isDark, setMode, setAccent, setDensity }}>
      {children}
    </Ctx.Provider>
  );
}

// Inline script for <head> — prevents flash on page load
export const ANTI_FLASH_SCRIPT = `(function(){try{
  var m=localStorage.getItem('germess_theme')||'system';
  var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches);
  document.documentElement.setAttribute('data-theme',d?'dark':'light');
  var a=localStorage.getItem('germess_accent');
  var colors={blue:['#2563eb','#1d4ed8','#eff4ff','#1d4ed8'],indigo:['#4f46e5','#4338ca','#eef2ff','#4338ca'],violet:['#7c3aed','#6d28d9','#f5f3ff','#6d28d9'],emerald:['#059669','#047857','#ecfdf5','#047857'],orange:['#ea580c','#c2410c','#fff7ed','#c2410c'],rose:['#e11d48','#be123c','#fff1f2','#be123c']};
  if(a&&colors[a]){var c=colors[a];var r=document.documentElement;r.style.setProperty('--primary',c[0]);r.style.setProperty('--primary-hover',c[1]);r.style.setProperty('--primary-active',c[1]);r.style.setProperty('--primary-light',c[2]);r.style.setProperty('--primary-text',c[3]);r.style.setProperty('--sidebar-active-border',c[0]);r.style.setProperty('--sidebar-active',c[0]);}
}catch(e){}})();`;
