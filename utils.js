'use strict'

const { URL } = require('url')
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

exports.countUniqueKeysAnalysis = async (fieldName) => {
  // Fire it up.
  await db.openOrCreate()

  // Get all rows from the DB.
  const queryResults = await db.getAll(fieldName)

  // Loop over all rows and count HTTP status codes
  let statusCodes = {}
  queryResults.forEach(domainObj => {
    let statusCode = domainObj[fieldName]

    if (statusCodes.hasOwnProperty(statusCode)) {
      statusCodes[statusCode] += 1
    } else {
      if (statusCode) {
        statusCodes[statusCode] = 1
      } else {
        if (statusCodes.hasOwnProperty('emptyType')) {
          statusCodes['emptyType'] += 1
        } else {
          statusCodes['emptyType'] = 1
        }
      }
    }
  })

  // Log how many domains the query resturned.
  console.log(`Domains in the query results: ${queryResults.length}`)

  // Log how many domains the set has in total (for error checking)
  let totalCount = 0
  console.log('Counts (key,count):')
  for (let key in statusCodes) {
    console.log(`${key},${statusCodes[key]}`)
    totalCount += statusCodes[key]
  }
  console.log(`Domains in the result set: ${totalCount}`)

  // Shut it down.
  db.close()
}

exports.doDependencyOriginAnalysis = async () => {
  // Fire it up.
  await db.openOrCreate()

  // Initi vars that hold cumulative counts
  let failedCount = 0
  let successCount = 0
  let cuTotalRequests = 0
  let cuTotalSameOriginRequests = 0
  let cuTotalCrossOriginRequests = 0
  let cuCrossOriginPercentage = 0
  let cuResources = {}
  let hostnameCounts = {}
  let invalidURLs = []

  // Loop over all records and cumulate counts
  await db.forEachRecord(data => {
    console.log(failedCount + successCount)

    if (!data.DependencyJson.startsWith('{')) {
      failedCount += 1
      return
    }

    let domainObj = JSON.parse(data.DependencyJson)

    successCount += 1
    cuTotalRequests += domainObj.totalRequests
    cuTotalSameOriginRequests += domainObj.totalSameOriginRequests
    cuTotalCrossOriginRequests += domainObj.totalCrossOriginRequests
    cuCrossOriginPercentage += domainObj.crossOriginPercentage

    for (let key in domainObj.resources) {
      if (!cuResources.hasOwnProperty(key)) {
        cuResources[key] = {}
        cuResources[key].avgTotalCount = 0
        cuResources[key].avgSameOriginCount = 0
        cuResources[key].avgCrossOriginCount = 0
        cuResources[key].cumulativeDomainCount = 0
      }

      cuResources[key].avgTotalCount += domainObj.resources[key].totalCount
      cuResources[key].avgSameOriginCount += domainObj.resources[key].sameOriginCount
      cuResources[key].avgCrossOriginCount += domainObj.resources[key].crossOriginCount
      cuResources[key].cumulativeDomainCount += 1

      domainObj.resources[key].requests.forEach(req => {
        try {
          const url = new URL(req.url)
          if (!hostnameCounts.hasOwnProperty(url.hostname)) {
            hostnameCounts[url.hostname] = 0
          }

          hostnameCounts[url.hostname] += 1
        } catch (error) {
          invalidURLs.push(req.url)
        }
      })
    }
  }, 'HttpStatusCode=200')

  // Post process cumulative counts
  const avgRequests = (cuTotalRequests / successCount)
  const avgSameOriginRequests = (cuTotalSameOriginRequests / successCount)
  const avgCrossOriginRequests = (cuTotalCrossOriginRequests / successCount)
  const avgCrossOriginPercentage = (cuCrossOriginPercentage / successCount)

  for (let key in cuResources) {
    cuResources[key].avgTotalCount = cuResources[key].avgTotalCount / successCount
    cuResources[key].avgSameOriginCount = cuResources[key].avgSameOriginCount / successCount
    cuResources[key].avgCrossOriginCount = cuResources[key].avgCrossOriginCount / successCount
  }

  let hostnamesArr = Object.entries(hostnameCounts)
  hostnamesArr.sort((x, y) => y[1] - x[1])
  hostnamesArr = hostnamesArr.slice(0, 30)

  // Log results
  console.log(
    `failedCount: ${failedCount}`,
    `successCount: ${successCount}`,
    `avgRequests: ${avgRequests}`,
    `avgSameOriginRequests: ${avgSameOriginRequests}`,
    `avgCrossOriginRequests: ${avgCrossOriginRequests}`,
    `avgCrossOriginPercentage: ${avgCrossOriginPercentage}`,
    `invalidURLs: ${invalidURLs.length}`
  )

  console.log('cuResources:', cuResources)

  console.log('hostnamesArr:', hostnamesArr)

  // Shut it down.
  db.close()
}

exports.doPopularUrlsAnalysis = async () => {
  // Fire it up.
  await db.openOrCreate()

  let totalCount = 0
  let urlCounts = []

  // Loop over all records and cumulate counts
  await db.forEachRecord(data => {
    totalCount += 1
    console.log(totalCount)

    if (!data.DependencyJson.startsWith('{')) {
      return
    }

    let domainObj = JSON.parse(data.DependencyJson)

    for (let key in domainObj.resources) {
      domainObj.resources[key].requests.forEach(req => {
        try {
          const url = new URL(req.url)

          // Add url to array if it's not there yet otherwise grow count
          // Check if we can find it
          let foundIndex = null
          for (let i = 0; i < urlCounts.length; i++) {
            const o = urlCounts[i]
            if (o.url === url) {
              foundIndex = i
              break
            }
          }

          // Check was anything found and act based on that
          if (foundIndex) {
            urlCounts[foundIndex].count += 1
          } else {
            urlCounts.push({url: url, count: 1})
          }
        } catch (error) {
          console.error('Invalid URL')
        }
      })
    }
  }, 'HttpStatusCode=200')

  urlCounts.sort((x, y) => y.count - x.count)
  urlCounts = urlCounts.slice(0, 30)

  // Log results
  console.log('urlCounts:', urlCounts)

  // Shut it down.
  db.close()
}
