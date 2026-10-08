/* Deep-link scrolling for the diff viewer. Never moves focus (AC-74) and drops the
   smooth animation under prefers-reduced-motion (AC-75). */

export function scrollToTarget(el: Element): void {
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
}
