# Bundled orbital elements

These are genuine, unmodified CelesTrak TLE/3LE responses, fetched on 2026-10-20 UTC. Exact retrieval times and source URLs are recorded in `snapshot-provenance.json`. The JSON bundle preserves the same responses for runtime imports. Element epochs are preserved exactly: retrieval time must never be substituted for an epoch.

`visual.tle` supplies a curated twenty-object Featured catalog, starting with ISS, the Chinese space station, Hubble, Terra and Aqua. A catalog entry does not establish that a satellite remains operational; the bright-object group includes historical spacecraft. `stations.tle`, `weather.tle` and `science.tle` supply their corresponding catalogs. Snapshot contents remain available without internet access, but are explicitly labeled **Demo mode** when used. They are frozen examples, not current telemetry. SGP4 predictions from old elements can be very inaccurate, especially for maneuvering or decaying spacecraft.

Source queries:

- https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=TLE
- https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=TLE
- https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=TLE
- https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=TLE

The runtime requests only the chosen catalog, caches each successful query for two hours, deduplicates concurrent requests, and retains last-known-good elements on failure. An upstream HTTP error pauses further queries for two hours. Network and malformed-response failures also receive a two-hour retry interval per group. Next.js's revalidating data cache supplements the process-local cache. Independent processes/installations have independent caches.

The response's original HTTP `Date` is retained as `fetchedAt` when supplied by CelesTrak, including when Next serves a saved response after a restart or during revalidation. `Age` supplies a fallback if present without `Date`; otherwise request completion time is used. A response dated more than one minute ago, or explicitly carrying a positive cache age, is labeled cached. Retrieval timestamps never replace the TLE's orbital epoch.

Policy and format references:

- [CelesTrak Usage Policy](https://celestrak.org/usage-policy.php): GP data updates every two hours; download only the data needed and once per update.
- [GP data formats and queries](https://celestrak.org/NORAD/documentation/gp-data-formats.php): explicitly requesting `FORMAT=TLE` matters because the default format is CSV.
- [NORAD two-line element format](https://celestrak.org/NORAD/documentation/tle-fmt.php): line fields, epochs, and modulo-10 checksums.

This application's requested TLE format supports numeric NORAD IDs through 99999. Newly cataloged objects with six-digit IDs require OMM/JSON/CSV and are outside this TLE-based implementation; the app does not imply that it includes every satellite in orbit.
