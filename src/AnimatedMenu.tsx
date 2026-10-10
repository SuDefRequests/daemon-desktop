import { useEffect, useState, type ReactNode } from "react";

/** Retain a closing menu only until its CSS exit animation finishes. */
export default function AnimatedMenu({
  open,
  className,
  children,
}: {
  open: boolean;
  className: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  if (!open && !mounted) return null;
  return (
    <div
      className={`${className} animated-menu ${open ? "entering" : "exiting"}`}
      inert={!open}
      aria-hidden={!open}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && !open) setMounted(false);
      }}
    >
      {children}
    </div>
  );
}
