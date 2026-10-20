export interface SatelliteRecord {
  id: string;
  noradId: number;
  name: string;
  line1: string;
  line2: string;
  epoch: string;
}

export interface Observer {
  latitude: number;
  longitude: number;
  altitudeKm: number;
}

export interface SatellitePosition {
  id: string;
  latitude: number;
  longitude: number;
  altitudeKm: number;
  velocityKmS: number;
  periodMinutes: number;
  positionEcf: { x: number; y: number; z: number };
}

export interface OrbitPoint {
  latitude: number;
  longitude: number;
  altitudeKm: number;
  time: string;
}

export interface PassPrediction {
  id: string;
  startTime: string;
  peakTime: string;
  endTime: string;
  maxElevation: number;
  azimuthStart: number;
  azimuthEnd: number;
  ongoing: boolean;
  truncated: boolean;
}

export type CatalogGroup = "featured" | "stations" | "weather" | "science";

export interface CatalogResponse {
  satellites: SatelliteRecord[];
  source: "celestrak" | "cache" | "demo";
  fetchedAt: string;
  notice?: string;
  group: CatalogGroup;
}
