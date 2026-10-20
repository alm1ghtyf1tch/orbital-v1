"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import type { Observer } from "@/lib/types";
import { DEFAULT_OBSERVER } from "@/lib/constants";

export function ObserverForm({
  observer,
  onSave,
}: {
  observer: Observer;
  onSave: (observer: Observer) => void;
}) {
  const [latitude, setLatitude] = useState(String(observer.latitude));
  const [longitude, setLongitude] = useState(String(observer.longitude));
  const [altitude, setAltitude] = useState(
    String(Math.round(observer.altitudeKm * 1000)),
  );
  const [error, setError] = useState("");
  return (
    <form
      className="observer-form"
      onSubmit={(event) => {
        event.preventDefault();
        const lat = Number(latitude),
          lon = Number(longitude),
          alt = Number(altitude);
        if (
          !latitude.trim() ||
          !longitude.trim() ||
          !altitude.trim() ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          !Number.isFinite(alt) ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180 ||
          alt < -500 ||
          alt > 10000
        ) {
          setError(
            "Use latitude −90…90°, longitude −180…180°, and altitude −500…10000 m.",
          );
          return;
        }
        onSave({ latitude: lat, longitude: lon, altitudeKm: alt / 1000 });
      }}
    >
      <div className="observer-inputs">
        <label>
          Latitude (°)
          <input
            aria-label="Observer latitude"
            type="number"
            min={-90}
            max={90}
            step="any"
            required
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
          />
        </label>
        <label>
          Longitude (°)
          <input
            aria-label="Observer longitude"
            type="number"
            min={-180}
            max={180}
            step="any"
            required
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
          />
        </label>
      </div>
      <label>
        Altitude above sea level (m)
        <input
          aria-label="Observer altitude in meters"
          type="number"
          min={-500}
          max={10000}
          step="any"
          required
          value={altitude}
          onChange={(event) => setAltitude(event.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="observer-form-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => onSave(DEFAULT_OBSERVER)}
        >
          Reset to Astana
        </button>
        <button type="submit" className="primary-button">
          <Check size={12} /> Apply
        </button>
      </div>
    </form>
  );
}
