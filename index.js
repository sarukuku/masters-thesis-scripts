'use strict'

const utils = require('./utils.js')
const argv = require('yargs').argv;

(async () => {
  // Start measuring the exectuion time.
  console.time('Task duration')

  // What task to run
  switch (argv.task) {
    case 'import-fi-tld-data-to-db':
      if (!argv.filePath) {
        console.warn('You didn\'t give a --file-path to the JSON file. I\'ll quit')
      }
      await utils.importFiTldDataToDb(argv.filePath)
      break
    case 'test-http-status':
      await utils.gatherHttpStatusData(argv.dbPath)
      break
    case 'test-dependencies':
      await utils.gatherDependencyData()
      break
    case 'http-status-analysis':
      await utils.analyzeHttpStatusData()
      break
    default:
      console.warn('You didn\'t select a task to run. I\'ll quit.')
      return
  }

  // We're done.
  console.log('All done!')

  // Output the exection time.
  console.timeEnd('Task duration')
})()
