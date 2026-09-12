"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Option } from "@/lib/reference";

/**
 * Form primitives.
 *
 * Two rules run through all of them. First, a label earns its hint only
 * if the hint says something the label does not -- most fields here have
 * no description at all, because "Full name" does not need explaining.
 * Second, anything that offers choices still accepts free text, because
 * the person typing "Shopify performance specialist" knows their market
 * better than any list does.
 */

export function Field({
  label,
  hint,
  required,
  error,
  children,
  htmlFor,
}: {
  label: string;
  /** Only when it adds something the label doesn't. */
  hint?: React.ReactNode;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        style={{ display: "block", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
      >
        {label}
        {required ? <span style={{ color: "var(--orange-ink)" }}> *</span> : null}
      </label>
      {hint ? (
        <div style={{ marginTop: 3, fontSize: 12, color: "var(--quiet)", lineHeight: 1.5 }}>
          {hint}
        </div>
      ) : null}
      <div style={{ marginTop: 8 }}>{children}</div>
      {error ? (
        <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--bad)" }}>{error}</div>
      ) : null}
    </div>
  );
}

/** Shared dropdown surface. */
function Menu({ children, onMouseDown }: { children: React.ReactNode; onMouseDown?: () => void }) {
  return (
    <div
      onMouseDown={(e) => {
        // Keep focus in the input so blur doesn't close the menu before
        // the click registers -- the classic dropdown-that-won't-click bug.
        e.preventDefault();
        onMouseDown?.();
      }}
      style={{
        position: "absolute",
        zIndex: 40,
        top: "calc(100% + 6px)",
        left: 0,
        right: 0,
        maxHeight: 280,
        overflowY: "auto",
        border: "1px solid var(--rim2)",
        borderRadius: "var(--r-ctl)",
        background: "var(--menu)",
        backdropFilter: "blur(24px)",
        boxShadow: "var(--hi), 0 24px 60px -30px rgba(0,0,0,.9)",
        padding: 5,
      }}
    >
      {children}
    </div>
  );
}

function Row({
  active,
  onClick,
  children,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        border: 0,
        borderRadius: 9,
        padding: "9px 11px",
        fontFamily: "inherit",
        fontSize: 13.5,
        cursor: "pointer",
        background: active ? "var(--glass2)" : "transparent",
        color: "var(--ink)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {hint ? (
        <span className="cw-mono" style={{ flex: "none", fontSize: 11, color: "var(--quiet)" }}>
          {hint}
        </span>
      ) : null}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="cw-label" style={{ padding: "10px 11px 6px" }}>
      {children}
    </div>
  );
}

/**
 * A text input with suggestions. Type to filter, click or Enter to pick,
 * or just keep typing and submit something that isn't on the list.
 *
 * `strict` makes it a real dropdown instead -- used for time zone and
 * currency, where a value that isn't in the list is simply wrong and
 * would break formatting downstream.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  strict = false,
  id,
  maxVisible = 60,
}: {
  value: string;
  onChange: (next: string) => void;
  options: Option[];
  placeholder?: string;
  strict?: boolean;
  id?: string;
  maxVisible?: number;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  // What the input shows: the committed value when closed, the search
  // term while open.
  const selected = options.find((o) => o.value === value);
  const shown = open ? draft : strict ? (selected?.label ?? "") : value;

  const matches = useMemo(() => {
    const term = draft.trim().toLowerCase();
    const pool = term
      ? options.filter(
          (o) => o.label.toLowerCase().includes(term) || o.value.toLowerCase().includes(term),
        )
      : options;
    return pool.slice(0, maxVisible);
  }, [draft, options, maxVisible]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  function commit(option: Option) {
    onChange(option.value);
    setOpen(false);
    setDraft("");
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) =>
        Math.max(0, Math.min(matches.length - 1, h + (event.key === "ArrowDown" ? 1 : -1))),
      );
    } else if (event.key === "Enter") {
      if (open && matches[highlight]) {
        event.preventDefault();
        commit(matches[highlight]);
      } else if (!strict) {
        setOpen(false);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setDraft("");
    }
  }

  let lastGroup: string | undefined;

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <input
        id={id}
        className="cw-input"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={shown}
        placeholder={placeholder}
        readOnly={strict && !open}
        onFocus={() => {
          setOpen(true);
          setDraft("");
          setHighlight(0);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setHighlight(0);
          setOpen(true);
          // Free-text mode commits as you type, so a value that is not on
          // the list still survives leaving the field.
          if (!strict) onChange(e.target.value);
        }}
        onKeyDown={onKeyDown}
        style={{ cursor: strict && !open ? "pointer" : "text" }}
      />

      {open && (
        <Menu>
          {matches.length === 0 ? (
            <div style={{ padding: "12px 11px", fontSize: 13, color: "var(--quiet)" }}>
              {strict ? "No match." : "Nothing on the list — what you typed will be used."}
            </div>
          ) : (
            matches.map((option, index) => {
              const header = option.group && option.group !== lastGroup ? option.group : null;
              lastGroup = option.group;
              return (
                <div key={`${option.value}-${index}`}>
                  {header && <GroupLabel>{header}</GroupLabel>}
                  <Row
                    active={index === highlight}
                    hint={option.hint}
                    onClick={() => commit(option)}
                  >
                    {option.label}
                  </Row>
                </div>
              );
            })
          )}
        </Menu>
      )}
    </div>
  );
}

/**
 * Skills, as removable chips with suggestions.
 *
 * A duplicate is never offered and never accepted -- adding "Python"
 * twice makes the scorer weight it twice for no reason, and looks
 * careless on a profile a client might see.
 */
