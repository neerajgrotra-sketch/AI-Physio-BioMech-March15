# Backlog

Parked ideas and decisions waiting on something. Newest first.

## A natural voice (owner's request 2026-11-26)

The voice sounds mechanical: everything is spoken by the browser's built-in voice (`speechSynthesis`, about 20 places
across `SessionRunner`, `useCoachingBrain` and `useFramingIntelligence`), so it sounds different on every computer.

- Found while looking: `app/api/tts/route.ts` is a copy of `/api/coach` (it calls Claude, not a speech service), and
  `lib/coaching/useRealVoiceCoaching.ts` (an OpenAI voice, "marin") is not used anywhere. So no real TTS is wired up.
- Plan (a hybrid, so instructions stay instant):
  1. **Fixed lines as recorded clips.** Positioning instructions, "Perfect, I can see you", each exercise's intro,
     hold, lower, rep counts, well done. Generate them once with a neural voice (OpenAI TTS, ElevenLabs or Azure
     Neural), keep them in Supabase Storage, play them at once. No delay, no cost per session.
  2. **AI coaching lines spoken live** through a real `/api/tts` (stream the audio, about half a second's delay).
  3. **Browser voice as the fallback**, picking the best voice the device has (Edge's "Natural" voices, Google's).
  4. **One speech queue** for all of it, so lines don't cut each other off (today each place cancels the others).
- The words matter as much as the voice: warmer, shorter lines, a few variants of each, the patient's first name.
- Decide with the owner: which voice (try 3-4 samples), and the cost of live TTS per session. Protect `/api/tts`
  first (it is open to anyone; see Known gaps in CLAUDE.md).
- Quick win to try first: pick the device's best voice (Edge "Natural" / Google) everywhere, in one helper.

## Test runs logged to Supabase (owner's idea 2026-11-25)

Agile testing: the owner makes a numbered test protocol (a test case), runs it, and every run's whole interaction is
saved against that test case, with the owner's feedback and screenshots, so Claude can analyse it from Supabase.

- Already there: `SessionRunner.flushDebugLogToSupabase` writes the debug log to `session_debug_logs` at session end,
  pause or error (7 rows, the last in April 2026). Only at the end, so a closed tab loses it, and it is mostly text.
- Plan: (1) a test case number on protocols and a run record per session (app version / commit, browser, camera size,
  frame rate); (2) structured events instead of text: position instructions and lock, calibration result, each rep
  (peak, hold, pass or fail and why, view, thresholds), every spoken line; (3) a 10-15 Hz trace of the landmarks
  (no video) and the metric, uploaded every ~10 s; (4) a feedback box at the end (notes, screenshots to Storage).
- The big win: recorded landmarks can be replayed through `lib/testing/replay.ts`, so a real run becomes a
  regression test and tuning can be checked against real movement, not only synthetic poses.
- Size: about 1-2 MB per 5-minute run with landmarks. Only body points, no images; use test patients.

## Session screen layout (owner's note 2026-11-25)

The current session screen (`SessionRunner`: header with Begin Session, camera panel, Live Coaching, Camera Sees,
Session Details table, and the developer logs underneath: Ghost Intelligence, Rep Cycle Log, Debug Log, Movement
Timeline) is not very functional for patients. Fine for the proof-of-concept stage. Replace it with the portrait
patient screen from the mockups, and move the developer logs behind a hidden debug switch (keep them: they are how
we diagnose real-camera tests).

## Expected ROM and Encourage-to ROM (problem area, owner's note 2026-11-25)

Set per exercise when a protocol is assigned to a patient (admin, Patients → Assign Protocol; saved as
`session_block_exercises.rom_target_degrees` and `rom_encourage_degrees`).

- **Expected ROM ("hold fires here")** becomes the rep's pass mark (`romTargetDegrees` → `targetThreshold`). The
  slider defaults to the template's minimum (110° for arm-forward right) and runs from 0° to the norm (160°).
- **Encourage-to ROM** is meant to be the "push a bit further" goal for the coaching (`encourageThreshold`, read in
  `SessionRunner`). When "Not set", its slider thumb still sits part-way along the track, which looks like a value.
- Seen on the assign screen: a horizontal scrollbar under the exercise card (the row is wider than the panel).
- To work through with the owner: what each number should mean clinically, sensible defaults and limits (encourage
  above expected; expected not below what the camera can tell apart), how they show on the patient's screen, and
  how the front-view measurement's accuracy near overhead (±6-10°) affects targets above about 150°.

## 3D depth camera for front-facing measurement

- **Why:** the product mockups have the patient facing the screen (kiosk, desk monitor). A forward arm raise and a
  seated knee extension move toward a front camera, which a plain 2D webcam cannot measure through mid-range, so today
  the positioning coach asks patients to turn side-on for those exercises.
- **Options:** (1) BlazePose's own 3D estimate (`keypoints3D`) with an ordinary webcam: try first, compare front-view
  readings against side-view ones; (2) a depth camera (Orbbec Femto Bolt, Intel RealSense D455 class), which measures
  depth properly but needs a native app, not the browser; (3) iPad Pro LiDAR with Apple's 3D body tracking (native).
- **Status:** the owner is looking into buying a depth camera (2026-11-25). Decide after the keypoints3D experiment.
- **keypoints3D experiment started (v0.4.0, 2026-11-26):** `lib/biomechanics/world3d.ts` computes the arm's elevation
  and plane from BlazePose's 3D output; each TRACE line logs it (`3d: elev plane`) next to the 2D estimate
  (`metric`, `plane2d`). Compare over a few real runs; if 3D agrees and is steadier, score with it.
- **First run (2026-11-26, v0.4.0):** the 3D plane separated forward raises (30-38°) from sideways ones (80-90°)
  cleanly, where the 2D estimate wrongly failed two forward reps; v0.4.1 uses 3D for the form checks. Elevation: 3D
  read 5-25° higher than 2D near the top (2D 110° vs 3D 117-135°). Next: a check run with known angles (arm level
  forward = 90°, straight up = 180°, held 3 s each, side photo for reference) to decide which elevation to score with.
  Webcam 3D may make the depth camera unnecessary for these exercises.
- **Affects:** `positionSetupFor` (camera side per exercise), the measurement metrics, and whether a native app is
  needed.

## Other open items

- Apply `supabase/migrations/20261125000100_security_hardening.sql` (needs the owner's go-ahead; see CLAUDE.md).
- Protect `/api/coach` and `/api/tts` (open to anyone; OpenAI cost).
- Portrait session screen to match the mockups (instruction card, ROM dial with target, reps ring, symmetry, timer).
- Baseline assessment mode (best reach per joint, saved as the patient's starting point).
- Tablet / kiosk packaging (installable full-screen web app first).
- Landing page claims ("94% session completion", "3x more data", "PIPEDA compliant") need backing data or softer
  wording before a public launch.
- The patient session screen (`SessionRunner`) is still dark; restyle it with the portrait redesign.
