// @ts-check
const path = require('path');
const { IOSConfig } = require('@expo/config-plugins');

const { Target, XcodeUtils } = IOSConfig;
const { EXTENSION_SOURCES, ENGINE_SOURCE_NAME } = require('./extensionFiles');

/** Xcode's own name for the phase that copies an app extension into the app. */
const EMBED_PHASE_NAME = 'Embed App Extensions';
/** What the `xcode` package names the phase it creates for an app extension. */
const GENERATED_PHASE_NAME = 'Copy Files';
/** 13 is the PlugIns subfolder, where a `.appex` has to land. */
const PLUGINS_SUBFOLDER_SPEC = 13;

const APPLICATION_PRODUCT_TYPE = 'com.apple.product-type.application';

/**
 * @typedef {import('./withCallDirectory').CallDirectoryOptions} CallDirectoryOptions
 * @typedef {any} XcodeProject the `xcode` package's parsed project
 * @typedef {[string, any]} NativeTargetEntry
 */

/**
 * Creates and wires up the Call Directory extension target, or brings an
 * existing one back to the same shape when the project was not regenerated.
 * Running it twice adds nothing twice.
 *
 * @param {XcodeProject} project
 * @param {CallDirectoryOptions} options
 * @returns {XcodeProject}
 */
function addCallDirectoryExtension(project, options) {
  const extensionName = options.extensionName;
  const [applicationUuid] = findApplicationTarget(project);

  XcodeUtils.ensureGroupRecursively(project, extensionName);

  let extensionTarget = findNativeTarget(project, extensionName);
  if (!extensionTarget) {
    const created = project.addTarget(extensionName, 'app_extension', extensionName, options.extensionBundleId);
    extensionTarget = [created.uuid, created.pbxNativeTarget];
  }
  const extensionUuid = extensionTarget[0];

  // The Sources phase has to exist before the `xcode` package looks one up by
  // name: its lookup falls back to another target's phase when the target has
  // none of its own.
  ensureSourcesPhase(project, extensionUuid);
  for (const file of EXTENSION_SOURCES) {
    linkSourceFile(project, {
      filepath: path.posix.join(extensionName, file),
      groupName: extensionName,
      targetUuid: extensionUuid,
    });
  }
  // The app target compiles the engine too. The module's Swift and the
  // extension's must agree on what a Rule covers, and one file cannot drift
  // from itself.
  linkSourceFile(project, {
    filepath: path.posix.join(extensionName, ENGINE_SOURCE_NAME),
    groupName: extensionName,
    targetUuid: applicationUuid,
  });

  applyExtensionBuildSettings(project, extensionUuid, options);
  linkExtensionDependency(project, applicationUuid, extensionUuid);
  embedExtension(project, applicationUuid, extensionUuid);
  return project;
}

/**
 * Makes the app build the extension first, so the embedded `.appex` is always
 * the one this run produced.
 *
 * The `xcode` package writes that dependency only when the project already has
 * the two sections it needs, and a project with a single target has neither.
 *
 * @param {XcodeProject} project
 * @param {string} applicationUuid
 * @param {string} extensionUuid
 * @returns {void}
 */
function linkExtensionDependency(project, applicationUuid, extensionUuid) {
  const sections = project.hash.project.objects;
  if (!sections.PBXTargetDependency) {
    sections.PBXTargetDependency = {};
  }
  if (!sections.PBXContainerItemProxy) {
    sections.PBXContainerItemProxy = {};
  }

  const dependencies = sections.PBXTargetDependency;
  const applicationTarget = project.pbxNativeTargetSection()[applicationUuid];
  const linked = /** @type {any[]} */ (applicationTarget.dependencies ?? []).some(
    (entry) => XcodeUtils.unquote(String(dependencies[entry.value]?.target ?? '')) === extensionUuid
  );
  if (!linked) {
    project.addTargetDependency(applicationUuid, [extensionUuid]);
  }
}

