"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// Drop-in replacement for <Input type="file"> that hides the native
// "No file chosen" label. Renders a button-styled label that opens the
// system picker; after selection shows the file name (or "N files
// selected" when multiple). Forwards the ref to the underlying input
// so existing code can read inputRef.current.files / .value.

export type FilePickerProps = Omit<
  React.ComponentProps<"input">,
  "type" | "ref"
> & {
  label?: string;
  // Increment from the parent to force-clear the picker (both the
  // input's selected file and the visible filename label). The key
  // prop remount also covers this, but some parents see the ghost
  // label survive the remount in production builds — having an
  // explicit effect-based reset closes that gap.
  forceReset?: number;
};

export const FilePicker = React.forwardRef<HTMLInputElement, FilePickerProps>(
  function FilePicker(
    {
      className,
      label = "Choose File",
      onChange,
      multiple,
      forceReset,
      ...props
    },
    forwardedRef,
  ) {
    const internalRef = React.useRef<HTMLInputElement | null>(null);
    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        internalRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );
    const [selectedLabel, setSelectedLabel] = React.useState<string | null>(
      null,
    );

    // Whenever the parent bumps forceReset, clear both the underlying
    // input's value and the visible filename label.
    React.useEffect(() => {
      if (forceReset == null || forceReset === 0) return;
      if (internalRef.current) internalRef.current.value = "";
      setSelectedLabel(null);
    }, [forceReset]);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const files = e.currentTarget.files;
      if (!files || files.length === 0) {
        setSelectedLabel(null);
      } else if (files.length === 1) {
        setSelectedLabel(files[0].name);
      } else {
        setSelectedLabel(`${files.length} files selected`);
      }
      onChange?.(e);
    }

    return (
      <label
        className={cn(
          "inline-flex h-8 max-w-full cursor-pointer items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 hover:bg-input/40",
          className,
        )}
      >
        <span className="inline-flex h-6 items-center rounded-md bg-foreground/10 px-2 text-xs font-medium text-foreground">
          {label}
        </span>
        <span className="truncate text-foreground/70">
          {selectedLabel ?? ""}
        </span>
        <input
          ref={setRefs}
          type="file"
          multiple={multiple}
          onChange={handleChange}
          className="sr-only"
          {...props}
        />
      </label>
    );
  },
);
