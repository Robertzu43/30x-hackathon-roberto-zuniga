# Hackathon context (read by every agent; product uses it to shape SPEC.md)

## What the event is
- 30X Hackathon, 16-18 Oct 2026, fully online, LATAM. Organiser 30X (executive education).
- Companies bring real operational problems "with the context needed to build solutions".
- Winners go to evaluation so their project gets implemented directly with the company.
- Product and engineering mentors available during the event.
- "Un fin de semana, un proyecto funcional": judged on whether it works, not on the pitch.

## Dates that bind the plan
- 16 Oct: kickoff. Challenges, evaluation criteria and itinerary are shared here, not before.
- 18 Oct: deadline to upload the project. Roberto writes the exact time on the next line at kickoff; until then agents assume 2026-10-18T12:00-05:00.
DEADLINE: 2026-10-18T12:00-05:00
RUN: r202610162341
- 19-20 Oct: Demo Day in front of the companies. The company decides.
- 21 Oct: winners announced.

## Rules that bind the build
- Repo must be PUBLIC during review. No secrets in the repo, ever. Use env vars and `.env.example`.
- Building before kickoff is not allowed; the first commit is after kickoff.
- AI tooling is fully allowed. Solo participation allowed.
- Prizes: USD 2,000 pool plus places in 30X programmes. Small money; the real prize is the company implementing it.

## What this means for the product
- The judge is the company that owns the problem, not a panel of engineers. Optimise for "we could run this on Monday".
- Demo Day is live and remote: the deployed URL must work on a shared screen with no setup. The `/demo` page with seeded data is a MUST.
- README must explain the project to a non-technical decision maker in the first 10 lines.
- Spanish is the working language of the event. UI copy, README and demo data are in Spanish unless `docs/DECISIONS.md` says otherwise. Code, comments and commit messages stay in English.
- Mentors are product and engineering people: Roberto books them; agents prepare a 5-line "what we want a mentor to validate" note in the ledger before each check-in.

## Sponsors and partners (from the event page)
Asilo Digital (asilodigital.com), Wave (wavehub.tech), JaveBlockchain, Lovable (lovable.dev), Opportuni, Next (nextfellow.ai), Makers (makers.ngo).
What this changes: Lovable sponsoring means judges will have seen plenty of AI-generated prototypes that look good and break on first use. Our edge is the opposite: tests, deploy, honest "not done" list, and the ledger showing how decisions were made. Do not chase visual polish over working flows.
No sponsor technology is required. Do not add a dependency because a sponsor makes it.

## Filled at kickoff by Roberto
- Company and challenge: see `docs/PROBLEM.md`.
- Evaluation rubric (verbatim, kickoff slide "07 Evaluación: Cómo evaluamos"):
  - 30% Impacto en el reto: "¿Qué tan bien resuelve el problema real que planteó la empresa?"
  - 20% Innovación: "¿Va más allá de lo obvio y usa la IA con intención?"
  - 20% Viabilidad técnica: "¿Funciona de verdad y el código lo respalda?"
  - 20% Viabilidad de implementación: "¿La empresa podría adoptarlo con sus restricciones reales?"
  - 10% Presentación: "¿Comunican bien el problema, la solución y el impacto?"
  Plus the challenge's own success axes (docs/PROBLEM.md): Autonomía, Seguridad (one wrong approval disqualifies), Explicabilidad.
- Weighting / what this means for the build: 70% is "does it solve Blinka's real problem, does it really work, could Blinka adopt it". Innovation is scored on AI used *with intent* (reading + typed judgments that only make the agent safer), not on AI everywhere. Presentation is README + `/demo` + the recorded happy path.
- Submission format (HackRadar "Mi proyecto" form, Roberto fills it from the phone before 2026-10-18T12:00-05:00):
  - "Identidad del proyecto": Nombre del proyecto, Reto que resuelve (dropdown), Descripción (max 5000 characters) "que verá el jurado".
  - "Entregables", three links, all OBLIGATORIO: "Repositorio público de GitHub" (README must explain the app, its flows and its architecture), "Video demo (URL)", "Demo (URL)".
  - What the agents produce so Roberto only pastes: `docs/SUBMISSION.md` with the project name, the description text (<= 5000 chars, Spanish, written for the jury), the deployed URL, and the video: the recorded happy path is saved as a video file (Playwright recording) and published at a public URL the agents control (Supabase Storage public object or the Worker's static assets) so the "Video demo (URL)" field never depends on a YouTube upload. Roberto may re-upload it to YouTube/Loom if he prefers.