/**
 * @param {XcodeProject} project
 * @returns {NativeTargetEntry}
 */
function findApplicationTarget(project) {
  const found = Target.getNativeTargets(project).find(
    ([, nativeTarget]) => XcodeUtils.unquote(nativeTarget.productType) === APPLICATION_PRODUCT_TYPE
  );
  if (!found) {
    throw new Error('call-directory could not find the app target in the Xcode project.');
  }
  return found;
}

/**
 * @param {XcodeProject} project
 * @param {string} extensionName
 * @returns {NativeTargetEntry | null}
 */
function findNativeTarget(project, extensionName) {
  return (
    Target.getNativeTargets(project).find(([, nativeTarget]) => XcodeUtils.unquote(nativeTarget.name) === extensionName) ?? null
  );
}

/**
 * A target's own phase of the given kind, found through the target so that a
 * phase belonging to another target can never be mistaken for it.
 *
 * @param {XcodeProject} project
 * @param {string} targetUuid
 * @param {string} isa
 * @returns {{ uuid: string, phase: any } | null}
 */
function findPhase(project, targetUuid, isa) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  for (const entry of target.buildPhases ?? []) {
    const phase = project.hash.project.objects[isa]?.[entry.value];
    if (phase) {
      return { uuid: entry.value, phase };
    }
  }
  return null;
}

/**
 * Gives the extension target a Sources phase, which `addTarget` does not create.
 *
 * @param {XcodeProject} project
 * @param {string} targetUuid
 * @returns {{ uuid: string, phase: any }}
 */
function ensureSourcesPhase(project, targetUuid) {
  const existing = findPhase(project, targetUuid, 'PBXSourcesBuildPhase');
  if (existing) {
    return existing;
  }
  const created = project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetUuid);
  return { uuid: created.uuid, phase: created.buildPhase };
}

/**
 * Lists a source file in a target's Sources phase.
 *
 * The first target creates the file reference — Expo's helper decides how a
 * `.swift` file reference looks, and a second one has no reason to differ.
 * Later targets reuse that reference and get their own build file, which is how
 * Xcode records one file belonging to two targets.
 *
 * @param {XcodeProject} project
 * @param {{ filepath: string, groupName: string, targetUuid: string }} props
 * @returns {void}
 */
function linkSourceFile(project, { filepath, groupName, targetUuid }) {
  const fileName = path.posix.basename(filepath);
  const group = project.pbxGroupByName(groupName);
  const reference = /** @type {any[]} */ (group?.children ?? []).find((child) => child.comment === fileName);

  // Expo's helper looks the phase up by name, so it has to exist first.
  const sources = ensureSourcesPhase(project, targetUuid);
  if (!reference) {
    XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName, project, targetUuid });
    return;
  }

  const buildFiles = project.pbxBuildFileSection();
  const alreadyListed = /** @type {any[]} */ (sources.phase.files ?? []).some(
    (entry) => buildFiles[entry.value]?.fileRef === reference.value
  );
  if (alreadyListed) {
    return;
  }

  const comment = `${fileName} in Sources`;
  const buildFileUuid = project.generateUuid();
  buildFiles[buildFileUuid] = { isa: 'PBXBuildFile', fileRef: reference.value, fileRef_comment: fileName };
  buildFiles[`${buildFileUuid}_comment`] = comment;
  sources.phase.files = [...(sources.phase.files ?? []), { value: buildFileUuid, comment }];
}

/**
 * The settings an app extension target needs: its own bundle, built for iPhone,
 * with the same App Group entitlement as the app.
 *
 * @param {XcodeProject} project
 * @param {string} targetUuid
 * @param {CallDirectoryOptions} options
 * @returns {void}
 */
