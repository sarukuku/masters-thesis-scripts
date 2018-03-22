'use strict'

const async = require('async')
const { spawn } = require('child_process')
const db = require('./db.js')

exports.importFiTldDataToDb = async filePath => {
  // Just require the whole fuckign blob, don't care about memory, we've got plenty.
  const { domains } = require(filePath)

  // Fire it up.
  await db.openOrCreate()
  for (let domain of domains) {
    // Add the domains.
    console.log(`Inserting domain: ${domain['Name']}`)
    await db.insertDomain(domain)
  }
  // Shut it down.
  db.close()
}

exports.gatherHttpStatusData = async filePath => {
  // Fire it up.
  await db.openOrCreate()

  // Get all rows from the DB.
  const domains = await db.getAllDomains()

  // Map over all domains, limit to 30 calls at once.
  await new Promise(resolve => {
    async.mapLimit(domains, 400, async (domainObj) => {
      let httpStatusCode = await getHttpStatusCode(`${domainObj['Name']}.fi`)
      await db.saveHttpStatusCode(httpStatusCode, domainObj['rowid'])
      console.log(`Domain: ${domainObj['Name']}.fi Status: ${httpStatusCode}`)
    }, (err, results) => {
      if (err) {
        console.log(err)
      }
      resolve()
    })
  })

  // Shut it down.
  db.close()
}

const getHttpStatusCode = async domain => {
  return new Promise(resolve => {
    // Spawn a new process.
    let collectedData = ''
    // curl -s -o /dev/null -I -L -w "%{http_code}" jsalovaara.fi
    const curl = spawn('curl', [ '-s', '-o', '/dev/null', '-I', '-L', '-w', '"%{http_code}"', '--connect-timeout', '60', '--max-time', '120', domain ], {shell: '/bin/bash'})

    // Collect results to a variable.
    curl.stdout.on('data', data => {
      collectedData += data.toString()
    })

    // Reolve when the process exits.
    curl.on('close', exitCode => {
      clearTimeout(timerId)
      resolve(collectedData)
    })

    // Limit the child process execution time (fallback for cURLs own limits).
    const timerId = setTimeout(() => {
      curl.kill()
      collectedData = '000' // Return the same code cURL would return for timeout
      resolve(collectedData)
    }, 130000)
  })
}

const getDependencyData = async domain => {
  return new Promise(resolve => {
    // Spawn a new process.
    let collectedData = ''
    const yarn = spawn('yarn --silent start', [ '-l', '--follow-redirects', '--wait=5000', '--output=json', '--silent', `--url=http://${domain}/` ], {shell: '/bin/bash', cwd: './../dependency-checker'})

    // Collect results to a variable.
    yarn.stdout.on('data', data => {
      collectedData += data.toString()
    })

    // Reolve when the process exits.
    yarn.on('close', exitCode => {
      clearTimeout(timerId)
      resolve(collectedData)
    })

    // Limit the child process execution time to 120 seconds.
    const timerId = setTimeout(() => {
      yarn.kill()
      collectedData = 'timeout'
      resolve(collectedData)
    }, 120000)
  })
}

exports.gatherDependencyData = async () => {
  // Fire it up.
  await db.openOrCreate()

  // Get all rows from the DB.
  const domains = await db.getWorkingDomains()

  // Map over all domains, limit concurrent tests.
  const totalDomains = domains.length
  let counter = 0
  await new Promise(resolve => {
    async.mapLimit(domains, 10, async (domainObj) => {
      let dependencyJson = await getDependencyData(`${domainObj['Name']}.fi`)
      await db.saveDependencyJson(dependencyJson, domainObj['rowid'])
      counter += 1
      console.log(`(${counter}/${totalDomains}) ${domainObj['Name']}.fi: ${dependencyJson.substring(0, 70)}...`)
    }, (err, results) => {
      if (err) {
        console.log(err)
      }
      resolve()
    })
  })

  // Shut it down.
  db.close()
}

exports.analyzeHttpStatusData = async () => {
  // Fire it up.
  await db.openOrCreate()

  // Get all rows from the DB.
  const queryResults = await db.getAll('HttpStatusCode')

  // Loop over all rows and count HTTP status codes
  let statusCodes = {}
  queryResults.forEach(domainObj => {
    let statusCode = domainObj['HttpStatusCode']

    if (statusCodes.hasOwnProperty(statusCode)) {
      statusCodes[statusCode] += 1
    } else {
      if (statusCode) {
        statusCodes[statusCode] = 1
      } else {
        if (statusCodes.hasOwnProperty('emptyStatus')) {
          statusCodes['emptyStatus'] += 1
        } else {
          statusCodes['emptyStatus'] = 1
        }
      }
    }
  })

  // Log how many domains the query resturned.
  console.log(`Domains in the query results: ${queryResults.length}`)

  // Log how many domains the set has in total (for error checking)
  let totalCount = 0
  console.log('Counts (code,count):')
  for (let key in statusCodes) {
    console.log(`${key},${statusCodes[key]}`)
    totalCount += statusCodes[key]
  }
  console.log(`Domains in the result set: ${totalCount}`)

  // Shut it down.
  db.close()
}
