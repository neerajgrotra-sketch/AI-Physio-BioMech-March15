# AI Physio BioMech ("Rehably")

A web app that guides physiotherapy exercises with the camera. A physio builds sessions for a patient; the patient
opens a session link, and the browser watches them through the webcam (MediaPipe BlazePose), counts reps, checks
height, hold, balance and form, and coaches them by voice. Physios log in to `/admin`; patients do not log in.

Live: https://ai-physio-bio-mech-march15.vercel.app (and https://demo2.powerpaneer.com), Vercel project
`ai-physio-bio-mech-march15`. Database: Supabase project **ai-physio-v2** (ref `vuigpzdykfzmcutyfcqx`, Canada).
The other Supabase projects named ai-physio are old; nothing uses them.

## Stack

Next.js 14 (App Router) + React 18 + TypeScript, Supabase (auth + Postgres), OpenAI (coaching text and speech, server
routes only), `@tensorflow-models/pose-detection` with the BlazePose `mediapipe` runtime in the browser.

## Commands

- `npm run dev`: local server (needs `.env.local`, below).
- `npm test`: the vitest suite (`lib/**/*.test.ts`). Run before every commit.
- `npm run typecheck`: `tsc --noEmit`.
- `npm run build`: what Vercel runs. It builds with placeholder env values too.

Environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only, the
session page), `OPENAI_API_KEY` (server only). They live in Vercel; never commit them.

## The measurement pipeline (per camera frame)

`lib/session/useInferenceLoop.ts` runs it in a requestAnimationFrame loop:

1. `estimatePoses` (BlazePose) -> `lib/pose/normalizePoseFrame.ts`: 17 named landmarks, x / width and y / height,
   with each point's score.
2. `lib/biomechanics/extractMovementFeatures.ts`: joint angles and body state. **All geometry is done in true image
   proportions** (`toBodySpace` rescales x by width / height). Never compute an angle from raw normalised x and y: on
   16:9 that turns 45° into 29°. Landmarks under `MIN_LANDMARK_SCORE` (0.35) are treated as not seen.
3. `lib/biomechanics/smoothMovementFeatures.ts`: average of the last 5 frames. Then
   `lib/biomechanics/flexionView.ts` (`FlexionViewEstimator`): when the patient faces the camera, arm elevation is
   replaced by `acos(elbow drop / arm length)` (drop and the seen upper-arm length in torso lengths, or per shoulder
   width when the hips are hidden; the arm length starts at `TYPICAL_ARM` 0.6 and is learned as a high percentile of
   the seen length while the arm is in its lower half, so the angle is never blank). Side on, the plain
   2D angle is kept. Which way they face: shoulder width / torso, side under 0.35, front over 0.5.
4. `lib/engine/calibration.ts`: for arm exercises, a 3 s resting baseline, taken once the patient is placed (the
   positioning lock), sets start / target / finish (`calibrateThresholds`; the target is never shifted by the baseline;
   finish = baseline + 30% of the way to the target, so a hand resting on a desk between reps still finishes a rep;
   baseline capped at 45). Then `FeatureSpikeFilter` drops one-frame
   glitches on the fields the exercise reads.