function applyExtensionBuildSettings(project, targetUuid, options) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  const configurations = XcodeUtils.getBuildConfigurationsForListId(project, target.buildConfigurationList);
  for (const [, configuration] of configurations) {
    const settings = configuration.buildSettings ?? (configuration.buildSettings = {});
    settings.PRODUCT_BUNDLE_IDENTIFIER = `"${options.extensionBundleId}"`;
    settings.INFOPLIST_FILE = `"${options.extensionName}/${options.extensionName}-Info.plist"`;
    settings.CODE_SIGN_ENTITLEMENTS = `"${options.extensionName}/${options.extensionName}.entitlements"`;
    settings.SWIFT_VERSION = '5.0';
    settings.TARGETED_DEVICE_FAMILY = '1';
    settings.IPHONEOS_DEPLOYMENT_TARGET = options.deploymentTarget;
  }
}

/**
 * Embeds the extension in the app and signs it on copy: without both, the app
 * would ship without a Call Directory the system can run.
 *
 * @param {XcodeProject} project
 * @param {string} applicationUuid
 * @param {string} extensionUuid
 * @returns {void}
 */
function embedExtension(project, applicationUuid, extensionUuid) {
  const target = project.pbxNativeTargetSection()[extensionUuid];
  const productName = `${XcodeUtils.unquote(target.productName)}.appex`;
  const reference = target.productReference;
  const { phase } = ensureEmbedPhase(project, applicationUuid);
  const buildFiles = project.pbxBuildFileSection();

  /** @type {string | undefined} */
  const existingBuildFile = Object.keys(buildFiles).find((key) => !isComment(key) && buildFiles[key].fileRef === reference);
  const buildFileUuid = existingBuildFile ?? /** @type {string} */ (project.generateUuid());
  if (!existingBuildFile) {
    buildFiles[buildFileUuid] = { isa: 'PBXBuildFile', fileRef: reference, fileRef_comment: productName };
  }
  buildFiles[buildFileUuid].settings = { ATTRIBUTES: ['CodeSignOnCopy'] };
  buildFiles[`${buildFileUuid}_comment`] = `${productName} in ${EMBED_PHASE_NAME}`;

  const kept = /** @type {any[]} */ (phase.files ?? []).filter((entry) => buildFiles[entry.value]?.fileRef !== reference);
  phase.files = [...kept, { value: buildFileUuid, comment: `${productName} in ${EMBED_PHASE_NAME}` }];
}

/**
 * The app target's copy-files phase that carries the extension — named by
 * Xcode, or still named by the `xcode` package from the run that created it —
 * created if the target has none.
 *
 * @param {XcodeProject} project
 * @param {string} applicationUuid
 * @returns {{ uuid: string, phase: any }}
 */
function ensureEmbedPhase(project, applicationUuid) {
  const phases = project.hash.project.objects.PBXCopyFilesBuildPhase ?? (project.hash.project.objects.PBXCopyFilesBuildPhase = {});
  const applicationTarget = project.pbxNativeTargetSection()[applicationUuid];
  const owned = /** @type {any[]} */ (applicationTarget.buildPhases ?? [])
    .map((entry) => entry.value)
    .filter((value) => phases[value]);
  /** @type {string | undefined} */
  const existing = owned.find((value) => {
    const name = XcodeUtils.unquote(phases[value].name);
    return name === EMBED_PHASE_NAME || name === GENERATED_PHASE_NAME;
  });

  const phaseUuid =
    existing ?? project.addBuildPhase([], 'PBXCopyFilesBuildPhase', EMBED_PHASE_NAME, applicationUuid, 'app_extension').uuid;
  phases[phaseUuid].name = `"${EMBED_PHASE_NAME}"`;
  phases[phaseUuid].dstSubfolderSpec = PLUGINS_SUBFOLDER_SPEC;
  phases[`${phaseUuid}_comment`] = EMBED_PHASE_NAME;
  for (const entry of applicationTarget.buildPhases ?? []) {
    if (entry.value === phaseUuid) {
      entry.comment = EMBED_PHASE_NAME;
    }
  }
  return { uuid: phaseUuid, phase: phases[phaseUuid] };
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isComment(key) {
  return key.endsWith('_comment');
}

module.exports = { addCallDirectoryExtension };
