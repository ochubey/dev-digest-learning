import React from "react";
import { createPortal } from "react-dom";

/** Hover-triggered floating panel — modeled on @devdigest/ui's Dropdown
 *  (absolute-positioned panel styling), but opens on hover instead of click,
 *  with a short close-delay so the pointer can move from the trigger into
 *  the panel without it closing. Renders via a portal into document.body so
 *  it isn't clipped by an ancestor's `overflow: hidden` (e.g. a table card). */
export function Popover({
  trigger,
  children,
  align = "left",
  width = 320,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [rect, setRect] = React.useState<{ top: number; left: number; right: number } | null>(null);
  const anchorRef = React.useRef<HTMLDivElement | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + window.scrollY + 6, left: r.left + window.scrollX, right: r.right + window.scrollX });
    setOpen(true);
  };
  const scheduleHide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  React.useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <div ref={anchorRef} style={{ display: "inline-block" }} onMouseEnter={show} onMouseLeave={scheduleHide}>
      {trigger}
      {open &&
        rect &&
        createPortal(
          <div
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
            style={{
              position: "absolute",
              top: rect.top,
              ...(align === "right" ? { right: window.innerWidth - rect.right } : { left: rect.left }),
              width,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: 9,
              boxShadow: "var(--shadow-modal)",
              padding: 12,
              zIndex: 1000,
              animation: "ddpop .12s ease",
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
