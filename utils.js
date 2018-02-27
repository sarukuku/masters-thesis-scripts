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
    async.mapLimit(domains, 200, async (domainObj) => {
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
    const curl = spawn('curl', [ '-s', '-o', '/dev/null', '-I', '-L', '-w', '"%{http_code}"', domain ], {shell: '/bin/bash'})

    // Collect results to a variable.
    curl.stdout.on('data', data => {
      collectedData += data.toString()
    })

    // Reolve when the process exits.
    curl.on('close', exitCode => {
      clearTimeout(timerId)
      resolve(collectedData)
    })

    // Limit the child process execution time to 5 seconds.
    const timerId = setTimeout(() => {
      curl.kill()
      collectedData = 'timeout'
      resolve(collectedData)
    }, 20000)
  })
}

const getDependencyData = async domain => {
  return new Promise(resolve => {
    // Spawn a new process.
    let collectedData = ''
    const yarn = spawn('yarn --silent start', [ '--silent', 'start', '-l', '--output=json', `--url=http://${domain}/` ], {shell: '/bin/bash', cwd: '/Users/Joonas/Documents/Code/Tools/dependency-checker'})

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

  // Map over all domains, limit to 30 calls at once.
  await new Promise(resolve => {
    async.mapLimit(domains, 10, async (domainObj) => {
      console.log(`Testing domain: ${domainObj['Name']}.fi `)
      let dependencyJson = await getDependencyData(`${domainObj['Name']}.fi`)
      await db.saveDependencyJson(dependencyJson, domainObj['rowid'])
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
