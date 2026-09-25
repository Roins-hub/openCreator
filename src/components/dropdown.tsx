"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** 选项右侧的小标签,例如模型类型 */
  hint?: string;
  /** 同组选项会归到同一个小标题下 */
  group?: string;
}

/**
 * 替代原生 <select> 的下拉框:跟随主题配色,支持键盘(↑↓ / Home / End / Enter / Esc)。
 */
export function Dropdown<T extends string>({
  value, options, onChange, ariaLabel, placeholder = "请选择", className = "", renderValue,
}: {
  value: T | "";
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  renderValue?: (option: DropdownOption<T> | undefined) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const openList = () => {
    if (!options.length) return;
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    const last = options.length - 1;
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(last, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(last); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(active); }
    else if (event.key === "Tab") setOpen(false);
  };

  return (
    <div className={`dropdown ${open ? "is-open" : ""} ${className}`} ref={rootRef}>
      <button type="button" className="dropdown-trigger" role="combobox" aria-label={ariaLabel}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openList())} onKeyDown={onKeyDown}>
        <span className="dropdown-value">
          {renderValue ? renderValue(selected) : selected?.label || <span className="dropdown-placeholder">{placeholder}</span>}
        </span>
        <ChevronDown size={14} className="dropdown-chevron" />
      </button>
      {open && (
        <div className="dropdown-list" role="listbox" id={listId} aria-label={ariaLabel} ref={listRef}>
          {options.map((option, index) => {
            const header = option.group && option.group !== options[index - 1]?.group ? option.group : undefined;
            return (
              <div key={option.value}>
                {header && <div className="dropdown-group">{header}</div>}
                <div role="option" data-index={index} aria-selected={option.value === value}
                  className={`dropdown-option ${index === active ? "is-active" : ""} ${option.value === value ? "is-selected" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}>
                  <span className="dropdown-option-label">{option.label}</span>
                  {option.hint && <span className="dropdown-option-hint">{option.hint}</span>}
                  <Check size={14} className="dropdown-check" aria-hidden="true" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
