import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";

/**
 * Layout primitives.
 *
 * Spacing between things is a layout decision, so it is expressed once here in
 * token steps rather than as a margin invented inside every component. `gap`
 * accepts a step from the spacing scale in tokens.css.
 */
export type Gap = 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 | 20;

type BoxProps = HTMLAttributes<HTMLElement> & { as?: ElementType; gap?: Gap; className?: string; children?: ReactNode };

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

/** Vertical flow. */
export function Stack({ as: Tag = "div", gap = 6, className, ...props }: BoxProps) {
  return <Tag className={classes("stack", `gap-${gap}`, className)} {...props} />;
}

/** Horizontal flow, vertically centred. */
export function Inline({ as: Tag = "div", gap = 4, wrap, className, ...props }: BoxProps & { wrap?: boolean }) {
  return <Tag className={classes("inline", `gap-${gap}`, wrap && "inline-wrap", className)} {...props} />;
}

/** A columns grid. `columns` is a template or a count. */
export function Grid({ as: Tag = "div", gap = 6, columns, minColumnWidth, className, style, ...props }: BoxProps & { columns?: number | string; minColumnWidth?: number; style?: CSSProperties }) {
  const template = minColumnWidth
    ? `repeat(auto-fill, minmax(${minColumnWidth}px, 1fr))`
    : typeof columns === "number" ? `repeat(${columns}, minmax(0, 1fr))` : columns;
  return <Tag className={classes("grid", `gap-${gap}`, className)} style={template ? { gridTemplateColumns: template, ...style } : style} {...props} />;
}

/** A rule between groups. Vertical inside toolbars, horizontal everywhere else. */
export function Divider({ orientation = "horizontal", className }: { orientation?: "horizontal" | "vertical"; className?: string }) {
  return <hr className={classes("divider", orientation === "vertical" && "divider-vertical", className)} aria-orientation={orientation} />;
}

/** An uppercase micro-label naming a group of controls. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={classes("caption", className)}>{children}</p>;
}
