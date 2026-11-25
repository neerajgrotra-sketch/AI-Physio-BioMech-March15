# AI Physio BioMech (Rehably)

Camera-guided physiotherapy exercises in the browser. Physios build sessions for their patients; patients open a
session link and the app watches them through the camera, counts reps, checks range of motion, hold time and form, and
coaches them by voice.

- Live: https://ai-physio-bio-mech-march15.vercel.app
- Stack: Next.js 14, React, TypeScript, Supabase, OpenAI, MediaPipe BlazePose (in the browser)

## Run it

```bash
npm install
```

```bash
npm run dev
```

It needs a `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
and `OPENAI_API_KEY`.

```bash
npm test
```

runs the measurement tests (every exercise replayed frame by frame).

## Exercises

Shoulder flexion (arm forward, camera at the side), shoulder abduction (arm out, camera in front), knee extension
(seated, camera at the side) and sit to stand (camera at the side), each left, right or both where it applies.

## More

- `CLAUDE.md`: how it is built, the measurement pipeline, the database, and the rules for changing them.
- `supabase/`: the database schema (migrations) and seed data.
- `docs/schema-notes-module9.md`: the older schema notes from modules 5-9.
