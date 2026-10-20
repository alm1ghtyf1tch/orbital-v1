export function utcTime(
  value: Date | string | number,
  seconds = false,
): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toISOString().slice(11, seconds ? 19 : 16);
}

export function utcDate(value: Date | string | number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    })
    .toUpperCase();
}

export function coordinate(
  value: number,
  kind: "latitude" | "longitude",
  digits = 2,
): string {
  const direction =
    kind === "latitude" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(digits)}° ${direction}`;
}

export function countdown(target: string, now: number): string {
  const seconds = Math.max(
    0,
    Math.ceil((new Date(target).getTime() - now) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function duration(start: string, end: string): string {
  const seconds = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000),
  );
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function cardinal(degrees: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
    Math.round(degrees / 45) % 8
  ];
}

export function friendlyName(name: string): string {
  if (name.startsWith("ISS")) return "International Space Station";
  return name;
}
