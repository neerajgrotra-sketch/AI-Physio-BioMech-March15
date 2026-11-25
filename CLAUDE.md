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
3. `lib/biomechanics/smoothMovementFeatures.ts`: average of the last 5 frames.
4. `lib/engine/calibration.ts`: for arm exercises, a 3 s resting baseline sets start / target / finish
   (`calibrateThresholds`; the target is never shifted by the baseline). Then `FeatureSpikeFilter` drops one-frame
   glitches on the fields the exercise reads.
5. `lib/interpreter/movementInterpreter.ts` + `repStateMachine.ts`: the rep state machine (ready -> lifting -> top ->
   holding -> lowering), pass or fail with a reason (height, hold, balance, isolation, bilateral participation).
   A missing reading (`null`) pauses the rep; it must never be treated as 0°.
6. Coaching (`lib/coaching/*`, `lib/engine/*`) and framing (`lib/framing/*`) sit on top.

`lib/testing/replay.ts` repeats steps 2-5 for the tests. **If you change the order or steps in the loop, change the
replay too**, or the tests stop proving anything.

### Metrics (what each exercise measures)

| Exercise slugs | Metric | Convention | Camera |
|---|---|---|---|
| `shoulder_flexion_*` (arm forward) | `*ArmElevationDeg` | upper arm from straight down: 0 rest, 90 level, 180 overhead | **side** |
| `shoulder_abduction_*` (arm out) | `*ShoulderAbductionDeg` | whole arm from straight down, same scale | front |
| `knee_extension_*` | `*KneeExtensionDeg` = `kneeAngleLeft/Right` | interior hip-knee-ankle: ~90 seated, 180 straight | side |
| `sit_to_stand` | posture (`isSeated` / `isStanding`) | seated from the knee angle (side) or thigh/shin ratio (front) | side |

Bilateral metrics are judged on min(left, right): both sides must make it.

### Exercise data notes

- Prescriptions are built from `exercise_templates` rows by slug in `lib/sessions/buildSessionPrescription.ts`
  (used by `app/session/page.tsx`). A new exercise needs a case there, a metric, and a replay test.
- Knee templates store ROM as **flexion** (90 bent, 0 straight; `rom_acceptable_min` 30 = within 30° of straight).
  `lib/exercises/kneeThresholds.ts` converts to the interior angle the app measures. A physio knee target of 90 or
  less is read as flexion, above 90 as an interior angle.
- `exercise_templates.camera_position` says `front` for shoulder flexion, but flexion can only be measured from the
  side; and the app does not yet read `camera_position` at all. `measurement_spec` is not read at runtime either (and
  is wrong for several rows). Both are known; fix them with the positioning work.
- `lib/exercises/exerciseLibrary.ts` and `lib/exercises/definitions/*` are the older, hard-coded exercise set
  (`right-arm-raise` etc.), still used by `SessionRunner`/`SessionBuilder` for the local demo flow. The live sessions
  use the Supabase templates.

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
- Positioning: `readinessEngine`, `framingMonitor.evaluatePrerequisites` and the AI framing evaluator overlap; none
  checks the camera angle (front vs side) or that the peak of the movement will stay in frame, and distance checks use
  raw normalised coordinates. This is the next piece of work.
- `SessionRunner.tsx` (~2,400 lines) and `useInferenceLoop.ts` (~800) are too big; split them when you touch them.

## Branches and deploys

- Vercel deploys production from the branch set in the Vercel project; it was `feature/-module20-ghost-split-by-exercise`
  until this branch. Keep `main` as the live code: merge work into `main` and deploy from it.
- Commits are authored as the owner (`neerajgrotra-sketch`).