5. `lib/interpreter/movementInterpreter.ts` + `repStateMachine.ts`: the rep state machine (ready -> lifting -> top ->
   holding -> lowering), pass or fail with a reason (height, hold, balance, isolation, bilateral participation).
   **A rep is judged and counted the moment its hold is done** (or the target is reached, with no hold); lowering
   only waits for the arm to come back: below finish, or half way down and rising again (`REARM_*`), which starts the
   next rep. A hold dropped early fails at once (`failed_hold`). Isolation: the other arm may not rise more than
   `maxOppositeArmElevationDeg` above where it rested while ready (`oppositeRest`), not an absolute 35° (a seated
   patient's resting arm reads 40-60°). Form (forward raises facing the camera, plane over `MAX_PLANE_DEG_FLEXION`
   75° = out to the side; was 60, v0.9.2; Coach Lab `sidewaysAllowanceDeg` via `setMaxPlaneDeg`) is judged AT THE TARGET, and since v0.11.0 also ON THE WAY UP
   (`lib/interpreter/liftPath.ts`: the plane's median while lifting through 45-100° measured must be within the allowance
   minus 15°, else the rep is a side raise, `pathSidewaysNow`, held nowhere, failed_form; the owner found abduction passed the
   top check, where both movements converge near overhead; this ends the earlier allowance for lifting sideways and then
   swinging in front); the hold runs only while the arm
   is in front (it waits at `top`; a form slip mid-hold is ignored for `HOLD_SLIP_GRACE_MS` 1 s (Coach Lab
   `holdSlipSeconds`), and a longer one PAUSES the hold, which resumes with the time already held, `heldBeforeSlipMs`;
   the owner's run A-57EDFCAD had the plane wavering at 55-75° and a hold restarting six times), (raising sideways and
   bringing the arm in front while up no longer counts since v0.11.0, the path check above); lowering without ever
   holding it in front fails as `failed_form`. A straight arm is required the same way (`FormIssue` "elbow"): the hold
   only runs with the elbow straight (3D elbow angle under `STRAIGHT_ELBOW_DEG` 135 = bent; 2D: the hand far above OR
   below where a straight arm puts it), so lifting the upper arm alone with the forearm hanging no longer counts; it
   fails as `failed_straight_arm` ("Keep your arm straight, and lift it from the shoulder."). The plane and bent elbow
   come from BlazePose's 3D estimate when it has one (`applyWorld3DForm`, lib/biomechanics/world3d.ts, applied in the
   loop after flexionView), else from the 2D `armForm`; the replay has no 3D input, so tests cover the 2D path.
   A missing reading (`null`) pauses the rep; it must never be treated as 0°.
6. Coaching (`lib/coaching/*`, `lib/engine/*`) and framing (`lib/framing/*`) sit on top.

`lib/testing/replay.ts` repeats steps 2-5 for the tests. **If you change the order or steps in the loop, change the
replay too**, or the tests stop proving anything.

### Metrics (what each exercise measures)

| Exercise slugs | Metric | Convention | Camera |
|---|---|---|---|
| `shoulder_flexion_*` (arm forward) | `*ArmElevationDeg` | upper arm from straight down: 0 rest, 90 level, 180 overhead | side, or front / either if the template says so (front: about ±3° mid-range, ±6-10° near overhead) |
| `shoulder_abduction_*` (arm out) | `*ShoulderAbductionDeg` | whole arm from straight down, same scale | front |
| `knee_extension_*` | `*KneeExtensionDeg` = `kneeAngleLeft/Right` | interior hip-knee-ankle: ~90 seated, 180 straight | side |
| `sit_to_stand` | posture (`isSeated` / `isStanding`) | seated from the knee angle (side) or thigh/shin ratio (front) | side |

Bilateral metrics are judged on min(left, right): both sides must make it.

Posture (`inferPosture`): from the side, the knee angle. Facing the camera the knee angle is useless (a seated
thigh points at the lens, so hip, knee and ankle line up and read ~170°, "standing"), so it uses the thigh's length
per torso length from knees really inside the frame (y <= 0.97): under 0.45 seated, over 0.6 standing, else unknown.
Points BlazePose guesses beyond the frame's edge are ignored.

### Exercise data notes

- Prescriptions are built from `exercise_templates` rows by slug in `lib/sessions/buildSessionPrescription.ts`
  (used by `app/session/page.tsx`). A new exercise needs a case there, a metric, and a replay test.
- Knee templates store ROM as **flexion** (90 bent, 0 straight; `rom_acceptable_min` 30 = within 30° of straight).
  `lib/exercises/kneeThresholds.ts` converts to the interior angle the app measures. A physio knee target of 90 or
  less is read as flexion, above 90 as an interior angle.
