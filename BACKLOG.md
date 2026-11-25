# Backlog

Parked ideas and decisions waiting on something. Newest first.

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
