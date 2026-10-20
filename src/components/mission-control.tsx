"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Database,
  ExternalLink,
  Globe2,
  Hand,
  Info,
  Layers3,
  MapPin,
  Maximize2,
  Minus,
  Orbit,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Satellite,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCatalog } from "@/hooks/use-catalog";
import { useMissionClock } from "@/hooks/use-mission-clock";
import {
  getElementAgeDays,
  getOrbitTrack,
  getSatellitePosition,
} from "@/lib/orbits";
import { predictPasses } from "@/lib/passes";
import {
  cardinal,
  coordinate,
  countdown,
  duration,
  friendlyName,
  utcDate,
  utcTime,
} from "@/lib/format";
import type { CatalogGroup, Observer, SatellitePosition } from "@/lib/types";
import type { HandCameraInput, HandMotion } from "@/lib/hand-types";
import { GlobeBoundary } from "./globe-boundary";
import { DEFAULT_OBSERVER, CATALOG_GROUPS as GROUPS } from "@/lib/constants";
import { ObserverForm } from "./observer-form";
import { PassCurve } from "./pass-curve";
import { SourcesDialog } from "./sources-dialog";

const EarthGlobe = dynamic(() => import("./earth-globe"), {
  ssr: false,
  loading: () => (
    <div className="globe-loading">
      <span className="loading-orbit">
        <Orbit size={44} strokeWidth={1} />
      </span>
      <span>INITIALIZING EARTH VIEW</span>
    </div>
  ),
});

const HandControls = dynamic(() => import("./hand-controls"), { ssr: false });