- The camera side and set-up for each exercise are decided by `positionSetupFor` (`lib/positioning/positionCoach.ts`).
  The template's Clinical Setup is read (`buildPrescription(..., { cameraPosition, patientPosition })`, from
  `app/session/page.tsx`): `camera_position` (front / side / either) is honoured for arm-forward raises only (knees and
  sit to stand are always side on, abduction always front); `patient_position` sets the posture asked for on arm
  exercises (knees and sit to stand always start seated). `measurement_spec` is not read at runtime (and is wrong for
  several rows).
- `lib/exercises/exerciseLibrary.ts` and `lib/exercises/definitions/*` are the older, hard-coded exercise set
  (`right-arm-raise` etc.), still used by `SessionRunner`/`SessionBuilder` for the local demo flow. The live sessions
  use the Supabase templates.

## Positioning (getting the patient where the camera can measure)

- `lib/positioning/positionCoach.ts`: `assessPosition` (pure, one frame) gives the first thing to fix, in order: in
  view, facing the right way (front or side, and which side toward the camera), fits top to bottom with room for the
  movement's peak (arms overhead, standing up), not too far, room left and right, seated or standing. `PositionTracker`
  steadies it: an instruction must last 500 ms before it replaces the last, and a good position held still for 1.5 s
  locks in. Once locked, small shifts (`TOLERATED_WHEN_LOCKED`: off centre, a little far) never unlock, and a real
  problem must last 3 s (`UNLOCK_AFTER_MS`). Tests: `positionCoach.test.ts`.
- Directions: front view in the patient's own terms ("step to your left": raw image-left is the patient's right);
  side view in screen terms. Arrows are in display terms; the preview is mirrored (`assessPosition(..., { mirrored })`).
- Wiring: `useFramingIntelligence.evaluateFraming` runs the tracker every ready-phase frame and turns it into the
  `PrerequisiteResult` that the inference loop and `SessionRunner` already use (met = locked). The loop's gate stops the
  rep state machine before the first rep until it is met, and the voice repeats the short instruction every 8 s while a
  problem lasts. `components/session/PositionGuideOverlay.tsx` draws the silhouette, arrows and hold ring; with
  `textInPanel` (the session screen) it shows no text, only an arrow badge, and the coach panel on the left carries
  the one instruction (big, coloured by state: amber adjusting, blue holding still), the setup line, a checklist
  (`lib/positioning/positioningSteps.ts`: seen, facing, fits, posture, still; done / now / to do) and the next
  exercise. The amber framing bar above the camera is hidden while positioning and exercising (the owner: the same
  words were shown three times).
- Between exercises (v0.7.2): `framingIntelligence.reset(msg, true)` keeps the placement when the next exercise needs the
  same set-up (`setupFamily`: view, posture, coverage, reach, and the side only when side on), so right then left arm
  raises facing the camera run straight on. If positioning is needed, the next exercise's spoken intro, the guide's
  demonstration and the rep coach wait until placed (`pendingIntroRef`, `placedForCoaching`).
