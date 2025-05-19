const jsResolver = (path, options) => {
  const jsExtRegex = /\.js$/i
  const resolver = options.defaultResolver
  if (jsExtRegex.test(path) && !options.basedir.includes('node_modules') && !path.includes('node_modules')) {
    const newPath = path.replace(jsExtRegex, '.ts');
    try {
      return resolver(newPath, options)
    } catch {
      // use default resolver
    }
  }

  return resolver(path, options)
}

module.exports = jsResolver