export function TagInput({
  values,
  onChange,
  suggestions,
  placeholder,
  id,
  max = 20,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  id?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  const lower = useMemo(() => new Set(values.map((v) => v.toLowerCase())), [values]);

  const matches = useMemo(() => {
    const term = draft.trim().toLowerCase();
    return suggestions
      .filter((s) => !lower.has(s.toLowerCase()))
      .filter((s) => (term ? s.toLowerCase().includes(term) : true))
      .slice(0, 40);
  }, [draft, suggestions, lower]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  function add(raw: string) {
    const skill = raw.trim().replace(/,+$/, "").trim();
    if (!skill) return;
    if (lower.has(skill.toLowerCase())) {
      // Already there. Clear the draft rather than silently doing
      // nothing, so it is obvious the input was understood.
      setDraft("");
      return;
    }
    if (values.length >= max) return;
    onChange([...values, skill]);
    setDraft("");
    setHighlight(0);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" || event.key === "," || event.key === "Tab") {
      if (open && matches[highlight] && !draft.trim()) return;
      if (draft.trim()) {
        event.preventDefault();
        add(open && matches[highlight] && matches[highlight].toLowerCase().startsWith(draft.trim().toLowerCase())
          ? matches[highlight]
          : draft);
      }
    } else if (event.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) =>
        Math.max(0, Math.min(matches.length - 1, h + (event.key === "ArrowDown" ? 1 : -1))),
      );
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <div
        onClick={() => document.getElementById(id ?? "")?.focus()}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 7,
          border: "1px solid var(--rim)",
          background: "var(--glass)",
          borderRadius: "var(--r-ctl)",
          padding: "8px 10px",
          boxShadow: "var(--hi)",
          cursor: "text",
          minHeight: 44,
        }}
      >
        {values.map((skill) => (
          <span
            key={skill}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid var(--rim2)",
              background: "var(--glass2)",
              borderRadius: 999,
              padding: "5px 6px 5px 11px",
              fontSize: 12.5,
            }}
          >
            {skill}
            <button
              type="button"
              aria-label={`Remove ${skill}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(values.filter((v) => v !== skill));
              }}
              style={{
                border: 0,
                background: "none",
                color: "var(--quiet)",
                cursor: "pointer",
                lineHeight: 1,
                padding: "2px 4px",
                fontSize: 14,
              }}
            >
              ×
            </button>
          </span>
        ))}

        <input
          id={id}
          value={draft}
          placeholder={values.length ? "" : placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const next = e.target.value;
            // A pasted comma-separated list is a normal thing to do.
            if (next.includes(",")) {
              next.split(",").forEach(add);
              return;
            }
            setDraft(next);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          style={{
            flex: "1 1 120px",
            minWidth: 80,
            border: 0,
            outline: 0,
            background: "none",
            fontFamily: "inherit",
            fontSize: 13.5,
            color: "var(--ink)",
            padding: "4px 2px",
          }}
        />
      </div>

      {open && matches.length > 0 && (
        <Menu>
          {matches.map((skill, index) => (
            <Row key={skill} active={index === highlight} onClick={() => add(skill)}>
              {skill}
            </Row>
          ))}
        </Menu>
      )}
    </div>
  );
}

/** A number input with a fixed unit or symbol attached, so the two never
 *  drift out of alignment the way two separate boxes do. */
export function NumberField({
  value,
  onChange,
  prefix,
  suffix,
  placeholder,
  min,
  max,
  id,
}: {
  value: number | null | undefined;
  onChange: (next: number | null) => void;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  placeholder?: string;
  min?: number;
  max?: number;
  id?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        border: "1px solid var(--rim)",
        background: "var(--glass)",
        borderRadius: "var(--r-ctl)",
        boxShadow: "var(--hi)",
        overflow: "hidden",
      }}
    >
      {prefix ? (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 4px 0 13px",
            fontSize: 13.5,
            color: "var(--quiet)",
            flex: "none",
          }}
        >
          {prefix}
        </span>
      ) : null}
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{
          flex: 1,
          minWidth: 0,
          border: 0,
          outline: 0,
          background: "none",
          fontFamily: "inherit",
          fontSize: 13.5,
          color: "var(--ink)",
          padding: prefix ? "11px 13px 11px 4px" : "11px 13px",
        }}
      />
      {suffix ? (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 13px",
            fontSize: 13,
            color: "var(--quiet)",
            borderLeft: "1px solid var(--rim)",
            flex: "none",
            whiteSpace: "nowrap",
          }}
        >
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

/** A single-line text input with a real, enforced maximum. */
export function TextField({
  value,
  onChange,
  placeholder,
  maxLength,
  id,
  multiline,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  id?: string;
  multiline?: boolean;
}) {
  const over = maxLength != null && value.length > maxLength;
  const common = {
    id,
    className: "cw-input",
    value,
    placeholder,
    // Enforced by the browser AND checked in validation -- maxLength
    // alone is bypassable by paste in some browsers, and a field that
    // displays "0/160" while accepting 523 characters is lying.
    maxLength,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(maxLength ? e.target.value.slice(0, maxLength) : e.target.value),
    style: over ? { borderColor: "var(--bad)" } : undefined,
  };

  return (
    <div>
      {multiline ? (
        <textarea {...common} style={{ ...common.style, minHeight: 84, resize: "vertical" }} />
      ) : (
        <input {...common} />
      )}
      {maxLength != null && (
        <div
          className="cw-mono"
          style={{
            marginTop: 6,
            fontSize: 11,
            textAlign: "right",
            color: over ? "var(--bad)" : value.length > maxLength * 0.85 ? "var(--warn)" : "var(--quiet)",
          }}
        >
          {value.length}/{maxLength}
        </div>
      )}
    </div>
  );
}

export function useFieldId(prefix: string) {
  const id = useId();
  return `${prefix}-${id}`;
}
