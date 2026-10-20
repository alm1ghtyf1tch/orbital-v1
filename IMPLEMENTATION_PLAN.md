# ORBITAL implementation plan

1. Initialize a local Next.js / TypeScript / Tailwind application on `feat/orbital-mission-control`.
2. Implement a tested satellite.js SGP4 layer, Earth-fixed coordinate transforms, orbit tracks, and observer pass prediction with refined horizon crossings.
3. Add a validated, cached CelesTrak TLE API with explicitly identified stale and bundled fallback data.
4. Build an interactive React Three Fiber globe and responsive mission-control dashboard with catalog search, satellite selection, UTC simulation controls, observer coordinates, and approximate pass forecasts.
5. Verify with lint, TypeScript, meaningful Vitest tests, a production build, and browser checks/screenshots where available. Review failure and mobile states.
6. Document setup, provenance, prediction limitations, and verification in README.md and NIGHT_REPORT.md. Commit meaningful milestones locally. No push or deployment.
