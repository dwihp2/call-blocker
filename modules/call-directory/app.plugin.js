// @ts-check
// Expo resolves a config plugin by requiring `app.plugin.js` from the package
// root; the plugin itself lives in `plugin/` with the rest of the code.
module.exports = require('./plugin/withCallDirectory');
