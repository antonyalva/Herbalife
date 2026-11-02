// Tema claro / oscuro / automático, compartido por la app y el catálogo.
// El <script> inline del <head> aplica el tema guardado antes de pintar, para que no parpadee.

const root = document.documentElement;
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function getTheme() {
  try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; }
}

export function isDark() {
  const t = root.getAttribute("data-theme");
  return t ? t === "dark" : media.matches;
}

export function applyTheme(t) {
  if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
  else { t = "auto"; root.removeAttribute("data-theme"); }
  try { if (t === "auto") localStorage.removeItem("theme"); else localStorage.setItem("theme", t); } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = isDark() ? "#0f6b3c" : "#178a4e";
  document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
    b.textContent = isDark() ? "☀️" : "🌙";
    b.setAttribute("aria-label", isDark() ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
  });
  document.querySelectorAll("[data-theme-pick]").forEach((b) => b.classList.toggle("active", b.dataset.themePick === t));
}

export function initTheme() {
  applyTheme(getTheme());
  document.querySelectorAll("[data-theme-toggle]").forEach((b) => b.addEventListener("click", () => applyTheme(isDark() ? "light" : "dark")));
  media.addEventListener("change", () => { if (getTheme() === "auto") applyTheme("auto"); });
}

/** Oculta la pantalla de intro (splash) con una transición, respetando un tiempo mínimo visible. */
export function hideSplash(minMs = 900) {
  const el = document.getElementById("splash");
  if (!el) return;
  const shown = Number(el.dataset.shownAt || Date.now());
  const wait = Math.max(0, minMs - (Date.now() - shown));
  setTimeout(() => { el.classList.add("hide"); setTimeout(() => el.remove(), 450); }, wait);
}