- One thing at a time on the camera panel (`SessionRunner`: `positioningOnScreen`, `exerciseOnScreen`): while being
  positioned only the guide shows; the skeleton (faint) and the ghost demo appear once the session is running and the
  patient is placed, and the ghost's demo timer starts then. The ghost (`lib/pose/ghostAnimator.ts`) demonstrates a rep
  like a physio (`demoCycle`: rise, pause at the target, lower, pause), holds at the target with the patient, lowers
  back to rest with them after the rep, and 1.5 s later shows the next one (one clock, `demoClock`, for the movement
  and the narration). Facing the camera, forward raises show the guide figure, "the physio" (`lib/pose/exampleCard.ts`):
  a small 3D figure drawn as a mirror image, centred in its card, seated or standing like the patient (steadied by
  `lib/pose/postureLatch.ts`: the legs, read in every phase but the top; it switches after the other posture is seen for 4 s and is kept across
  exercises; with no leg reading it keeps its posture (v0.11.0 guessed from the shoulders rising, and leaning toward a
  laptop read as standing; removed in v0.12.0);
  using the exercise's arm; seen side on at the start of a demonstration, then walking slowly round the patient
  between three-quarter (62°) and nearly facing them (18°) every `GUIDE_ORBIT_S` (14 s, the testers' request),
  facing the patient (25°) to show "in front of you" when they go out to the side; it demonstrates once, then waits (`demoOnceThenWait`), and during a rep
  mirrors the patient's own arm. `lib/coaching/demoNarrator.ts` narrates the demonstration in step with it ("Watch me
  first… up to here… and slowly down… your turn"; shorter on repeats). A short marker beside the raised arm marks
  where the ELBOW must reach, with a dot on the patient's elbow, never across the face (`lib/pose/reachGuide.ts`); a
  glowing circle shows where the HAND should reach (testers' request, v0.9.1): from geometry at first
  (`handTargetPoint`: up from the shoulder by 1.9 upper arms x cos(target)), then where this patient's hand actually
  was each time the measured angle crossed the target with a straight arm (`handOffset`, the middle of the last 7,
  `targetFromOffset`; v0.9.2: geometry alone sat well below the hand because the measured angle reads lower than the
  true one near the top); green with a tick only when the rep will count (the measured angle made it); the elbow bar loses its label while the circle shows (Coach Lab: "On the
  camera" switches for both); and
  `drawArmLabel` labels the arm to use ("RIGHT ARM") before the first rep and, red, on the wrong arm.
  `lib/coaching/repCoach.ts` coaches through the rep: "A little higher", "Keep your arm straight", "Bring your arm in
  front of you" / "That's better", "That's your left arm. Rest it down and lift your right arm.", "And again". The wrong-arm
  call is a correction: it interrupts other speech, fires on every new wrong lift (at most every 2 s) and repeats while the
  arm stays up; and the guide doesn't re-demonstrate while the patient is moving (`lastActivityMs`). Where the other arm
  rests is one shared rule, `lib/interpreter/restEstimate.ts` (RepCoach and the isolation check): learned only
  while waiting between reps, slowly (about 3 s) in BOTH directions, ignoring anything 10° above it. v0.6.0 chased a
  lifted arm (wrong arm never called); v0.6.1 followed dips down quickly, so a camera glitch made the resting arm
  look lifted and every hold failed isolation (v0.8.0 run A-A4D8281D).
- Layout (`SessionRunner`, row 2, the 10-foot layout from the owner's mockup, v0.6.0): the guide in its own panel
  on the left (`guideCanvasRef`, `drawExampleCard({ full: true })`, shown for forward raises facing the camera;
  otherwise the panel shows the exercise and its instruction, or the positioning message), the camera large on the
  right with a big rep count and one instruction band (the coaching line, or "Hold it there… n"; coloured by tone).
  On a screen taller than wide (`isPortrait`, a monitor turned upright) or a phone, the guide stacks above a
  full-width camera. Side by side the coach panel takes the camera panel's height (its content sits in an absolute box, scrolling if
  needed); with the guide in its own panel the camera shows no instruction band; it keeps the score ring
  (percentage, top left: the owner uses it to see compliance), the rep count, the elbow marker and the arm label: the guide's caption carries the instruction and hold count.
  Patients never see degrees (`lib/coaching/plainHeight.ts`: "to shoulder height", "up to head height"; knees "until your
  leg is straight"); degrees stay in the panels underneath and the logs.
  Before Begin Session (`welcomeOnScreen`) the guide panel lists the plan (greeting, protocol,
  each exercise's reps, hold and target, the time) and the camera panel shows "Before you start" and a big Begin
  button, not "Camera is off". During the spoken greeting the coach panel greets (name, the greeting's words as a
  caption, `greetingCaption`) and the camera panel only says the camera is about to start; when placed, the coach
  panel says "Perfect…" and the camera panel shows a tick (one message, one place). The header (v0.7.0) holds only
  what the panels don't: logo, assignment and build (small), the AI status light (checked on load; green glow
  connected, red blinking offline, click to re-check), voice on/off, Test sound, and once running the timer, Pause,
  End session, Restart. The plan list scrolls for long protocols, and during a session the guide panel starts with
  "EXERCISE i OF n", a segment bar and "Next: …". Live Coaching, progress, Camera Sees, session details and the logs sit underneath for now. Text there is sized
  to be read from 2-3 m. Parked details: BACKLOG.md "Session screen layout".
- `lib/biomechanics/world3d.ts` reads the arm from BlazePose's keypoints3D (depth estimated from the webcam). Its plane
  and elbow angle drive the form checks; its elevation is only logged (`3d: elev plane elbow` on TRACE) until a check
  run says whether it or the 2D angle is closer. Code outside React renders (the ghost loop) must read
  `inferenceLoop.getFeatures()`, not `inferenceLoop.features` (a copy frozen when the loop started). Voice: the rep-completed line ends "Now lower your
  arm slowly"; holds of 3 s or more count the last seconds aloud.
- Test logs: the debug log is saved to `session_debug_logs` every 30 s while running, when the tab is hidden, and at
  the end (read the newest row per session). It starts with an `APP` entry (version, commit) and has a `TRACE` line
  each second: phase, metric, start / target / finish, view, learned arm length, placed, reps, baseline.
- `lib/engine/readinessEngine.ts` and `framingMonitor.evaluatePrerequisites` are the older checks; the readiness text
  is still shown in the observation panel, `evaluatePrerequisites` is no longer called.

## Look and feel

- The signed-in app (login, admin, access pages) uses the landing page's light look: `components/brand/brand.tsx`
  (`BRAND` colours and fonts, `BrandLogo`). The Inter and Plus Jakarta Sans fonts load once in `app/layout.tsx`. The
  admin page maps its `C` tokens onto `BRAND`; use those tokens, not new hard-coded colours. The patient session
  screen is still dark (to be restyled with the portrait redesign).
- Parked ideas and decisions waiting on something are in `BACKLOG.md`.

## Database

- `supabase/migrations/20261125000000_baseline_schema.sql` is the whole live schema (tables, functions, triggers, RLS
  and policies), exported from the live project; `supabase/seed.sql` is the default clinic and the 10 system templates.
  Both were checked by building a fresh Postgres from them. Do not run the baseline against the live project.
- Every schema change from now on is a new dated file in `supabase/migrations/`, applied with that file (Supabase
  MCP `apply_migration` or the CLI). Never change the live schema by hand in the SQL editor without saving the file.
- Row level security is on for every table. Physios see their clinic's rows through `my_clinic_id()`. The patient
  session page (`app/session/page.tsx`) reads with the **service role** on the server, so anyone with a session link
  can open that session; keep that page server-only and never send the service key to the browser.
- `20261125000100_security_hardening.sql` is **written but not applied** (see its header): sign-up currently trusts
  the role and clinic sent from the browser. Apply it only with the owner's go-ahead, because new sign-ups will then
  wait for a clinic to be assigned.
- Free Supabase projects pause after about a week idle. If the site says it cannot reach the database, restore
  ai-physio-v2 in the Supabase dashboard (it takes a few minutes).

## Known gaps (not yet fixed)

- `/api/coach` and `/api/tts` are open to anyone (patients use them without logging in), so they can run up the OpenAI
  bill. They need a check, such as a valid session id and a rate limit.
- Results and debug logs (`session_results`, `exercise_results`, `session_debug_logs`) are written from the browser
  with the anon client, and RLS only lets clinic staff insert them: they save when a physio is signed in on the same
  browser (all tests so far), not for a real patient. Move them behind a server route like `api/session/progress`.
- `SessionRunner.tsx` (~2,400 lines) and `useInferenceLoop.ts` (~800) are too big; split them when you touch them.

## The range check (v0.12.0, the owner's idea)

- Before each arm's first forward raise (once per arm per session; not when continuing a paused session; Coach Lab
  `reachCheckOn`), once the resting baseline is taken: "Lift it forward, as high as is comfortable, and hold it there."
  `lib/session/reachCheck.ts` `ReachCheck` (intro -> up -> hold -> down -> done; reminds once at 12 s, carries on at 25 s)
  while the loop holds the rep counter (`useInferenceLoop` `setRepHold`, `isCalibrated`); the guide mirrors the arm, the
  rep coach, the demonstration and the target markers wait. "Comfortable", not "as high as you can" (rehab patients);
  missing the target is never called a failure.
- Order (v0.12.1, the owner's run: the intro said "raise your right arm", reps were already open, then the check cut in):
  while a check is due (`reachDue`) the rep counter is held from the exercise's start and the exercise intro is deferred
  (`deferredIntroRef`) until the check ends; then the intro and the guide's demonstration.
- After "All exercises complete" (`sessionDoneRef`), while the exercise phase is `complete`, and while the patient is away,
  the rep coach, the guide's narration and the range check are silent (`coachable`; it called "that's your left arm" over
  the summary).
- It gives: the comfortable range (peak measured angle, the target's scale) saved as
  `exercise_results.comfortable_range_deg` (migration `20261128000000_comfortable_range.sql`, applied) and shown on the
  admin result ("comfortable range"); hand positions at the target, which seed the hand circle (`handSamplesRef`) so it
  is right from rep 1; and the gap between BlazePose's 3D angle and the measured one (`AngleBias`, also learned on every
  lift), which raises the geometric circle when the target hasn't been reached yet. REACH log entries, `reach=` on TRACE.

## Coach Lab (v0.9.0, admin -> Coach Lab)

- `lib/coach/coachSettings.ts`: every adjustable coach behaviour with its default (the tuned value), range, group and
  plain explanation (guide orbit on/off, speed, nearest/furthest angle; sit/stand switch delay; voice speed; demo
  narration; wrong-arm rise and delay; other-arm allowance (isolation); resting-place settle time; "a little higher"
  delay; walk-away pause, countdown and close). `resolveCoachSettings` fills gaps and clamps, so saved values can
  never break a session; `changedFromDefaults` is what gets saved; `orbitYaw` is the guide's turn.
- Saved per clinic in `public.coach_settings` (migration `20261127000200_coach_settings.sql`; RLS: the clinic's
  staff; `clinic_id` defaults to `my_clinic_id()`). The session page reads the row for the session's clinic with the
  service role and passes it to SessionRunner (`coachSettings` -> `coach` / `coachRef`), which configures RepCoach
  (`configure`), the isolation rest settle (`setRestSettleMs`), PostureLatch, `awayState` thresholds, the orbit, the
  voice rate, narration on/off, and patches `maxOppositeArmElevationDeg` on the prescriptions.
- The admin tab (`CoachLabTab` in app/admin/page.tsx): a live guide preview drawn by the session's own
  `drawExampleCard` (seated/standing, arm, target with its plain words, "in front of you"), voice samples at the
  chosen speed, the settings by group with "changed" dots and per-setting default, Save / Undo / Reset to defaults.
  A new setting: add it to `CoachSettings`, `COACH_DEFAULTS` and `COACH_SETTING_DEFS`, then read it in the session.

## Per-patient tolerances (v0.10.0, the owner's decision)

- Clinical tolerances are set per patient, per exercise, when a protocol is assigned (admin, patient -> Assign
  Protocol, "How forgiving"): how far the arm may drift out to the side and still hold (`sidewaysAllowanceDeg`, forward
  raises), how long a slip in the hold is ignored (`holdSlipSeconds`), how far the other arm may move
  (`otherArmAllowanceDeg`, one-arm raises). Presets Standard (the clinic's values) / Gentle / Strict, or sliders.
- `lib/coach/patientTolerances.ts`: `PRESETS`, `cleanTolerances`, `effectiveTolerances` (patient's value, else the
  clinic's Coach Lab default, else built-in), `presetOf`. Saved on `session_block_exercises.tolerances` (only what the
  physio changed; migration `20261127000300_exercise_tolerances.sql`), read by app/session/page.tsx onto
  `ExercisePrescription.tolerances`; SessionRunner applies them when each exercise starts (`setMaxPlaneDeg`,
  `setHoldSlipMs`) and patches `maxOppositeArmElevationDeg`. The Coach Lab keeps these three as clinic defaults.

## Pausing and resuming (v0.8.0, the owner's decisions)

- Statuses: pending -> in_progress (on Begin) -> completed, or `paused` (ended early or walked away with exercises
  left). Migration `20261127000100_session_pause_resume.sql`: `paused` in the check, `sessions.progress`
  (`{ done, total, updated_at }`), `paused_at`, `pause_reason` (`ended`, `walked_away`).
- Saved through `app/api/session/progress` (service role, the session id is the key, only status and progress
  change), because patients are not signed in: on Begin, after each exercise, on End and when walking away.
- `lib/session/resume.ts` `resumePlan`: resumable the SAME DAY only, if something was finished and something is
  left and the protocol still has the same number of exercises; Continue runs the unfinished ones (`runIndexes`,
  `fullIndexOf`, `combinedQueue` = the run, `fullQueue` = the protocol), an exercise cut off part way starts again;
  Start over runs them all. The welcome screen says "Welcome back, you finished x of n" with ticks.
- End session asks: Save and finish later (paused), Finish now (completed; not done recorded as not done), Keep going.
- Walking away (`awayState`): nobody seen 10 s -> coaching paused and the coach panel says so; 60 s -> countdown
  "Saving and closing in 30..."; 90 s -> saved as paused, session ends. Seen again or "I'm back" carries on. A hidden
  tab pauses (Resume). Not during positioning or a rest screen.
- Admin: paused / in-progress assignments show "x of n exercises done, paused <time>, patient walked away", count
  as to do, and the button reads Continue Session.

## Assignment IDs

- Assigning a protocol to a patient creates a `sessions` row; its id is the assignment. `lib/app/assignment.ts`
  `assignmentCode(id)` is its readable form, `A-` + the first 8 hex characters (e.g. `A-C3CD9D46`), shown on the admin
  session card (click copies the full id), on the session screen, and in the APP entry at the top of every saved debug
  log. Look one up with `replace(sessions.id::text,'-','') ilike '<8 chars>%'`; each run is a `session_results` row
  (`prescription_id`), logs are `session_debug_logs.session_id`, the protocol is `sessions.source_protocol_id`.

## Versions

- The version is `package.json`'s `version` plus the commit Vercel built: `next.config.mjs` puts them in
  `NEXT_PUBLIC_APP_*`, `lib/app/version.ts` (`versionLabel()`, e.g. `v0.2.0 · 2622702`, with the branch on test builds)
  shows them in the admin header and on the session screen, and every saved debug log starts with an `APP` entry
  holding them. Raise the version for changes testers should notice (MINOR for a feature, PATCH for a fix).

## Branches and deploys

- Vercel deploys production from the branch set in the Vercel project; it was `feature/-module20-ghost-split-by-exercise`
  until this branch. Keep `main` as the live code: merge work into `main` and deploy from it.
- Commits are authored as the owner (`neerajgrotra-sketch`).
