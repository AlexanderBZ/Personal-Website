"use client";

import { useEffect, useState } from "react";
import { SITE_CONFIG } from "@/lib/site";

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: SITE_CONFIG.timeZone,
});

const goldenGateIcon = (
  <svg
    viewBox="0 0 26 14"
    width="20"
    height="11"
    fill="none"
    stroke="#C0362C"
    strokeWidth="1.3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="-mt-px"
  >
    <path d="M1 9.5C4 8.2 6 6 7.5 2M7.5 2C10 8.6 16 8.6 18.5 2M18.5 2C20 6 22 8.2 25 9.5" />
    <path
      d="M10.5 6.4V10M13 7.1V10M15.5 6.4V10M4.5 7.9V10M21.5 7.9V10"
      strokeWidth="0.8"
      opacity="0.7"
    />
    <path d="M7.5 1.5V13M18.5 1.5V13M6.6 3.6H8.4M6.6 6.2H8.4M17.6 3.6H19.4M17.6 6.2H19.4" />
    <path d="M1 10H25" />
  </svg>
);

/** Static local time in San Francisco, rendered client-side to avoid hydration mismatch. */
export default function LocalTime() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      setTime(timeFormatter.format(new Date()));
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    <span
      data-ready={Boolean(time)}
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
    >
      {goldenGateIcon}
      {SITE_CONFIG.location}
      {time ? <span className="tabular-nums">· {time}</span> : null}
    </span>
  );
}
