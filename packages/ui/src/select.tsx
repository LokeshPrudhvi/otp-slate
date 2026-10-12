import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  searchable?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export function Select({
  value,
  onChange,
  options,
  id,
  name,
  disabled,
  required,
  placeholder = "Select an option",
  searchable = options.length > 8,
  className = "",
  ...aria
}: SelectProps) {
  const generatedId = useId();
  const controlId = id || `admin-select-${generatedId}`;
  const listId = `${controlId}-options`;
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 240,
    maxHeight: 340,
  });
  const filtered = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase().trim()),
  );
  const selected = options.find((option) => option.value === value);
  const activeOption = filtered[active];
  const accessibleLabel = aria["aria-label"] || "Options";

  const close = (restoreFocus = false) => {
    setOpen(false);
    setSearch("");
    if (restoreFocus) trigger.current?.focus();
  };
  const show = (last = false) => {
    if (trigger.current?.matches(":disabled")) return;
    setSearch("");
    const selectedIndex = options.findIndex(
      (option) => option.value === value && !option.disabled,
    );
    setActive(
      selectedIndex >= 0
        ? selectedIndex
        : last
          ? options.reduce(
              (lastIndex, option, index) =>
                option.disabled ? lastIndex : index,
              -1,
            )
          : options.findIndex((option) => !option.disabled),
    );
    setOpen(true);
  };
  const choose = (option: SelectOption) => {
    if (option.disabled || trigger.current?.matches(":disabled")) return;
    onChange(option.value);
    setInvalid(Boolean(required && !option.value));
    close(true);
  };
  const move = (direction: 1 | -1, edge?: "first" | "last") => {
    const enabled = filtered
      .map((option, index) => (!option.disabled ? index : -1))
      .filter((index) => index >= 0);
    if (!enabled.length) return;
    const current = enabled.indexOf(active);
    const next =
      edge === "first"
        ? enabled[0]
        : edge === "last"
          ? enabled[enabled.length - 1]
          : enabled[
              current < 0
                ? direction === 1
                  ? 0
                  : enabled.length - 1
                : (current + direction + enabled.length) % enabled.length
            ];
    setActive(next);
  };
  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement | HTMLInputElement>,
  ) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      if (open) close(event.currentTarget === searchInput.current);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show(event.key === "ArrowUp");
      else move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (
      open &&
      (event.key === "Home" || event.key === "End") &&
      (event.currentTarget !== searchInput.current || event.ctrlKey)
    ) {
      event.preventDefault();
      move(1, event.key === "Home" ? "first" : "last");
      return;
    }
    if (
      event.key === "Enter" ||
      (event.key === " " && event.currentTarget !== searchInput.current)
    ) {
      event.preventDefault();
      if (!open) show();
      else if (activeOption && !activeOption.disabled) choose(activeOption);
      return;
    }
    if (
      event.currentTarget === searchInput.current ||
      event.key.length !== 1 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    event.preventDefault();
    const now = Date.now();
    const text =
      now - typeahead.current.time > 650
        ? event.key
        : typeahead.current.text + event.key;
    typeahead.current = { text, time: now };
    const query = [...text].every((character) => character === text[0])
      ? text[0]
      : text;
    const start = query.length === 1 ? active + 1 : 0;
    const ordered = filtered.map(
      (_, index) => (start + index) % filtered.length,
    );
    const next = ordered.find(
      (index) =>
        !filtered[index].disabled &&
        filtered[index].label.toLowerCase().startsWith(query.toLowerCase()),
    );
    if (next !== undefined) {
      setActive(next);
      if (!open) choose(filtered[next]);
    }
  };

  useEffect(() => {
    if (value) setInvalid(false);
  }, [value]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect || trigger.current?.matches(":disabled")) {
        setOpen(false);
        return;
      }
      const margin = 8;
      const below = window.innerHeight - rect.bottom - margin - 6;
      const above = rect.top - margin - 6;
      const desired = Math.min(
        340,
        filtered.length * 38 + 16 + (searchable ? 64 : 0),
      );
      const flip = below < desired && above > below;
      const maxHeight = Math.max(80, Math.min(340, flip ? above : below));
      const width = Math.min(
        window.innerWidth - margin * 2,
        Math.max(rect.width, 240),
      );
      const height = Math.min(
        popup.current?.scrollHeight || desired,
        maxHeight,
      );
      setPosition({
        left: Math.max(
          margin,
          Math.min(rect.left, window.innerWidth - width - margin),
        ),
        top: flip ? Math.max(margin, rect.top - height - 6) : rect.bottom + 6,
        width,
        maxHeight,
      });
    };
    place();
    const handleScroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", handleScroll, true);
    const observer = new ResizeObserver(place);
    if (trigger.current) observer.observe(trigger.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", handleScroll, true);
      observer.disconnect();
    };
  }, [open, filtered.length, searchable]);

  useEffect(() => {
    if (!open) return;
    if (searchable) searchInput.current?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !trigger.current?.contains(target) &&
        !popup.current?.contains(target)
      )
        close();
    };
    const fieldsets: Element[] = [];
    let ancestor = trigger.current?.parentElement;
    while (ancestor) {
      if (ancestor.tagName === "FIELDSET") fieldsets.push(ancestor);
      ancestor = ancestor.parentElement;
    }
    const observer = new MutationObserver(() => {
      if (trigger.current?.matches(":disabled")) close();
    });
    fieldsets.forEach((fieldset) =>
      observer.observe(fieldset, {
        attributes: true,
        attributeFilter: ["disabled"],
      }),
    );
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      observer.disconnect();
    };
  }, [open, searchable]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${listId}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);

  return (
    <span className={`admin-select ${className}`}>
      <button
        ref={trigger}
        id={controlId}
        type="button"
        className="admin-select-trigger"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && !searchable && activeOption
            ? `${listId}-${active}`
            : undefined
        }
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        {...aria}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
      >
        <span
          className={`admin-select-value${!selected || !selected.value ? " is-placeholder" : ""}`}
        >
          {selected?.label || placeholder}
        </span>
        <svg
          className="admin-select-chevron"
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m5 7.5 5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {/* Retain browser form values/validation without exposing an operating-system menu. */}
      <select
        className="admin-select-native"
        aria-hidden="true"
        tabIndex={-1}
        name={name}
        value={value}
        disabled={disabled}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          trigger.current?.focus();
          show();
        }}
      >
        {!options.some((option) => option.value === "") && (
          <option value="">{placeholder}</option>
        )}
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      {invalid && (
        <span className="admin-select-validation" role="alert">
          Please select an option.
        </span>
      )}
      {open &&
        createPortal(
          <div ref={popup} className="admin-select-popup" style={position}>
            {searchable && (
              <div className="admin-select-search">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="8.5"
                    cy="8.5"
                    r="5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="m12.5 12.5 4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  ref={searchInput}
                  type="search"
                  value={search}
                  placeholder="Search options…"
                  aria-label={`Search ${accessibleLabel.toLowerCase()}`}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    activeOption ? `${listId}-${active}` : undefined
                  }
                  onChange={(event) => {
                    setSearch(event.target.value);
                    const next = options
                      .filter((option) =>
                        option.label
                          .toLowerCase()
                          .includes(event.target.value.toLowerCase().trim()),
                      )
                      .findIndex((option) => !option.disabled);
                    setActive(next);
                  }}
                  onKeyDown={onKeyDown}
                  autoComplete="off"
                />
              </div>
            )}
            <div
              id={listId}
              role="listbox"
              aria-label={accessibleLabel}
              className="admin-select-options"
              aria-labelledby={aria["aria-labelledby"]}
            >
              {filtered.map((option, index) => (
                <div
                  id={`${listId}-${index}`}
                  key={option.value}
                  role="option"
                  title={option.label}
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  className={`admin-select-option${index === active ? " is-active" : ""}`}
                  onPointerMove={() => {
                    if (!option.disabled && active !== index) setActive(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span>
                    <span className="admin-select-option-label">
                      {option.label}
                    </span>
                  </span>
                  {option.value === value && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 20 20"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="m4 10 4 4 8-8"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
              ))}
              {!filtered.length && (
                <div className="admin-select-empty" role="status">
                  No matching options
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
