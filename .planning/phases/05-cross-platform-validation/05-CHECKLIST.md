# Phase 05: Android Hardware Validation Checklist

**Purpose:** Manual verification checklist for Cloudflare Pages deployment and Android Chrome hardware testing.
**Phase:** 05-cross-platform-validation
**Ship gate:** PLATFORM-02 — App runs in browser on Android Chrome

---

## Section 1: Pre-Test Setup

- [ ] Desktop Chrome is updated to the latest stable version
- [ ] Android Chrome is updated to the latest stable version (desktop version must be newer than Android version)
- [ ] Android Developer Options enabled: Settings > About phone > tap Build number 7 times
- [ ] USB Debugging enabled: Developer Options > USB Debugging = ON
- [ ] Android device connected to Mac via USB cable (direct connection, not through a hub)
- [ ] `chrome://inspect#devices` opened on desktop Chrome with "Discover USB devices" checked
- [ ] Authorization prompt on Android device accepted (allow USB debugging from this computer)
- [ ] Device and its Chrome tabs appear in `chrome://inspect` list

---

## Section 2: Cloudflare Pages Deploy Verification

- [ ] Production URL opens in desktop Chrome without error
- [ ] DevTools Console: type `crossOriginIsolated` — result is `true`
- [ ] DevTools Console: type `typeof SharedArrayBuffer` — result is `"function"` (not `"undefined"`)
- [ ] Network tab: reload the page, WASM file returns HTTP 200 (not 404)
- [ ] Network tab: HTML document response headers include `Cross-Origin-Opener-Policy: same-origin`
- [ ] Network tab: HTML document response headers include `Cross-Origin-Embedder-Policy: require-corp`
- [ ] Press Play at 120 BPM — audible clicks play for ~10 seconds without dropout

---

## Section 3: Android Test Matrix

Open the production URL on Android Chrome. Use `chrome://inspect` on desktop to open remote DevTools for the Android tab.

### 3a: 20 BPM

- [ ] App loads without error on Android Chrome
- [ ] Remote DevTools Console: `crossOriginIsolated` returns `true`
- [ ] Press Play — audible clicks start immediately
- [ ] Sustain 60 seconds — no dropout, no audible drift
- [ ] No `TypeError` or uncaught exceptions in remote DevTools console during run
- [ ] Press Stop — audio stops cleanly

### 3b: 120 BPM

- [ ] Change BPM to 120, press Play
- [ ] Audible clicks start immediately
- [ ] Sustain 60 seconds — no dropout, no audible drift
- [ ] No `TypeError` or uncaught exceptions in remote DevTools console during run
- [ ] Press Stop — audio stops cleanly

### 3c: 300 BPM

- [ ] Change BPM to 300, press Play
- [ ] Audible clicks start immediately
- [ ] Sustain 60 seconds — no dropout, no audible drift
- [ ] No `TypeError` or uncaught exceptions in remote DevTools console during run
- [ ] Press Stop — audio stops cleanly

---

## Section 4: Timing/GC Audit

Run this audit at 120 BPM via USB remote DevTools (`chrome://inspect`).

- [ ] Disable screencasting in remote DevTools (camera icon in toolbar — screencasting adds overhead that skews timing measurements)
- [ ] Set BPM to 120, press Play
- [ ] Open Performance panel in remote DevTools
- [ ] Click Record, let it run for 60 seconds, click Stop
- [ ] In the flame chart, locate the "AudioWorklet" thread lane (labeled with the processor class name)
- [ ] Zoom in on the AudioWorklet lane — verify zero yellow "Minor GC" or "Major GC" blocks
- [ ] Hover over individual `process()` calls — duration must be under 2.67ms (128 samples / 48000 Hz) or under 2.9ms (44100 Hz), depending on observed sample rate
- [ ] No "Major GC" events visible anywhere in the AudioWorklet thread lane

**Budget reference:** 128 samples / 48000 Hz = 2.67ms per quantum (Android typical); 128 / 44100 Hz = 2.9ms.

---

## Section 5: Gesture Gate Test

This verifies that the Android autoplay policy is correctly enforced (no audio before user gesture).

- [ ] Load the production URL fresh on Android Chrome (new tab or hard reload)
- [ ] Wait 5 seconds without touching the Play button or interacting with the app
- [ ] Verify: no audio plays during the 5-second wait
- [ ] Press Play — verify audio starts immediately after the button press
- [ ] No audio before gesture; audio after gesture = PASS

---

## Section 6: Sign-Off

| Field | Value |
|-------|-------|
| Date | |
| Device model | |
| Android version | |
| Chrome for Android version | |
| Desktop Chrome version | |
| Sample rate observed (check DevTools console or Network > WASM response) | |
| Overall result | PASS / FAIL |
| Notes | |

**Requirements verified by this checklist:**

| Requirement | Covered by | Status |
|-------------|-----------|--------|
| PLATFORM-02: App runs on Android Chrome | Section 3 (test matrix) | [ ] PASS / [ ] FAIL |
| AUDIO-03: Scheduling gaps <= 10ms | Section 4 (GC audit — zero GC implies scheduler is within budget) | [ ] PASS / [ ] FAIL |
| AUDIO-04: Consistent click length/amplitude across tempos | Section 3 (audible test at 20/120/300 BPM) | [ ] PASS / [ ] FAIL |

**Signed off by:** ___________________
