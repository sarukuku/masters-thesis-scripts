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
      await utils.countUniqueKeysAnalysis('HttpStatusCode')
      break
    case 'association-type-analysis':
      await utils.countUniqueKeysAnalysis('AssociationType')
      break
    case 'country-analysis':
      await utils.countUniqueKeysAnalysis('Country')
      break
    case 'registrar-analysis':
      await utils.countUniqueKeysAnalysis('Registrar')
      break
    case 'dep-origin-analysis':
      await utils.doDependencyOriginAnalysis()
      break
    case 'popular-urls-analysis':
      await utils.doPopularUrlsAnalysis()
      break
    case 'popular-js-urls-analysis':
      await utils.doPopularUrlsAnalysis('js')
      break
    case 'popular-css-urls-analysis':
      await utils.doPopularUrlsAnalysis('css')
      break
    case 'popular-gif-urls-analysis':
      await utils.doPopularUrlsAnalysis('gif')
      break
    case 'popular-jpg-urls-analysis':
      await utils.doPopularUrlsAnalysis('jpg')
      break
    case 'popular-png-urls-analysis':
      await utils.doPopularUrlsAnalysis('png')
      break
    case 'zero-same-origin-requests':
      await utils.findZeroSameOriginRequestsDomains()
      break
    case 'facebook-popularity-analysis':
      await utils.doDomainConnectionAnalysis(['facebook', 'fbcdn', 'fbsbx', 'instagram'])
      break
    case 'google-popularity-analysis':
      await utils.doDomainConnectionAnalysis(['google', 'youtube', 'adsense', 'adwords'])
      break
    case 'wp-popularity-analysis':
      await utils.doURLConnectionAnalysis(['/wp-content/'])
      break
    case 'drupal-popularity-analysis':
      await utils.doURLConnectionAnalysis(['/sites/all/themes/', '/sites/all/', '/sites/default/files/', '/sites/default/', '/sites/'])
      break
    case 'joomla-popularity-analysis':
      await utils.doURLConnectionAnalysis(['/media/system/', '/templates/'])
      break
    default:
      console.warn('You didn\'t select a know task to run. I\'ll quit.')
      return
  }

  // We're done.
  console.log('All done!')

  // Output the exection time.
  console.timeEnd('Task duration')
})()
