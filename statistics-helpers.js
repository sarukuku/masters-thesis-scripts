exports.getMedian = args => {
  if (!args.length) { return 0 }
  const numbers = args.slice(0).sort((a, b) => b - a)
  const middle = Math.floor(numbers.length / 2)
  const isEven = numbers.length % 2 === 0
  return isEven ? (numbers[middle] + numbers[middle - 1]) / 2 : numbers[middle]
}

exports.getStandardDeviation = values => {
  const avg = exports.getAverage(values)

  const squareDiffs = values.map(value => {
    const diff = value - avg
    const sqrDiff = diff * diff
    return sqrDiff
  })

  const avgSquareDiff = exports.getAverage(squareDiffs)

  const stdDev = Math.sqrt(avgSquareDiff)
  return stdDev
}

exports.getAverage = data => {
  let sum = data.reduce((sum, value) => {
    return sum + value
  }, 0)

  const avg = sum / data.length
  return avg
}

exports.getMax = data => {
  if (!data.length) { return -1 }
  const ordered = data.slice(0).sort((a, b) => b - a)
  return ordered[0]
}

exports.getMin = data => {
  if (!data.length) { return -1 }
  const ordered = data.slice(0).sort((a, b) => b - a)
  return ordered[ordered.length - 1]
}
