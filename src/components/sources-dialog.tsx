"use client";
import { useEffect, useRef } from "react";
import { ArrowRight, Database, ExternalLink, Info, X } from "lucide-react";
import { CATALOG_GROUPS as GROUPS } from "@/lib/constants";
import { utcDate, utcTime } from "@/lib/format";
import type { CatalogResponse, SatelliteRecord } from "@/lib/types";

export function SourcesDialog({
  catalog,
  selected,
  onClose,
}: {
  catalog: CatalogResponse | null;
  selected: SatelliteRecord | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sources-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="sources-title"
    >
      <div className="sources-content">
        <div className="sources-heading">
          <span className="eyebrow">
            <Database size={13} /> MODEL & PROVENANCE
          </span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close data sources"
          >
            <X size={19} />
          </button>
        </div>
        <h2 id="sources-title">A prediction. With perspective.</h2>
        <p>
          Every position in ORBITAL is calculated from public orbital elements.
          These values are model estimates, never measurements from a satellite.
        </p>
        <dl>
          <div>
            <dt>Current catalog</dt>
            <dd>
              {catalog
                ? GROUPS.find((item) => item.value === catalog.group)?.label
                : "Not loaded"}
            </dd>
          </div>
          <div>
            <dt>Element source</dt>
            <dd>
              {catalog?.source === "demo"
                ? "Bundled CelesTrak snapshot · DEMO"
                : catalog?.source === "cache"
                  ? "Last-known CelesTrak cache"
                  : catalog
                    ? "CelesTrak GP / TLE"
                    : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Retrieved (UTC)</dt>
            <dd className="mono">
              {catalog
                ? `${utcDate(catalog.fetchedAt)} ${utcTime(catalog.fetchedAt, true)}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Selected element epoch</dt>
            <dd className="mono">
              {selected
                ? `${utcDate(selected.epoch)} ${utcTime(selected.epoch, true)} UTC`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Propagation / reference</dt>
            <dd>satellite.js · SGP4 / WGS 84 geodetic</dd>
          </div>
        </dl>
        {catalog?.notice && (
          <div className="sources-notice">
            <Info size={15} />
            <span>{catalog.notice}</span>
          </div>
        )}
        <div className="source-limitations">
          <h3>How to read the forecast</h3>
          <p>
            Passes indicate geometric line of sight above the chosen elevation
            threshold. Sunlight, Earth shadow, weather, atmospheric refraction,
            and terrain obstruction are not evaluated. A predicted pass is not a
            guarantee of optical visibility.
          </p>
          <p>
            Accuracy decreases away from an element’s epoch and after maneuvers.
            Elements more than 3 days from simulation time are flagged. Catalogs
            are cached for two hours. Legacy TLE format only supports five-digit
            catalog numbers.
          </p>
          <p>
            The Earth uses NASA Blue Marble imagery. Orbit lines show one
            revolution in an Earth-fixed frame; lighting is illustrative.
            Observer altitude is treated as an approximate WGS 84 height.
          </p>
        </div>
        <div className="sources-links">
          <a
            href="https://celestrak.org/NORAD/documentation/gp-data-formats.php"
            target="_blank"
            rel="noreferrer"
          >
            CelesTrak GP data <ExternalLink size={12} />
          </a>
          <a
            href="https://github.com/shashwatak/satellite-js"
            target="_blank"
            rel="noreferrer"
          >
            satellite.js <ExternalLink size={12} />
          </a>
          <a
            href="https://visibleearth.nasa.gov/collection/1484/blue-marble"
            target="_blank"
            rel="noreferrer"
          >
            NASA imagery <ExternalLink size={12} />
          </a>
        </div>
        <button className="primary-button dialog-done" onClick={onClose}>
          Back to mission control <ArrowRight size={14} />
        </button>
      </div>
    </dialog>
  );
}