export default function MissionControl() {
  const { group, setGroup, catalog, loading, error, refresh } = useCatalog();
  const clock = useMissionClock();
  const [selectedId, setSelectedId] = useState("25544");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"control" | "passes">("control");
  const [observer, setObserver] = useState<Observer>(DEFAULT_OBSERVER);
  const [observerName, setObserverName] = useState("Astana, Kazakhstan");
  const [editingObserver, setEditingObserver] = useState(false);
  const [minElevation, setMinElevation] = useState(10);
  const [showOrbits, setShowOrbits] = useState(true);
  const [showGroundTrack, setShowGroundTrack] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const [zoomCommand, setZoomCommand] = useState<{
    direction: "in" | "out";
    nonce: number;
  } | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [handControlsOpen, setHandControlsOpen] = useState(false);
  const handInput = useRef<HandCameraInput>({
    active: false,
    updatedAt: 0,
    rotateX: 0,
    rotateY: 0,
    zoom: 0,
  });
  const publishHandMotion = useCallback((motion: HandMotion) => {
    const mailbox = handInput.current;
    mailbox.rotateX = Math.max(
      -0.12,
      Math.min(0.12, mailbox.rotateX + motion.rotateX),
    );
    mailbox.rotateY = Math.max(
      -0.12,
      Math.min(0.12, mailbox.rotateY + motion.rotateY),
    );
    mailbox.zoom = Math.max(-0.12, Math.min(0.12, mailbox.zoom + motion.zoom));
    mailbox.updatedAt = performance.now();
    if (motion.rotateX === 0 && motion.rotateY === 0 && motion.zoom === 0) {
      mailbox.rotateX = 0;
      mailbox.rotateY = 0;
      mailbox.zoom = 0;
    }
  }, []);
  const setHandActive = useCallback((active: boolean) => {
    const mailbox = handInput.current;
    mailbox.active = active;
    mailbox.updatedAt = active ? performance.now() : 0;
    mailbox.rotateX = 0;
    mailbox.rotateY = 0;
    mailbox.zoom = 0;
  }, []);
  const [exportNote, setExportNote] = useState("");
  const passSection = useRef<HTMLElement>(null);

  const satellites = useMemo(() => catalog?.satellites ?? [], [catalog]);
  const selected =
    satellites.find((satellite) => satellite.id === selectedId) ??
    satellites[0] ??
    null;
  const positionSecond = Math.floor(clock.timestamp / 1000);
  const time = useMemo(() => new Date(positionSecond * 1000), [positionSecond]);
  const positions = useMemo(
    () =>
      positionSecond
        ? satellites
            .map((satellite) => getSatellitePosition(satellite, time))
            .filter((p): p is SatellitePosition => p !== null)
        : [],
    [satellites, time, positionSecond],
  );
  const positionMap = useMemo(
    () => new Map(positions.map((position) => [position.id, position])),
    [positions],
  );
  const selectedPosition = selected
    ? (positionMap.get(selected.id) ?? null)
    : null;
  const predictionUnavailable = !loading && (!selected || !selectedPosition);
  const orbitStep = Math.floor(clock.timestamp / 30_000);
  const orbit = useMemo(
    () =>
      selected && orbitStep
        ? getOrbitTrack(selected, new Date(orbitStep * 30_000), { steps: 200 })
        : [],
    [selected, orbitStep],
  );
  const predictionMinute = Math.floor(clock.timestamp / 60_000);
  const allPasses = useMemo(
    () =>
      selected && predictionMinute
        ? predictPasses(
            selected,
            observer,
            new Date(predictionMinute * 60_000),
            { hours: 24, minElevation, maxPasses: 8 },
          )
        : [],
    [selected, observer, predictionMinute, minElevation],
  );
  const passes = allPasses.filter(
    (pass) => new Date(pass.endTime).getTime() > clock.timestamp,
  );
  const nextPass = passes[0] ?? null;
  const selectedAge =
    selected && positionSecond ? getElementAgeDays(selected, time) : 0;
  const stale = Math.abs(selectedAge) > 3;
  const demo = catalog?.source === "demo";
  const filtered = satellites.filter((satellite) =>
    `${satellite.name} ${satellite.noradId}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );

  const changeGroup = useCallback(
    (nextGroup: CatalogGroup) => {
      setQuery("");
      setGroup(nextGroup);
    },
    [setGroup],
  );

  const showPasses = () => {
    setView("passes");
    window.setTimeout(
      () =>
        passSection.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      50,
    );
  };

  const exportPasses = () => {
    if (!selected || !passes.length) return;
    const rows = [
      [
        "Satellite",
        "NORAD",
        "Start UTC (window start if ongoing)",
        "Peak UTC",
        "End UTC (window end if truncated)",
        "Max elevation deg",
        "Threshold deg",
        "Ongoing at window start",
        "Truncated at window end",
        "Observer latitude",
        "Observer longitude",
        "Observer altitude km",
        "Source",
        "Element epoch UTC",
        "Approximate SGP4 prediction",
      ],
      ...passes.map((pass) => [
        selected.name,
        selected.noradId,
        pass.startTime,
        pass.peakTime,
        pass.endTime,
        pass.maxElevation.toFixed(2),
        minElevation,
        pass.ongoing,
        pass.truncated,
        observer.latitude,
        observer.longitude,
        observer.altitudeKm,
        catalog?.source ?? "unknown",
        selected.epoch,
        "Not an optical visibility forecast",
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `orbital-${selected.noradId}-passes.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportNote("Pass predictions exported as CSV.");
    window.setTimeout(() => setExportNote(""), 4000);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="ORBITAL home">
          <span className="brand-mark">
            <Orbit size={31} strokeWidth={1.4} />
          </span>
          <span>
            ORBITAL<span className="brand-caption">MISSION CONTROL</span>
          </span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={view === "control" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setView("control");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <Globe2 size={15} /> Mission control
          </button>
          <button
            className={view === "passes" ? "nav-item active" : "nav-item"}
            onClick={showPasses}
          >
            <Radio size={15} /> Pass predictions
          </button>
        </nav>
        <div className="topbar-right">
          <span className="engine-status">
            <i className="status-dot" /> SGP4 ENGINE
          </span>
          <div className="mission-clock">
            <span className="micro-label">MISSION CLOCK · UTC</span>
            <span className="mono">
              {clock.timestamp ? utcTime(clock.timestamp, true) : "--:--:--"}
              <span className="clock-zone">Z</span>
            </span>
          </div>
          <button
            className="icon-button info-button"
            aria-label="Data sources and model information"
            onClick={() => setSourcesOpen(true)}
          >
            <Info size={18} />
          </button>
        </div>
      </header>

      <main>
        <section className="workspace-heading">
          <div>
            <div className="eyebrow">
              <span className="tiny-square" /> EARTH OPERATIONS{" "}
              <span className="muted">/</span> WORKSPACE 01
            </div>
            <h1>
              Orbital overview<span className="heading-period">.</span>
            </h1>
            <p>A little closer to everything above.</p>
          </div>
          <div className="workspace-summary">
            <div>
              <span className="micro-label">IN CATALOG</span>
              <strong className="mono">
                {loading ? "—" : String(satellites.length).padStart(2, "0")}
                <span> OBJECTS</span>
              </strong>
            </div>
            <div>
              <span className="micro-label">PROPAGATION</span>
              <strong className="model-name">
                SGP4 <span className="version-tag">v6</span>
              </strong>
            </div>
            <button
              className="quiet-button data-button"
              onClick={() => setSourcesOpen(true)}
            >
              <Database size={14} /> Data & sources <ArrowUpRight size={13} />
            </button>
          </div>
        </section>

        {(demo || stale || catalog?.notice || error) && (
          <div
            className={`data-notice ${error ? "error-notice" : ""}`}
            role="status"
          >
            <Info size={14} />
            <span>
              <strong>
                {error
                  ? "Catalog request failed."
                  : demo
                    ? "DEMO ELEMENTS"
                    : catalog?.notice
                      ? "CACHED ELEMENTS"
                      : "AGING ELEMENTS"}
              </strong>{" "}
              {error ??
                catalog?.notice ??
                `Selected elements are ${Math.abs(selectedAge).toFixed(1)} days from simulation time; predictions may be less accurate.`}
            </span>
            <button
              onClick={() => setSourcesOpen(true)}
              aria-label="Read data limitations"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}

        <div className={`control-grid ${expanded ? "globe-expanded" : ""}`}>
          <aside className="panel catalog-panel" aria-label="Satellite catalog">
            <div className="panel-heading">
              <h2>Satellite catalog</h2>
              <span className="count-badge">{satellites.length}</span>
            </div>
            <label className="search-field">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or NORAD ID"
                aria-label="Search satellites by name or NORAD ID"
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={13} />
                </button>
              )}
            </label>
            <div className="catalog-filter">
              <span className="select-wrap">
                <select
                  aria-label="Satellite catalog group"
                  value={group}
                  onChange={(event) =>
                    changeGroup(event.target.value as CatalogGroup)
                  }
                >
                  {GROUPS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </span>
              <button
                className="icon-button"
                disabled={loading}
                aria-label="Refresh satellite catalog"
                title="Refresh catalog (upstream cached for two hours)"
                onClick={() => void refresh()}
              >
                <RefreshCw size={14} className={loading ? "spin" : ""} />
              </button>
            </div>
            <div className="catalog-list-header">
              <span>OBJECT / DESIGNATOR</span>
              <span>ORBIT</span>
            </div>
            <div className="satellite-list" aria-busy={loading}>
              {loading ? (
                <div className="list-skeleton">
                  {Array.from({ length: 7 }, (_, i) => (
                    <div key={i}>
                      <span />
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              ) : error && !catalog ? (
                <div className="empty-state">
                  <Database size={27} />
                  <p>Catalog unavailable</p>
                  <span>{error}</span>
                  <button
                    className="quiet-button"
                    onClick={() => void refresh()}
                  >
                    Retry request
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="empty-state">
                  <Search size={25} />
                  <p>No matching objects</p>
                  <span>Try a name or a NORAD catalog number.</span>
                  <button className="text-button" onClick={() => setQuery("")}>
                    Clear search
                  </button>
                </div>
              ) : (
                filtered.map((satellite) => {
                  const position = positionMap.get(satellite.id);
                  return (
                    <button
                      key={satellite.id}
                      className={`satellite-row ${selected?.id === satellite.id ? "selected" : ""}`}
                      onClick={() => setSelectedId(satellite.id)}
                      aria-pressed={selected?.id === satellite.id}
                    >
                      <span className="satellite-row-icon">
                        <Satellite size={17} strokeWidth={1.5} />
                      </span>
                      <span className="satellite-row-name">
                        <strong>{satellite.name}</strong>
                        <span className="mono">NORAD {satellite.noradId}</span>
                      </span>
                      <span className="satellite-orbit">
                        {position
                          ? position.altitudeKm < 2000
                            ? "LEO"
                            : position.altitudeKm < 30_000
                              ? "MEO"
                              : "HIGH"
                          : "—"}
                        <i
                          className={
                            position ? "status-dot" : "status-dot inactive"
                          }
                        />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="catalog-footer">
              <span>
                <i className={`status-dot ${demo ? "amber" : ""}`} />{" "}
                {loading
                  ? "Loading catalog"
                  : demo
                    ? "Bundled demo elements"
                    : catalog?.source === "cache"
                      ? "Last-known CelesTrak data"
                      : "CelesTrak orbital elements"}
              </span>
              <button
                onClick={() => setSourcesOpen(true)}
                aria-label="Catalog data information"
              >
                <ExternalLink size={12} />
              </button>
            </div>
          </aside>

          <section
            className="panel globe-panel"
            aria-label="Interactive Earth view"
          >
            <div className="globe-topline">
              <span className="globe-view-label">
                <Globe2 size={13} /> EARTH <span>/</span> 3D VIEW
              </span>
              <span className="prediction-tag">
                <i /> {demo ? "DEMO PREDICTION" : "ORBITAL PREDICTION"}
              </span>
            </div>
            <div className="globe-canvas">
              <GlobeBoundary>
                <EarthGlobe
                  satellites={satellites}
                  positions={positions}
                  selectedId={selected?.id ?? ""}
                  selectedPosition={selectedPosition}
                  orbit={orbit}
                  observer={observer}
                  showOrbits={showOrbits}
                  showGroundTrack={showGroundTrack}
                  showGrid={showGrid}
                  autoRotate={autoRotate}
                  focusKey={focusKey}
                  zoomCommand={zoomCommand}
                  handInput={handInput}
                  onSelect={setSelectedId}
                  time={time}
                />
              </GlobeBoundary>
            </div>
            <span className="corner-mark top-left" />
            <span className="corner-mark top-right" />
            <span className="corner-mark bottom-left" />
            <span className="corner-mark bottom-right" />
            <div className="globe-side-label">
              WGS 84 <span>·</span> EARTH FIXED
            </div>
            <div className="globe-controls">
              <div className="control-stack">
                <button
                  className="icon-button"
                  aria-label="Zoom in"
                  title="Zoom in"
                  onClick={() =>
                    setZoomCommand({ direction: "in", nonce: Date.now() })
                  }
                >
                  <Plus size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Zoom out"
                  title="Zoom out"
                  onClick={() =>
                    setZoomCommand({ direction: "out", nonce: Date.now() })
                  }
                >
                  <Minus size={18} />
                </button>
              </div>
              <button
                className="icon-button"
                disabled={!selectedPosition}
                aria-label="Focus selected satellite"
                title="Focus selected satellite"
                onClick={() => setFocusKey((value) => value + 1)}
              >
                <Crosshair size={17} />
              </button>
              <button
                className={`icon-button ${layersOpen ? "is-active" : ""}`}
                aria-label="Globe layers"
                title="Globe layers"
                aria-expanded={layersOpen}
                onClick={() => setLayersOpen(!layersOpen)}
              >
                <Layers3 size={17} />
              </button>
              <button
                className="icon-button expand-button"
                aria-label={expanded ? "Restore globe size" : "Expand globe"}
                title={expanded ? "Restore globe size" : "Expand globe"}
                onClick={() => setExpanded(!expanded)}
              >
                <Maximize2 size={15} />
              </button>
              <button
                className={`icon-button hand-tool-button ${handControlsOpen ? "is-active" : ""}`}
                aria-label="Hand controls (optional)"
                title="Hand controls (optional)"
                aria-expanded={handControlsOpen}
                aria-controls="hand-controls-panel"
                onClick={() => {
                  setHandControlsOpen(!handControlsOpen);
                  setLayersOpen(false);
                }}
              >
                <Hand size={17} />
              </button>
            </div>
            {handControlsOpen && (
              <HandControls
                onMotion={publishHandMotion}
                onActive={setHandActive}
                onClose={() => setHandControlsOpen(false)}
              />
            )}
            {layersOpen && (
              <div className="layers-popover">
                <div className="micro-label">
                  VIEW OPTIONS
                  <button
                    aria-label="Close layer options"
                    onClick={() => setLayersOpen(false)}
                  >
                    <X size={13} />
                  </button>
                </div>
                {[
                  {
                    label: "Selected orbit",
                    checked: showOrbits,
                    setter: setShowOrbits,
                    color: "cyan",
                  },
                  {
                    label: "Ground track",
                    checked: showGroundTrack,
                    setter: setShowGroundTrack,
                    color: "orange",
                  },
                  {
                    label: "Coordinate grid",
                    checked: showGrid,
                    setter: setShowGrid,
                    color: "gray",
                  },
                  {
                    label: "Auto rotate",
                    checked: autoRotate,
                    setter: setAutoRotate,
                    color: "gray",
                  },
                ].map((layer) => (
                  <label key={layer.label}>
                    <span className={`layer-swatch ${layer.color}`} />
                    {layer.label}
                    <input
                      type="checkbox"
                      checked={layer.checked}
                      onChange={(event) => layer.setter(event.target.checked)}
                    />
                    <span className="check-box">
                      {layer.checked && <Check size={11} />}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="globe-legend">
              <span>
                <i className="legend-dot cyan" /> Selected satellite
              </span>
              <span>
                <i className="legend-dot orange" /> Observer
              </span>
            </div>
            <div className="globe-hint">
              Drag to orbit <span>·</span> Scroll to zoom
            </div>
            <div className="simulation-bar">
              <div className="simulation-main">
                <button
                  className="play-button"
                  aria-label={
                    clock.paused ? "Resume simulation" : "Pause simulation"
                  }
                  onClick={clock.togglePause}
                >
                  {clock.paused ? (
                    <Play size={14} fill="currentColor" />
                  ) : (
                    <Pause size={14} fill="currentColor" />
                  )}
                </button>
                <span
                  className={`simulation-status ${clock.realTime ? "realtime" : ""}`}
                >
                  <i />
                  {clock.realTime
                    ? "REAL TIME"
                    : clock.paused
                      ? "PAUSED"
                      : "SIMULATION"}
                </span>
                <label className="speed-select">
                  <select
                    aria-label="Simulation speed"
                    value={clock.speed}
                    onChange={(event) =>
                      clock.setSpeed(Number(event.target.value))
                    }
                  >
                    <option value={1}>1×</option>
                    <option value={10}>10×</option>
                    <option value={60}>60×</option>
                    <option value={600}>600×</option>
                  </select>
                  <ChevronDown size={10} />
                </label>
                <span className="simulation-date mono">
                  {clock.timestamp ? utcDate(clock.timestamp) : "SYNCHRONIZING"}
                </span>
                <button
                  className="reset-time"
                  aria-label="Reset to current UTC time"
                  onClick={clock.reset}
                  title="Reset to current UTC time"
                >
                  <RotateCcw size={12} /> NOW
                </button>
              </div>
              <div className="time-scrubber">
                <span>−90m</span>
                <input
                  type="range"
                  min={-90}
                  max={90}
                  step={1}
                  value={
                    clock.realTime || !clock.timestamp
                      ? 0
                      : Math.max(
                          -90,
                          Math.min(
                            90,
                            Math.round(
                              (clock.timestamp - clock.wallTimestamp) / 60_000,
                            ),
                          ),
                        )
                  }
                  onChange={(event) =>
                    clock.setOffset(Number(event.target.value))
                  }
                  aria-label="Simulation offset from current time in minutes"
                />
                <span>+90m</span>
              </div>
            </div>
          </section>

          <aside
            className="details-column"
            aria-label="Satellite details and observer"
          >
            <section className="panel telemetry-panel">
              <div className="panel-heading">
                <span className="micro-label">SELECTED OBJECT</span>
                <span className="telemetry-icon">
                  <Satellite size={16} />
                </span>
              </div>
              <div className="object-title">
                <span className="object-index mono">
                  {selected
                    ? `NORAD ${selected.noradId}`
                    : "ACQUIRING ELEMENTS"}
                </span>
                <h2>
                  {selected
                    ? selected.name.replace(" (ZARYA)", "")
                    : "Selecting satellite"}
                </h2>
                <p>
                  {selected
                    ? friendlyName(selected.name)
                    : "Preparing your orbital workspace"}
                </p>
              </div>
              <div className="object-status">
                <i
                  className={`status-dot ${!selectedPosition ? "inactive" : ""}`}
                />
                {selectedPosition
                  ? "PROPAGATED POSITION"
                  : loading
                    ? "LOADING ELEMENTS"
                    : "POSITION UNAVAILABLE"}
                <span>SGP4</span>
              </div>
              <div className="telemetry-metrics">
                <Metric
                  label="ALTITUDE"
                  value={selectedPosition?.altitudeKm.toFixed(1)}
                  unit="km"
                  icon={<ArrowUpRight size={13} />}
                />
                <Metric
                  label="VELOCITY"
                  value={selectedPosition?.velocityKmS.toFixed(2)}
                  unit="km/s"
                  icon={<Activity size={13} />}
                />
                <Metric
                  label="ORBITAL PERIOD"
                  value={selectedPosition?.periodMinutes.toFixed(1)}
                  unit="min"
                  icon={<Orbit size={13} />}
                />
                <Metric
                  label="INCLINATION"
                  value={
                    selected
                      ? Number(selected.line2.slice(8, 16)).toFixed(2)
                      : undefined
                  }
                  unit="°"
                  icon={<SlidersHorizontal size={13} />}
                />
              </div>
              <div className="coordinates-row">
                <div>
                  <span className="micro-label">LATITUDE</span>
                  <strong className="mono">
                    {selectedPosition
                      ? coordinate(selectedPosition.latitude, "latitude")
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span className="micro-label">LONGITUDE</span>
                  <strong className="mono">
                    {selectedPosition
                      ? coordinate(selectedPosition.longitude, "longitude")
                      : "—"}
                  </strong>
                </div>
              </div>
              <div className={`element-age ${stale ? "is-stale" : ""}`}>
                <span className="micro-label">ELEMENT AGE AT SIM. TIME</span>
                <span className="mono">
                  {selected && positionSecond
                    ? `${Math.abs(selectedAge).toFixed(1)}d${selectedAge < 0 ? " ahead" : " old"}`
                    : "—"}
                  {stale && " · STALE"}
                </span>
              </div>
            </section>
            <section className="panel observer-panel">
              <div className="panel-heading">
                <h2>
                  <MapPin size={14} /> Ground observer
                </h2>
                <button
                  className="icon-button"
                  aria-label="Edit observer coordinates"
                  onClick={() => setEditingObserver(!editingObserver)}
                >
                  {editingObserver ? <X size={14} /> : <Settings2 size={14} />}
                </button>
              </div>
              {editingObserver ? (
                <ObserverForm
                  observer={observer}
                  onSave={(next) => {
                    setObserver(next);
                    setObserverName(
                      next.latitude === DEFAULT_OBSERVER.latitude &&
                        next.longitude === DEFAULT_OBSERVER.longitude &&
                        next.altitudeKm === DEFAULT_OBSERVER.altitudeKm
                        ? "Astana, Kazakhstan"
                        : "Custom ground station",
                    );
                    setEditingObserver(false);
                  }}
                />
              ) : (
                <>
                  <div className="observer-location">
                    <span className="observer-pin">
                      <MapPin size={18} />
                    </span>
                    <div>
                      <strong>{observerName}</strong>
                      <span className="mono">
                        {coordinate(observer.latitude, "latitude")}{" "}
                        <span className="muted">/</span>{" "}
                        {coordinate(observer.longitude, "longitude")}
                      </span>
                    </div>
                  </div>
                  <div className="observer-meta">
                    <span>{Math.round(observer.altitudeKm * 1000)} m ASL</span>
                    <span>WGS 84</span>
                    <button onClick={() => setEditingObserver(true)}>
                      Edit location <ArrowRight size={11} />
                    </button>
                  </div>
                </>
              )}
            </section>
          </aside>
        </div>

        <section
          className={`passes-section ${view === "passes" ? "planner-active" : ""}`}
          ref={passSection}
          aria-label="Pass predictions"
        >
          <div className="section-heading">
            <div>
              <div className="eyebrow">
                <Radio size={12} /> OBSERVER FORECAST
              </div>
              <h2>
                Upcoming passes{" "}
                <span className="section-tag">NEXT 24 HOURS</span>
              </h2>
            </div>
            <div className="pass-actions">
              <label className="threshold-select">
                <span>Min. elevation</span>
                <select
                  aria-label="Minimum pass elevation"
                  value={minElevation}
                  onChange={(event) =>
                    setMinElevation(Number(event.target.value))
                  }
                >
                  <option value={0}>0° · Horizon</option>
                  <option value={10}>10°</option>
                  <option value={20}>20°</option>
                </select>
                <ChevronDown size={11} />
              </label>
              <button
                className="quiet-button export-button"
                disabled={!passes.length}
                onClick={exportPasses}
              >
                <ArrowUpRight size={14} /> Export CSV
              </button>
            </div>
          </div>
          <div className="passes-layout">
            <div className="panel next-pass-card">
              <div className="next-pass-top">
                <span className="micro-label">
                  <i className="status-dot" />{" "}
                  {nextPass &&
                  new Date(nextPass.startTime).getTime() <= clock.timestamp
                    ? "CURRENT WINDOW"
                    : "NEXT ACQUISITION"}
                </span>
                <span className="forecast-tag">PREDICTED</span>
              </div>
              {nextPass ? (
                <>
                  <div className="countdown mono">
                    {new Date(nextPass.startTime).getTime() <= clock.timestamp
                      ? "IN PROGRESS"
                      : countdown(nextPass.startTime, clock.timestamp)}
                  </div>
                  <div className="next-pass-caption">
                    {new Date(nextPass.startTime).getTime() <= clock.timestamp
                      ? nextPass.truncated
                        ? `Above ${minElevation}° through forecast boundary · partial`
                        : `Above ${minElevation}° until ${utcTime(nextPass.endTime)} UTC`
                      : `${utcTime(nextPass.startTime, true)} UTC · ${utcDate(nextPass.startTime)}`}
                  </div>
                  <PassCurve
                    satellite={selected}
                    observer={observer}
                    pass={nextPass}
                    threshold={minElevation}
                  />
                  <div className="next-pass-bottom">
                    <span>
                      <strong>{nextPass.maxElevation.toFixed(1)}°</strong> max
                      elevation
                    </span>
                    <button
                      onClick={() => {
                        clock.jumpTo(nextPass.peakTime);
                        setView("control");
                      }}
                      title="Pause simulation at maximum elevation"
                    >
                      Preview peak <ArrowUpRight size={12} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="no-pass">
                  <Orbit size={32} strokeWidth={1} />
                  <strong>
                    {loading
                      ? "Calculating your next window"
                      : predictionUnavailable
                        ? "Prediction unavailable"
                        : "No passes in this window"}
                  </strong>
                  <span>
                    {loading
                      ? "Waiting for orbital elements…"
                      : predictionUnavailable
                        ? "Orbital elements are unavailable or cannot be propagated at this time. Refresh the catalog, reset to now, or choose another object."
                        : `No predicted passes above ${minElevation}° for the selected object in 24 hours. Try another satellite or a lower threshold.`}
                  </span>
                </div>
              )}
            </div>
            <div className="panel passes-table-panel">
              <div className="pass-table-scroll">
                <table className="passes-table">
                  <thead>
                    <tr>
                      <th>PASS / UTC DATE</th>
                      <th>
                        <ArrowUpRight size={11} /> START
                      </th>
                      <th>MAX ELEVATION</th>
                      <th>
                        <ArrowDownLeft size={11} /> END
                      </th>
                      <th>DURATION</th>
                      <th aria-label="Preview" />
                    </tr>
                  </thead>
                  <tbody>
                    {passes.slice(0, 5).map((pass, index) => (
                      <tr key={pass.id}>
                        <td>
                          <span className="pass-number mono">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="pass-date">
                            {utcDate(pass.startTime).slice(0, 6)}
                            {(pass.ongoing ||
                              new Date(pass.startTime).getTime() <=
                                clock.timestamp) && (
                              <span className="ongoing-label">IN VIEW</span>
                            )}
                            {pass.truncated && (
                              <span className="ongoing-label">PARTIAL</span>
                            )}
                          </span>
                        </td>
                        <td className="mono">
                          {utcTime(pass.startTime, true)}
                          <small>{cardinal(pass.azimuthStart)}</small>
                        </td>
                        <td>
                          <div className="elevation-cell">
                            <span className="mono">
                              {pass.maxElevation.toFixed(1)}°
                            </span>
                            <span className="elevation-bar">
                              <i
                                style={{
                                  width: `${Math.max(3, (pass.maxElevation / 90) * 100)}%`,
                                }}
                              />
                            </span>
                          </div>
                        </td>
                        <td className="mono">
                          {utcTime(pass.endTime, true)}
                          <small>{cardinal(pass.azimuthEnd)}</small>
                        </td>
                        <td className="mono duration-cell">
                          {duration(pass.startTime, pass.endTime)}
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Preview pass ${index + 1} peak at ${utcTime(pass.peakTime)} UTC`}
                            onClick={() => clock.jumpTo(pass.peakTime)}
                          >
                            <ArrowUpRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!passes.length && (
                  <div className="table-empty">
                    <Radio size={23} />
                    <span>
                      {loading
                        ? "Initializing pass predictor…"
                        : predictionUnavailable
                          ? "Prediction unavailable for these elements."
                          : "No acquisition windows found."}
                    </span>
                    <p>
                      Passes depend on orbit geometry and your observer
                      location.
                    </p>
                  </div>
                )}
              </div>
              <div className="forecast-footnote">
                <Info size={12} />
                <span>
                  Approximate passes above {minElevation}°. IN VIEW starts may
                  be clipped; PARTIAL ends are forecast boundaries. Optical
                  visibility is not evaluated. Times are UTC.
                  {demo ? " Demo elements are in use." : ""}
                </span>
              </div>
            </div>
          </div>
        </section>

        <footer className="app-footer">
          <div>
            <Orbit size={15} />
            <span>ORBITAL</span>
            <span className="footer-separator">/</span>
            <span>An independent view of Earth orbit.</span>
          </div>
          <button onClick={() => setSourcesOpen(true)}>
            <ShieldCheck size={12} /> Predictions, never live telemetry{" "}
            <ArrowUpRight size={11} />
          </button>
        </footer>
      </main>
      {sourcesOpen && (
        <SourcesDialog
          catalog={catalog}
          selected={selected}
          onClose={() => setSourcesOpen(false)}
        />
      )}
      <div className="sr-only" aria-live="polite">
        {exportNote}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value?: string;
  unit: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="metric">
      <span className="micro-label">
        {icon}
        {label}
      </span>
      <strong className="mono">
        {value ?? "—"}
        <span>{unit}</span>
      </strong>
    </div>
  );
}
