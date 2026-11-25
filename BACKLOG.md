# Backlog

Parked ideas and decisions waiting on something. Newest first.

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
