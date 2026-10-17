// GET /api/fx (AC-73, AC-76): the newest stored market rate per currency, read with the user's JWT (RLS: members read,
// nobody writes). Never fetches: the cron and the agent do (R-85.6). The answer is fxOf's, shared with GET /api/screen/policy (R-132).
import { tasas } from '../agent/tools';
import { memberRoutes } from './agent';
import { fxOf } from './screen';

export const fx = memberRoutes().get('/', async (c) => c.json(fxOf(c.env, Object.values(await tasas(c.var.db)))));
