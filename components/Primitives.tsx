// app/components/Primitives.tsx
"use client";

import * as React from "react";

function cn(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(" ");
}

/* -------- Card -------- */
export type CardProps = React.HTMLAttributes<HTMLDivElement>;
export function Card({ className, ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn("rounded-2xl bg-white ring-1 ring-slate-200", className)}
    />
  );
}

/* -------- SectionTitle -------- */
export type SectionTitleProps = React.HTMLAttributes<HTMLHeadingElement>;
export function SectionTitle({ className, ...props }: SectionTitleProps) {
  return (
    <h2
      {...props}
      className={cn("text-gray-900 text-lg font-semibold", className)}
    />
  );
}

/* -------- Badge -------- */
export function Badge({
  tone = "gray",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "blue" | "green" | "red" | "gray";
}) {
  const map: Record<NonNullable<typeof tone>, string> = {
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    gray: "bg-gray-50 text-gray-700 ring-gray-200",
  };
  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ring-1",
        map[tone],
        className
      )}
    />
  );
}
