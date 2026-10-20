"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ComponentRef,
  type RefObject,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, Line, OrbitControls, useTexture } from "@react-three/drei";
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import type {
  Observer,
  OrbitPoint,
  SatellitePosition,
  SatelliteRecord,
} from "@/lib/types";

const EARTH_RADIUS = 2;
const EARTH_KM = 6378.137;
const DEG = Math.PI / 180;
type Point3 = [number, number, number];

export interface EarthGlobeProps {
  satellites: SatelliteRecord[];
  positions: SatellitePosition[];
  selectedId: string;
  selectedPosition: SatellitePosition | null;
  orbit: OrbitPoint[];
  observer: Observer;
  showOrbits: boolean;
  showGroundTrack: boolean;
  showGrid: boolean;
  autoRotate: boolean;
  focusKey: number;
  zoomCommand: { direction: "in" | "out"; nonce: number } | null;
  onSelect: (id: string) => void;
  time: Date;
}

/** Render ECF with north along +Y and east at longitude 90 along -Z. */
function ecfToWorld(ecf: SatellitePosition["positionEcf"]): Point3 {
  const scale = EARTH_RADIUS / EARTH_KM;
  return [ecf.x * scale, ecf.z * scale, -ecf.y * scale];
}

function surfacePoint(latitude: number, longitude: number, radius = EARTH_RADIUS): Point3 {
  const lat = latitude * DEG;
  const lon = longitude * DEG;
  return [
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon),
  ];
}

function orbitalPoint(point: OrbitPoint): Point3 {
  // WGS84 geodetic coordinates -> ECF. Matches the propagated ECF markers.
  const lat = point.latitude * DEG;
  const lon = point.longitude * DEG;
  const n = EARTH_KM / Math.sqrt(1 - 0.00669437999014 * Math.sin(lat) ** 2);
  const scale = EARTH_RADIUS / EARTH_KM;
  return [
    (n + point.altitudeKm) * Math.cos(lat) * Math.cos(lon) * scale,
    (n * (1 - 0.00669437999014) + point.altitudeKm) * Math.sin(lat) * scale,
    -(n + point.altitudeKm) * Math.cos(lat) * Math.sin(lon) * scale,
  ];
}

