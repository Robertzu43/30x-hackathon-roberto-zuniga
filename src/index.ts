import { app } from './app'
import { scheduled } from './cron'

export default { fetch: app.fetch, scheduled }
