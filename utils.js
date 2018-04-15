'use strict'

const { URL } = require('url')
const async = require('async')
const { spawn } = require('child_process')
const db = require('./db.js')
const stat = require('./statistics-helpers.js')

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
    const curl = spawn('curl', ['-s', '-o', '/dev/null', '-I', '-L', '-w', '"%{http_code}"', '--connect-timeout', '60', '--max-time', '120', domain], { shell: '/bin/bash' })

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
    const yarn = spawn('yarn --silent start', ['-l', '--follow-redirects', '--wait=5000', '--output=json', '--silent', `--url=http://${domain}/`], { shell: '/bin/bash', cwd: './../dependency-checker' })

    // Collect results to a variable.
    yarn.stdout.on('data', data => {
      collectedData += data.toString()
    })

    // Resolve when the process exits.
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
  let cuResources = {}
  let hostnameCounts = {}
  let invalidURLs = []
  let totalRequestsPerDomain = []
  let totalRequestsPerResourceType = {}
  let totalCrossDomainRequests = 0
  let totalSameDomainRequests = 0
  let crossDomainRegistrantCountries = {}
  let crossDomainRegistrants = {}
  let protocols = {}
  let sameOriginRequestsPerDomain = []
  let crossOriginRequestsPerDomain = []

  // Loop over all records and cumulate counts
  await db.forEachRecord(data => {
    console.log(failedCount + successCount)

    if (!data.DependencyJson.startsWith('{')) {
      failedCount += 1
      return
    }

    let domainObj = JSON.parse(data.DependencyJson)

    successCount += 1
    totalRequestsPerDomain.push(domainObj.totalRequests)
    sameOriginRequestsPerDomain.push(domainObj.totalSameOriginRequests)
    crossOriginRequestsPerDomain.push(domainObj.totalCrossOriginRequests)

    for (let key in domainObj.resources) {
      // Per resource type
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

      // Per request per resource type
      domainObj.resources[key].requests.forEach(req => {
        try {
          // Parse URL
          const url = new URL(req.url)

          // Add to hostname counts
          if (!hostnameCounts.hasOwnProperty(url.hostname)) {
            hostnameCounts[url.hostname] = 0
          }
          hostnameCounts[url.hostname] += 1

          // Add to resource type counts
          if (!totalRequestsPerResourceType.hasOwnProperty(key)) {
            totalRequestsPerResourceType[key] = 0
          }
          totalRequestsPerResourceType[key] += 1

          // Total cross-domain & same-domain requests
          if (req.crossOrigin) {
            totalCrossDomainRequests += 1
          } else {
            totalSameDomainRequests += 1
          }

          if (req.whoisData) {
            // Add to registrant countries
            if (!crossDomainRegistrantCountries.hasOwnProperty(req.whoisData.registrantCountry.toUpperCase())) {
              crossDomainRegistrantCountries[req.whoisData.registrantCountry.toUpperCase()] = 0
            }
            crossDomainRegistrantCountries[req.whoisData.registrantCountry.toUpperCase()] += 1

            // Add to registrants
            if (!crossDomainRegistrants.hasOwnProperty(req.whoisData.registrantName.toUpperCase())) {
              crossDomainRegistrants[req.whoisData.registrantName.toUpperCase()] = 0
            }
            crossDomainRegistrants[req.whoisData.registrantName.toUpperCase()] += 1
          }

          // Add to protocols
          if (!protocols.hasOwnProperty(url.protocol)) {
            protocols[url.protocol] = 0
          }
          protocols[url.protocol] += 1
        } catch (error) {
          console.error(error)
          invalidURLs.push(req.url)
        }
      })
    }
  }, `HttpStatusCode=200 AND DependencyJson like "{%" AND DependencyJson NOT LIKE '%"totalSameOriginRequests":0,%'`)

  // Post process cumulative counts
  for (let key in cuResources) {
    cuResources[key].avgTotalCount = cuResources[key].avgTotalCount / successCount
    cuResources[key].avgSameOriginCount = cuResources[key].avgSameOriginCount / successCount
    cuResources[key].avgCrossOriginCount = cuResources[key].avgCrossOriginCount / successCount
  }

  // Take only Top 30 host names ordered by request count
  let hostnamesArr = Object.entries(hostnameCounts)
  hostnamesArr.sort((x, y) => y[1] - x[1])
  hostnamesArr = hostnamesArr.slice(0, 50)

  // Log results
  console.log(
    `failedAnalysisDomainCount: ${failedCount} \n`,
    `successAnalysisDomainCount: ${successCount} \n`,
    `invalidURLsCount: ${invalidURLs.length} \n`,

    `totalCrossDomainRequests: ${totalCrossDomainRequests} \n`,
    `totalSameDomainRequests: ${totalSameDomainRequests} \n`,

    `maxRequests: ${stat.getMax(totalRequestsPerDomain)} \n`,
    `minRequests: ${stat.getMin(totalRequestsPerDomain)} \n`,
    `avgRequests: ${stat.getAverage(totalRequestsPerDomain)} \n`,
    `medianRequests: ${stat.getMedian(totalRequestsPerDomain)} \n`,
    `standardDeviationRequests: ${stat.getStandardDeviation(totalRequestsPerDomain)} \n`,

    `maxSameOriginRequests: ${stat.getMax(sameOriginRequestsPerDomain)} \n`,
    `minSameOriginRequests: ${stat.getMin(sameOriginRequestsPerDomain)} \n`,
    `avgSameOriginRequests: ${stat.getAverage(sameOriginRequestsPerDomain)} \n`,
    `medianSameOriginRequests: ${stat.getMedian(sameOriginRequestsPerDomain)} \n`,
    `standardDeviationSameOriginRequests: ${stat.getStandardDeviation(sameOriginRequestsPerDomain)} \n`,

    `maxCrossOriginRequests: ${stat.getMax(crossOriginRequestsPerDomain)} \n`,
    `minCrossOriginRequests: ${stat.getMin(crossOriginRequestsPerDomain)} \n`,
    `avgCrossOriginRequests: ${stat.getAverage(crossOriginRequestsPerDomain)} \n`,
    `medianCrossOriginRequests: ${stat.getMedian(crossOriginRequestsPerDomain)} \n`,
    `standardDeviationCrossOriginRequests: ${stat.getStandardDeviation(crossOriginRequestsPerDomain)} \n`
  )

  console.log('cuResources: \n', cuResources)

  console.log('topHostnamesBasedOnRequestCounts: \n', hostnamesArr)

  console.log('totalRequestsPerResourceType: \n', totalRequestsPerResourceType)

  // console.log('crossDomainRegistrantCountries: \n', crossDomainRegistrantCountries)

  // console.log('crossDomainRegistrants: \n', crossDomainRegistrants)

  console.log('protocols: \n', protocols)

  // Shut it down.
  db.close()
}