const atmosphereVertex = `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

function Atmosphere() {
  const uniforms = useMemo(() => ({ glowColor: { value: new Color("#2b9dff") } }), []);
  return (
    <group>
      <mesh>
        <sphereGeometry args={[2.035, 64, 40]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={atmosphereVertex}
          fragmentShader={`
            uniform vec3 glowColor;
            varying vec3 vWorldNormal;
            varying vec3 vWorldPosition;
            void main() {
              vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
              float rim = pow(1.0 - max(dot(vWorldNormal, viewDirection), 0.0), 3.5);
              gl_FragColor = vec4(glowColor, rim * 0.48);
            }
          `}
          transparent
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[2.105, 64, 40]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={atmosphereVertex}
          fragmentShader={`
            uniform vec3 glowColor;
            varying vec3 vWorldNormal;
            varying vec3 vWorldPosition;
            void main() {
              vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
              float rim = pow(max(0.0, 0.7 + dot(vWorldNormal, viewDirection)), 3.0);
              gl_FragColor = vec4(glowColor, rim * 0.8);
            }
          `}
          transparent
          side={BackSide}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function EarthSurface({ earthRef }: { earthRef: RefObject<Mesh> }) {
  const { gl } = useThree();
  const texture = useTexture("/textures/earth-blue-marble.jpg", (loaded) => {
    const maps = Array.isArray(loaded) ? loaded : [loaded];
    maps.forEach((map) => {
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), 8);
      map.needsUpdate = true;
    });
  });

  return (
    <mesh
      ref={earthRef}
      onClick={(event) => event.stopPropagation()}
      onPointerOver={(event) => event.stopPropagation()}
    >
      {/* Default SphereGeometry UVs place longitude 0 at +X, matching ECF. */}
      <sphereGeometry args={[EARTH_RADIUS, 96, 64]} />
      <meshPhongMaterial
        map={texture}
        color="#b4cfee"
        emissive="#1a345c"
        emissiveMap={texture}
        emissiveIntensity={0.38}
        shininess={8}
        specular="#204269"
      />
    </mesh>
  );
}

function GeographicGrid() {
  const geometry = useMemo(() => {
    const vertices: number[] = [];
    const addSegment = (a: Point3, b: Point3) => vertices.push(...a, ...b);
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = -180; lon < 180; lon += 3) {
        addSegment(surfacePoint(lat, lon, 2.008), surfacePoint(lat, lon + 3, 2.008));
      }
    }
    for (let lon = -180; lon < 180; lon += 30) {
      for (let lat = -90; lat < 90; lat += 3) {
        addSegment(surfacePoint(lat, lon, 2.008), surfacePoint(lat + 3, lon, 2.008));
      }
    }
    return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(vertices, 3));
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#74b8df" transparent opacity={0.17} depthWrite={false} />
    </lineSegments>
  );
}

function Starfield() {
  const geometry = useMemo(() => {
    const vertices: number[] = [];
    // A deterministic distribution avoids visual jumps on React remounts.
    let seed = 302;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 1400; i++) {
      const azimuth = random() * Math.PI * 2;
      const y = random() * 2 - 1;
      const radius = 65 + random() * 30;
      const horizontal = Math.sqrt(1 - y * y);
      vertices.push(radius * horizontal * Math.cos(azimuth), radius * y, radius * horizontal * Math.sin(azimuth));
    }
    return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(vertices, 3));
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <points geometry={geometry}>
      <pointsMaterial color="#b4d0ed" size={0.085} sizeAttenuation transparent opacity={0.66} depthWrite={false} />
    </points>
  );
}

function SatelliteMarker({
  position,
  satellite,
  selected,
  onSelect,
  earthRef,
}: {
  position: SatellitePosition;
  satellite?: SatelliteRecord;
  selected: boolean;
  onSelect: EarthGlobeProps["onSelect"];
  earthRef: RefObject<Mesh>;
}) {
  const markerPosition = ecfToWorld(position.positionEcf);
  const pulse = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (pulse.current) {
      const scale = 1 + Math.sin(clock.elapsedTime * 2.4) * 0.1;
      pulse.current.scale.setScalar(scale);
    }
  });

  return (
    <group position={markerPosition}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect(position.id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => { document.body.style.cursor = ""; }}
      >
        <sphereGeometry args={[selected ? 0.082 : 0.067, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[selected ? 0.026 : 0.017, 12, 10]} />
        <meshBasicMaterial color={selected ? "#b9ffff" : "#6c9dbd"} toneMapped={false} />
      </mesh>
      {selected && (
        <>
          <Billboard>
            <mesh ref={pulse}>
              <ringGeometry args={[0.047, 0.057, 40]} />
              <meshBasicMaterial color="#43e5f0" transparent opacity={0.88} toneMapped={false} depthWrite={false} />
            </mesh>
            <mesh>
              <ringGeometry args={[0.083, 0.087, 40]} />
              <meshBasicMaterial color="#45e4ee" transparent opacity={0.3} toneMapped={false} depthWrite={false} />
            </mesh>
          </Billboard>
          <Html position={[0, 0.17, 0]} center occlude={[earthRef]} zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
            <div style={{ whiteSpace: "nowrap", color: "#d1faff", fontFamily: "var(--font-mono), monospace", fontSize: 10, letterSpacing: "0.07em", padding: "7px 10px", border: "1px solid rgba(67,229,240,.38)", background: "rgba(8,23,33,.9)", borderRadius: 4, boxShadow: "0 0 22px #0acadd16" }}>
              <span style={{ display: "inline-block", width: 5, height: 5, background: "#53e7e8", borderRadius: "50%", marginRight: 7 }} />
              {satellite?.name ?? position.id}
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

function ObserverMarker({ observer, earthRef }: { observer: Observer; earthRef: RefObject<Mesh> }) {
  const point = useMemo(() => surfacePoint(observer.latitude, observer.longitude, 2.014), [observer.latitude, observer.longitude]);
  const rotation = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...point).normalize()), [point]);
  return (
    <group position={point}>
      <mesh>
        <sphereGeometry args={[0.013, 12, 10]} />
        <meshBasicMaterial color="#f5bc73" toneMapped={false} />
      </mesh>
      <group quaternion={rotation}>
        <mesh>
          <ringGeometry args={[0.036, 0.041, 40]} />
          <meshBasicMaterial color="#edac67" transparent opacity={0.75} depthWrite={false} />
        </mesh>
        <mesh>
          <ringGeometry args={[0.065, 0.068, 40]} />
          <meshBasicMaterial color="#edac67" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      </group>
      <Html position={[0, 0.09, 0]} center occlude={[earthRef]} zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <div style={{ color: "#e9b980", fontFamily: "var(--font-mono), monospace", fontSize: 8, whiteSpace: "nowrap", letterSpacing: "0.11em", textShadow: "0 1px 5px #000" }}>GROUND STATION</div>
      </Html>
    </group>
  );
}

function CameraController({ selectedId, selectedPosition, focusKey, zoomCommand, autoRotate }: Pick<EarthGlobeProps, "selectedId" | "selectedPosition" | "focusKey" | "zoomCommand" | "autoRotate">) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();
  const focusPosition = useRef<SatellitePosition | null>(selectedPosition);
  const destination = useRef<Vector3 | null>(null);
  const desiredDistance = useRef<number | null>(null);

  useEffect(() => { focusPosition.current = selectedPosition; }, [selectedPosition]);
  useEffect(() => {
    if (focusKey === 0 || !focusPosition.current) return;
    const point = new Vector3(...ecfToWorld(focusPosition.current.positionEcf));
    const distance = Math.max(6.5, point.length() * 2.65);
    destination.current = point.normalize().multiplyScalar(distance);
    desiredDistance.current = null;
  }, [focusKey, selectedId]);
  useEffect(() => {
    if (!zoomCommand) return;
    destination.current = null;
    desiredDistance.current = Math.max(3.3, Math.min(42, camera.position.length() * (zoomCommand.direction === "in" ? 0.8 : 1.25)));
  }, [zoomCommand, camera]);

  useFrame((_, delta) => {
    const ease = 1 - Math.exp(-delta * 5);
    if (destination.current) {
      camera.position.lerp(destination.current, ease);
      if (camera.position.distanceTo(destination.current) < 0.008) destination.current = null;
    } else if (desiredDistance.current !== null) {
      const distance = camera.position.length();
      const next = distance + (desiredDistance.current - distance) * ease;
      camera.position.setLength(next);
      if (Math.abs(next - desiredDistance.current) < 0.005) desiredDistance.current = null;
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.075}
      minDistance={3.3}
      maxDistance={42}
      rotateSpeed={0.55}
      zoomSpeed={0.75}
      autoRotate={autoRotate}
      autoRotateSpeed={0.3}
      onStart={() => { destination.current = null; desiredDistance.current = null; }}
    />
  );
}

function GlobeScene(props: EarthGlobeProps) {
  const earthRef = useRef<Mesh>(null!);
  const orbitPoints = useMemo(() => props.orbit.map(orbitalPoint), [props.orbit]);
  const groundPoints = useMemo(() => props.orbit.map((point) => surfacePoint(point.latitude, point.longitude, 2.014)), [props.orbit]);
  const byId = useMemo(() => new Map(props.satellites.map((satellite) => [satellite.id, satellite])), [props.satellites]);
  const stem = useMemo<Point3[] | null>(() => props.selectedPosition ? [
    surfacePoint(props.selectedPosition.latitude, props.selectedPosition.longitude, 2.016),
    ecfToWorld(props.selectedPosition.positionEcf),
  ] : null, [props.selectedPosition]);

  return (
    <>
      {/* A presentation light rig: these lights are not an optical-visibility model. */}
      <ambientLight intensity={0.7} color="#acc8f5" />
      <directionalLight position={[5, 3, -6]} intensity={2.2} color="#e2ecff" />
      <directionalLight position={[-5, -2, 3]} intensity={0.32} color="#2c5caa" />
      <Starfield />
      <EarthSurface earthRef={earthRef} />
      <Atmosphere />
      {props.showGrid && <GeographicGrid />}
      {props.showOrbits && orbitPoints.length > 1 && <Line points={orbitPoints} color="#47cfdc" lineWidth={1.1} transparent opacity={0.72} />}
      {props.showGroundTrack && groundPoints.length > 1 && <Line points={groundPoints} color="#ddac6c" lineWidth={1} dashed dashSize={0.045} gapSize={0.025} transparent opacity={0.68} />}
      {stem && <Line points={stem} color="#57e2e7" lineWidth={0.8} transparent opacity={0.35} />}
      <ObserverMarker observer={props.observer} earthRef={earthRef} />
      {props.positions.map((position) => (
        <SatelliteMarker key={position.id} position={position} satellite={byId.get(position.id)} selected={position.id === props.selectedId} onSelect={props.onSelect} earthRef={earthRef} />
      ))}
      <CameraController {...props} />
    </>
  );
}

function SceneLoading() {
  return <Html center><div style={{ fontFamily: "monospace", fontSize: 10, color: "#79a8bd", whiteSpace: "nowrap", letterSpacing: "0.12em" }}>INITIALIZING EARTH…</div></Html>;
}

export default function EarthGlobe(props: EarthGlobeProps) {
  return (
    <Canvas
      camera={{ position: [4.9, 3.6, -5.2], fov: 35, near: 0.05, far: 180 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ background: "transparent", touchAction: "none" }}
      aria-label={`Interactive Earth showing ${props.positions.length} predicted satellite positions at ${props.time.toISOString()}. Drag to rotate and scroll to zoom. Use the satellite list to select a satellite.`}
      role="img"
      fallback={<div style={{ display: "grid", placeItems: "center", height: "100%", color: "#86a2b4", padding: 32, textAlign: "center" }}>3D Earth requires WebGL. Satellite predictions and pass planning remain available in the dashboard.</div>}
    >
      <Suspense fallback={<SceneLoading />}>
        <GlobeScene {...props} />
      </Suspense>
    </Canvas>
  );
}
