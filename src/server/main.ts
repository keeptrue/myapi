import { logger } from './logger.js'
import { startServer } from './server.js'

void startServer().catch(error => {
  logger.error('fatal', error)
  process.exit(1)
})