exports.doPopularUrlsAnalysis = async (fileType = null) => {
  // Fire it up.
  await db.openOrCreate()

  let totalCount = 0
  let urlSet = new Set()
  let urlsObj = {}
  let urlsArr = []

  // Loop over all records and cumulate counts
  await db.forEachRecord(data => {
    totalCount += 1
    console.log(totalCount)

    let domainObj = JSON.parse(data.DependencyJson)

    for (let key in domainObj.resources) {
      for (let i = 0; i < domainObj.resources[key].requests.length; i++) {
        const req = domainObj.resources[key].requests[i]
        if (req.crossOrigin) {
          try {
            let url = new URL(req.url)
            url = url.origin + url.pathname

            if (fileType && !url.endsWith(`.${fileType}`)) {
              continue
            }

            if (urlSet.has(url)) {
              urlsObj[url] += 1
              console.log(`Already in Set: ${url}`)
            } else {
              urlSet.add(url)
              urlsObj[url] = 1
            }
          } catch (error) {
            console.error('Invalid url encountered')
          }
        }
      }
    }
  }, `HttpStatusCode=200 AND DependencyJson like "{%" AND DependencyJson NOT LIKE '%"totalSameOriginRequests":0,%'`)

  console.log(`urls in set: ${urlSet.size}`)
  console.log(`urls in obj: ${Object.keys(urlsObj).length}`)

  // Convert to array
  console.log('Converting obj to arr...')
  const keys = Object.keys(urlsObj)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    urlsArr.push({ url: key, count: urlsObj[key] })
    console.log(i)
  }

  // Sort the array and take 30 largest
  console.log('Sorting arr...')
  urlsArr.sort((x, y) => y.count - x.count)
  urlsArr = urlsArr.slice(0, 30)

  // Print results
  console.log(urlsArr)

  // Shut it down.
  db.close()
}

