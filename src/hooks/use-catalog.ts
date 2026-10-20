"use client";

import { useCallback, useEffect, useState } from "react";
import type { CatalogGroup, CatalogResponse } from "@/lib/types";

export function useCatalog() {
  const [group, setGroupState] = useState<CatalogGroup>("featured");
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
      const response = await fetch(`/api/catalog?group=${group}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
      const next = await response.json() as CatalogResponse;
      if (!Array.isArray(next.satellites) || !next.satellites.length) throw new Error("The catalog did not contain usable elements.");
      if (!controller.signal.aborted) setCatalog(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The catalog is unavailable.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [group, refreshKey]);

  const setGroup = useCallback((next: CatalogGroup) => {
    setGroupState(next);
    setCatalog(null);
    setLoading(true);
    setError(null);
  }, []);

  const refresh = () => {
    setLoading(true);
    setError(null);
    setRefreshKey((current) => current + 1);
  };
  return { group, setGroup, catalog, loading, error, refresh };
}
