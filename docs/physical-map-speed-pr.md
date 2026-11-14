# perf(scene): accelerate the existing offline physical-map pipeline

The current physical-map command repeatedly validates the same rings and scans every road, building and water polygon while preparing entrances and placement quality. This change adds conservative spatial candidates, a road BVH and a bounded coordinate-value cache while retaining the existing exact predicates and tie ordering.

The CLI, polygon/holes and 50m road-buffer semantics, limits, auto-evidence.2 rules, five progress phases, result/error structures and candidate layout remain unchanged. No online API, task queue, OSM download, map storage, deployment or social-sim change is included.

On archived inputs, three fresh Python3.11 processes per version produce these median full local command times, including process startup and excluding caller-side downloads:

| Scope | Before | After | Speedup |
| --- | ---: | ---: | ---: |
| 0.771876km² campus, 77 source buildings | 5.204s | 0.197s | 26.36x |
| 0.053712km² community subset, 32 source buildings | 0.311s | 0.097s | 3.19x |

Both retain identical geometry, purposes, services, eligibility, warnings and quality status, including preview_only for the campus input. Real implementation fingerprints and their dependent hashes correctly change. Separate fixed-identity diagnostics compare all14 candidate files and complete stdout byte-for-byte, without masking differences.

Validation: adapter188 and scripts34 passed; frontend410 passed and2 existing Windows-only skips; original plus differential physical-map16 passed;65 legacy compilation responses and97 official input digests unchanged; standalone runtime0.2.1 offline installation and7 legacy responses passed. The runtime export explicitly includes the new module. A separately explained fixture cleanup removes only an accidentally recorded, untracked .tmp duplicate; expected responses and official map bytes remain intact.

See `docs/physical-map-speed-delivery.md`, `docs/physical-map-speed-measurements.json` and `scripts/profile_physical_map.py` for the command, timing conditions and reproducible evidence. This file is a local PR draft; no remote PR has been created.