exports.findZeroSameOriginRequestsDomains = async () => {
  // Fire it up.
  await db.openOrCreate()

  // Loop over all records and cumulate counts
  let count = 0
  await db.forEachRecord(data => {
    count++
    console.log(data.Name)
  }, `HttpStatusCode=200 AND DependencyJson like "{%" AND DependencyJson NOT LIKE '%"totalSameOriginRequests":0,%'`)

  console.log('Count:', count)

  // Shut it down.
  db.close()
}

exports.doDomainConnectionAnalysis = async (keywordArr) => {
  // Fire it up.
  await db.openOrCreate()

  let totalCount = 0
  let foundCount = 0

  // Loop over all records and cumulate counts
  await db.forEachRecord(data => {
    totalCount += 1
    console.log(totalCount)

    let domainObj = JSON.parse(data.DependencyJson)

    // For each resource
    resourceLoop:
    for (let key in domainObj.resources) {
      // For each request
      requestLoop:
      for (let i = 0; i < domainObj.resources[key].requests.length; i++) {
        const req = domainObj.resources[key].requests[i]

        if (req.crossOrigin) {
          try {
            let url = new URL(req.url)
            // For each keyword
            keywordLoop:
            for (let x = 0; x < keywordArr.length; x++) {
              const keyword = keywordArr[x]
              if (url.origin.includes(keyword)) {
                foundCount += 1
                break resourceLoop
              }
            }
          } catch (error) {
            console.error('Invalid url encountered')
          }
        }
      }
    }
  }, `HttpStatusCode=200 AND DependencyJson like "{%" AND DependencyJson NOT LIKE '%"totalSameOriginRequests":0,%'`)

  // Print results
  console.log(`Total domain count is ${totalCount}`)
  console.log(`Keyword "${keywordArr.join(' or ')}" found in ${foundCount} domains`)

  // Shut it down.
  db.close()
}

exports.doURLConnectionAnalysis = async (keywordArr) => {
  // Fire it up.
  await db.openOrCreate()

  let totalCount = 0
  let foundCount = 0

  // Loop over all records and cumulate counts
  await db.forEachRecord(data => {
    totalCount += 1
    console.log(totalCount)

    let domainObj = JSON.parse(data.DependencyJson)

    // For each resource
    resourceLoop:
    for (let key in domainObj.resources) {
      // For each request
      requestLoop:
      for (let i = 0; i < domainObj.resources[key].requests.length; i++) {
        const req = domainObj.resources[key].requests[i]
        // For each keyword
        keywordLoop:
        for (let x = 0; x < keywordArr.length; x++) {
          const keyword = keywordArr[x]
          if (req.url.includes(keyword)) {
            foundCount += 1
            break resourceLoop
          }
        }
      }
    }
  }, `HttpStatusCode=200 AND DependencyJson like "{%" AND DependencyJson NOT LIKE '%"totalSameOriginRequests":0,%'`)

  // Print results
  console.log(`Total domain count is ${totalCount}`)
  console.log(`Keyword "${keywordArr.join(' or ')}" found in ${foundCount} domains`)

  // Shut it down.
  db.close()
}
