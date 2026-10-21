import { useEffect, useRef, useState } from "react";

export interface MotionSelectOption {
  value: string;
  label: string;
}

interface MotionSelectProps {
  label: string;
  value: string;
  options: MotionSelectOption[];
  onChange(value: string): void;
}

export function MotionSelect({ label, value, options, onChange }: MotionSelectProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        container.current?.querySelector<HTMLButtonElement>(".motion-select-trigger")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={"motion-select" + (open ? " is-open" : "")} ref={container}>
      <button
        className="motion-select-trigger"
        type="button"
        aria-label={label + "，当前：" + (current?.label ?? value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            window.requestAnimationFrame(() => {
              container.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
            });
          }
        }}
      >
        <span>{current?.label ?? value}</span>
        <span className="motion-select-chevron" aria-hidden="true">⌄</span>
      </button>
      <div className="motion-select-menu" role="listbox" aria-label={label} aria-hidden={!open}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={value === option.value}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const buttons = [...container.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []];
                const index = buttons.indexOf(event.currentTarget);
                buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
              }
            }}
          >
            <span>{option.label}</span>
            {value === option.value && <span aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
