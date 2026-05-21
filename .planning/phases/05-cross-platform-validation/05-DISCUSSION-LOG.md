# Phase 5 Discussion Log

**Date:** 2026-05-21
**Participants:** User + Claude

## Areas Discussed

### Android Testing

**Q: How will you test on Android?**
Options: Physical devices / BrowserStack / Both
**Selected:** Physical devices I own

**Q: Do you have two different Android device families?**
Options: 2+ OEM families / Only 1 device / Not sure
**Selected:** Only 1 device
**Outcome:** Single-device pass = v1 gate. Two-OEM requirement relaxed to stretch goal.

---

### macOS Safari Scope

**Q: Is macOS Safari in scope for Phase 5?**
Options: Yes in scope / Deferred to post-v1
**Selected:** Deferred to post-v1

**Q: Quick Safari smoke test even if full validation deferred?**
Options: Smoke test only / Skip entirely
**Selected:** No — skip entirely
**Outcome:** Safari fully deferred. No Safari work in Phase 5.

---

### Deployment Host

**Q: GitHub Pages / VPS / hosted platform?**
User clarified: asked about VPS, GitHub Pages, and "no deployment" options.
Explained: GitHub Pages can't set COOP/COEP headers (SharedArrayBuffer blocker). VPS with nginx/Caddy works. Cloudflare Pages is simplest free option.

**Q: Where should the plan target for production deployment?**
Options: VPS / Netlify / Cloudflare Pages / Skip deployment
**Selected:** Cloudflare Pages (free tier)

**Q: WASM binary in CI — build or commit?**
Options: Build WASM in CI / Commit binary / You decide
**Selected:** Build WASM in CI (cargo xtask build + vite build)
**Outcome:** `public/_headers` for COOP/COEP. WASM compiled in CI. Binary stays gitignored.

---

## Not Discussed (Claude's Discretion)
- Timing audit methodology (user ready for context before discussing)
- E2E/Playwright (not selected — deferred to future phase)

## Deferred Ideas
- macOS Safari full validation — post-v1
- Playwright E2E — future phase
- Second Android OEM — stretch goal
