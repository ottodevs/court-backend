#! /usr/bin/env node

import path from 'path'
import errorHandler from '../src/helpers/error-handler'
import sleep from '@aragon/court-backend-shared/helpers/sleep'
import Logger from '@aragon/court-backend-shared/helpers/logger'

let [workerPath, name, times, tries, repeat] = process.argv.slice(2)
if (!workerPath) throw Error('Cannot start worker with missing path')
if (name === undefined) name = 'unknown'

times = (times === undefined) ? 1 : parseInt(times)
tries = (tries === undefined) ? 1 : parseInt(tries)
repeat = (repeat === undefined) ? 0 : parseInt(repeat)

Logger.setDefaults(false, true)

const logger = Logger(name)
const worker = require(path.resolve(process.cwd(), workerPath)).default

async function run() {
  logger.info(`Starting worker, will run ${times} jobs`)
  for (let job = 1; job !== times; job++) {
    try {
      logger.info(`Creating job #${job}`)
      await worker(name, job, tries, logger)
      const minutes = job === times ? 0 : repeat / 60
      logger.success(`Job #${job} finished successfully${minutes > 0 ? `, will get back in ${minutes} minutes` : ''}`)
    } catch (error) {
      logger.error(`Job #${job} exited with error: ${error.message}`)
      console.error(error)
    }
    await sleep(repeat)
  }
  logger.success(`Worker finished`)
}

run()
  .then(() => process.exit(0))
  .catch(errorHandler)
