// @ts-check
const { withDangerousMod, withEntitlementsPlist, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');

const { addCallDirectoryExtension } = require('./xcodeExtension');
const { writeExtensionFiles } = require('./extensionFiles');

const DEFAULT_APP_GROUP = 'group.com.callblocker.app';
const DEFAULT_EXTENSION_NAME = 'CallDirectoryExtension';
/** The module, and so the extension, needs iOS 16.4. */
const DEPLOYMENT_TARGET = '16.4';

/**
 * @typedef {object} CallDirectoryPluginProps
 * @property {string} [appGroup] App Group shared by the app and the extension.
 * @property {string} [extensionName] Name of the extension target.
 * @property {string} [extensionBundleId] Bundle identifier of the extension.
 */

/**
 * Everything resolved once, so no two mods can disagree about the names.
 *
 * @typedef {object} CallDirectoryOptions
 * @property {string} appGroup
 * @property {string} extensionName
 * @property {string} extensionBundleId
 * @property {string} deploymentTarget
 * @property {string} displayName
 * @property {string} version
 * @property {string} buildNumber
 */

/**
 * @param {import('@expo/config-types').ExpoConfig} config
 * @param {CallDirectoryPluginProps | undefined} props
 * @returns {CallDirectoryOptions}
 */
function resolveOptions(config, props) {
  const appGroup = props?.appGroup ?? DEFAULT_APP_GROUP;
  if (!appGroup.startsWith('group.')) {
    throw new Error(`call-directory: appGroup must be a group identifier starting with "group.", got "${appGroup}".`);
  }

  const extensionName = props?.extensionName ?? DEFAULT_EXTENSION_NAME;
  const bundleIdentifier = config.ios?.bundleIdentifier;
  const extensionBundleId = props?.extensionBundleId ?? (bundleIdentifier ? `${bundleIdentifier}.${extensionName}` : undefined);
  if (!extensionBundleId) {
    throw new Error('call-directory: set ios.bundleIdentifier in the app config, or pass extensionBundleId to the plugin.');
  }

  return {
    appGroup,
    extensionName,
    extensionBundleId,
    deploymentTarget: DEPLOYMENT_TARGET,
    displayName: config.name ?? extensionName,
    version: config.version ?? '1.0.0',
    buildNumber: config.ios?.buildNumber ?? '1',
  };
}

/**
 * Adds the Call Directory extension target the app blocks calls with.
 *
 * The app and the extension share one App Group: the app writes the Effective
 * block list there, the extension hands it to CallKit.
 *
 * @type {import('@expo/config-plugins').ConfigPlugin<CallDirectoryPluginProps>}
 */
const withCallDirectory = (config, props) => {
  const options = resolveOptions(config, props);

  // The native side reads these back at runtime, so the option never has to be
  // repeated in Swift.
  config = withInfoPlist(config, (config) => {
    config.modResults.CallDirectoryAppGroup = options.appGroup;
    config.modResults.CallDirectoryExtensionName = options.extensionName;
    config.modResults.CallDirectoryExtensionBundleId = options.extensionBundleId;
    return config;
  });

  // The App Group capability on the app target.
  config = withEntitlementsPlist(config, (config) => {
    const entitlements = config.modResults;
    const existing = entitlements['com.apple.security.application-groups'];
    const groups = (Array.isArray(existing) ? existing : []).filter((value) => typeof value === 'string');
    if (!groups.includes(options.appGroup)) {
      groups.push(options.appGroup);
    }
    entitlements['com.apple.security.application-groups'] = groups;
    return config;
  });

  // The extension's own sources, Info.plist and entitlements.
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      writeExtensionFiles({ platformProjectRoot: config.modRequest.platformProjectRoot, options });
      return config;
    },
  ]);

  // The extension target itself, its sources, its settings and its embedding.
  config = withXcodeProject(config, (config) => {
    addCallDirectoryExtension(config.modResults, options);
    return config;
  });

  return config;
};

module.exports = withCallDirectory;
