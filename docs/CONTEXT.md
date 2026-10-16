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
DEADLINE: <Roberto fills at kickoff, ISO with offset, e.g. 2026-10-18T18:00-05:00>
RUN: <set by the launcher on a fresh start, e.g. r202610161900; names this run's branch namespace>
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
- Evaluation rubric (verbatim):
  <paste here>
- Weighting / what they said matters most:
  <paste here>
- Submission format (repo link? video? form?):
  <paste here>
