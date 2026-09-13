"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  optional,
  error,
  children,
  htmlFor,
}: {
  label: string;
  /** Only when it adds something the label doesn't. */
  hint?: React.ReactNode;
  /** Marked with an asterisk. */
  required?: boolean;
  /** Marked "Optional", so a field that is neither starred nor labelled
   *  never leaves someone guessing whether they can skip it. */
  optional?: boolean;
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
        {optional ? (
          <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: "var(--quiet)" }}>
            Optional
          </span>
        ) : null}
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

/**
 * Shared dropdown surface.
 *
 * Rendered into <body> rather than next to the field, which is not a
 * detail: `backdrop-filter` can only blur what was painted *underneath*
 * it. In the form, everything after the field -- the next input, the
 * Continue button -- paints later, so it was never part of the menu's
 * backdrop. A z-index put the menu on top of those, but they arrived
 * unblurred behind a translucent panel, so a button read straight
 * through a list that was supposed to have your attention. No amount of
 * blur fixes that; only being last in the paint order does.
 *
 * Portalling also stops the menu being clipped by any scrolling ancestor,
 * which is the other half of why production comboboxes all do this.
 *
 * The cost is that position has to be measured rather than inherited,
 * and re-measured when anything moves -- hence the scroll listener in
 * the capture phase, which catches scrolling in any container, not just
 * the window.
 */
function Menu({
  id,
  anchor,
  menuRef,
  children,
  onMouseDown,
}: {
  id: string;
  anchor: React.RefObject<HTMLElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  onMouseDown?: () => void;
}) {
  const [box, setBox] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    function measure() {
      const el = anchor.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const gap = 6;
      const below = window.innerHeight - rect.bottom - gap - 8;
      const above = rect.top - gap - 8;
      // Flip up only when below is genuinely too cramped AND above is
      // better, so a field near the bottom of a long form still opens
      // the way people expect everywhere else.
      const flip = below < 220 && above > below;
      setBox({
        left: rect.left,
        width: rect.width,
        ...(flip
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
        maxHeight: Math.max(140, Math.min(320, flip ? above : below)),
      });
    }
    measure();
    // Capture phase: a scroll inside .cw-main does not bubble to window,
    // and a menu left behind by its own field is worse than no menu.
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [anchor]);

  if (!box || typeof document === "undefined") return null;

  return createPortal(
    <div
      id={id}
      ref={menuRef}
      role="listbox"
      onMouseDown={(e) => {
        // Keep focus in the input so blur doesn't close the menu before
        // the click registers -- the classic dropdown-that-won't-click bug.
        e.preventDefault();
        onMouseDown?.();
      }}
      style={{
        position: "fixed",
        zIndex: 90,
        left: box.left,
        width: box.width,
        top: box.top,
        bottom: box.bottom,
        maxHeight: box.maxHeight,
        overflowY: "auto",
        border: "1px solid var(--rim2)",
        borderRadius: "var(--r-ctl)",
        // Glass, which is a narrower target than it sounds. Nearly
        // opaque and it reads as a black rectangle pasted over the
        // interface -- the one element that ignores the material
        // everything else is made of. Too thin and the page behind stays
        // legible through the list, so two things compete for the same
        // pixels and neither wins.
        //
        // Enough body to take the contrast out, and enough blur that
        // what does come through arrives as colour rather than as text.
        // The saturate keeps that colour alive instead of letting the
        // blur grey it out, which is the difference between glass and
        // frosted plastic.
        background: "var(--menu)",
        backdropFilter: "blur(52px) saturate(190%)",
        WebkitBackdropFilter: "blur(52px) saturate(190%)",
        // The inner hairline gives the edge thickness -- without it the
        // panel looks printed on rather than laid over.
        boxShadow:
          "var(--hi), inset 0 0 0 1px rgba(255,255,255,.04), 0 28px 70px -24px rgba(0,0,0,.95)",
        padding: 5,
      }}
    >
      {children}
    </div>,
    document.body,
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

/** The chevron that marks a field as a dropdown, and turns over when
 *  it is open. Inert to the pointer so it never eats a click meant for
 *  the input underneath it. */
function Caret({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        right: 12,
        top: 22,
        transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
        transition: "transform var(--t)",
        pointerEvents: "none",
        display: "flex",
        color: "var(--quiet)",
      }}
    >
      <svg width="11" height="7" viewBox="0 0 11 7" fill="none">
        <path
          d="M1 1.5 5.5 6 10 1.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
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
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();

  // What the input shows: the committed value when closed, the search
  // term while open.
  const selected = options.find((o) => o.value === value);
  const shown = open ? draft : strict ? (selected?.label ?? "") : value;

  const matches = useMemo(() => {
    const term = draft.trim().toLowerCase();
    const pool = term
      ? options.filter((o) =>
          // `search` carries what someone actually types but the label
          // does not show: a country, a nearby city, an abbreviation.
          // Without it "India" matched nothing in a list of 418 time
          // zones, because the row is spelled "Asia/Calcutta".
          [o.label, o.value, o.hint, o.search]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(term)),
        )
      : options;
    return pool.slice(0, maxVisible);
  }, [draft, options, maxVisible]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(event: MouseEvent) {
      const target = event.target as Node;
      // The menu is portalled into <body>, so it is no longer inside
      // `wrap` -- checking only that would treat every click on an
      // option as a click outside and close the list before it landed.
      if (wrap.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
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
        // Only while the list exists: pointing at an element that is not
        // in the document is worse for a screen reader than pointing at
        // nothing.
        aria-controls={open ? listId : undefined}
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
        style={{
          cursor: strict && !open ? "pointer" : "text",
          // Room for the chevron, so a long value does not run underneath it.
          paddingRight: 34,
        }}
      />

      {/* Without this nothing on screen says the field has a list behind
          it -- it looks like a text box, so people type into it and never
          discover the options. */}
      <Caret open={open} />

      {open && (
        <Menu id={listId} anchor={wrap} menuRef={menu}>
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
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();

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
      const target = event.target as Node;
      // See the same handler in Combobox: the menu lives in <body> now.
      if (wrap.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
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
    // Picking one is the end of that interaction. Leaving the list up
    // meant it sat over the chips that had just been added, so you could
    // not see the thing you had chosen -- and the next keystroke brings
    // it straight back anyway.
    setOpen(false);
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
          // Focus does not fire again after picking a skill -- the input
          // never lost it -- so without this the list could only be
          // brought back by typing. Clicking the field is the other way
          // people expect to ask for it.
          onClick={() => setOpen(true)}
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
        <Menu id={listId} anchor={wrap} menuRef={menu}>
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
