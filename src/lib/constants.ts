import type { CatalogGroup, Observer } from "./types";

export const DEFAULT_OBSERVER: Observer = {
  latitude: 51.1694,
  longitude: 71.4491,
  altitudeKm: 0.347,
};
export const CATALOG_GROUPS: { value: CatalogGroup; label: string }[] = [
  { value: "featured", label: "Featured satellites" },
  { value: "stations", label: "Space stations" },
  { value: "weather", label: "Weather satellites" },
  { value: "science", label: "Science & exploration" },
];

// Catalog membership does not imply that a spacecraft remains operational.
export const FEATURED_IDS = [
  25544, 48274, 20580, 25994, 27424, 39766, 43641, 46265, 57800, 42758, 59588,
  16908, 31598, 27386, 28931, 29228, 24883, 10967, 21574, 27597,
];
