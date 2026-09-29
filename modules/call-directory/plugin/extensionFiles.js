// @ts-check
const fs = require('fs');
const path = require('path');

/** The module's own Swift sources, copied into the generated project. */
const PACKAGE_ROOT = path.join(__dirname, '..');
const EXTENSION_SOURCE = path.join(PACKAGE_ROOT, 'extension', 'CallDirectoryExtension.swift');
const ENGINE_SOURCE = path.join(PACKAGE_ROOT, 'ios', 'RuleEngine.swift');

/** The Swift files the extension target compiles, and the engine the app target compiles as well. */
const EXTENSION_SOURCES = ['CallDirectoryExtension.swift', 'RuleEngine.swift'];
const ENGINE_SOURCE_NAME = 'RuleEngine.swift';

/**
 * @typedef {import('./withCallDirectory').CallDirectoryOptions} CallDirectoryOptions
 */

/**
 * The extension's Info.plist: it registers the Call Directory point and the
 * principal class, and carries the App Group the plugin resolved.
 *
 * @param {CallDirectoryOptions} options
 * @returns {string} an XML plist
 */
function extensionInfoPlist(options) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>${escapeXml(options.displayName)}</string>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>$(PRODUCT_NAME)</string>
	<key>CFBundlePackageType</key>
	<string>XPC!</string>
	<key>CFBundleShortVersionString</key>
	<string>${escapeXml(options.version)}</string>
	<key>CFBundleVersion</key>
	<string>${escapeXml(options.buildNumber)}</string>
	<key>CallDirectoryAppGroup</key>
	<string>${escapeXml(options.appGroup)}</string>
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.callkit.call-directory</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).CallDirectoryExtension</string>
	</dict>
</dict>
</plist>
`;
}

/**
 * The extension's entitlements: the same App Group as the app, so the store the
 * app writes is the store the extension reads.
 *
 * @param {CallDirectoryOptions} options
 * @returns {string} an XML plist
 */
function extensionEntitlements(options) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>${escapeXml(options.appGroup)}</string>
	</array>
</dict>
</plist>
`;
}

/**
 * Writes everything the extension target compiles and configures into the
 * generated `ios/` directory. Contents are overwritten, so a prebuild run always
 * leaves the same files behind.
 *
 * @param {{ platformProjectRoot: string, options: CallDirectoryOptions }} props
 * @returns {string} the extension's directory in the generated project
 */
function writeExtensionFiles({ platformProjectRoot, options }) {
  const directory = path.join(platformProjectRoot, options.extensionName);
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(EXTENSION_SOURCE, path.join(directory, 'CallDirectoryExtension.swift'));
  fs.copyFileSync(ENGINE_SOURCE, path.join(directory, ENGINE_SOURCE_NAME));
  fs.writeFileSync(path.join(directory, `${options.extensionName}-Info.plist`), extensionInfoPlist(options));
  fs.writeFileSync(path.join(directory, `${options.extensionName}.entitlements`), extensionEntitlements(options));
  return directory;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  EXTENSION_SOURCES,
  ENGINE_SOURCE_NAME,
  writeExtensionFiles,
};
