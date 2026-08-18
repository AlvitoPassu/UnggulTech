"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.throwForUnsupportedVersion = throwForUnsupportedVersion;
exports.assertSupportedPackageVersion = assertSupportedPackageVersion;
exports.assertSupportedInstalledPackageVersion = assertSupportedInstalledPackageVersion;
const semver_1 = require("semver");
const installed_version_1 = require("./installed-version");
const package_json_1 = require("./package-json");
/**
 * Throws a standardized error when a package is installed at a version below
 * a plugin's supported floor.
 *
 * Use this at every site where a plugin determines the installed version of
 * a supported package is below its declared floor, so the message is
 * consistent across plugins.
 *
 * @param packageName Name of the package (e.g. `@angular/core`).
 * @param installedVersion Version detected in the workspace (e.g. `18.2.0`).
 * @param floor Lowest version the plugin supports (e.g. `19.0.0`).
 */
function throwForUnsupportedVersion(packageName, installedVersion, floor) {
    throw new Error(`Unsupported version of \`${packageName}\` detected.\n\n` +
        `  Installed: ${installedVersion}\n` +
        `  Supported: >= ${floor}\n\n` +
        `Update \`${packageName}\` to ${floor} or higher.`);
}
/**
 * Asserts that a package detected in the workspace is at or above the
 * plugin's supported floor. No-op when the package is not detected
 * (fresh-install path) or when declared as `latest`/`next`. Throws via
 * `throwForUnsupportedVersion` (with the original declared range for
 * clarity) when below floor.
 *
 * Use from generator entry points to fail fast on unsupported workspaces
 * before writing any incompatible config.
 */
function assertSupportedPackageVersion(tree, packageName, minSupportedVersion) {
    const declared = (0, package_json_1.getDependencyVersionFromPackageJson)(tree, packageName);
    if (!declared || (0, installed_version_1.isNonSemverDistTag)(declared)) {
        return;
    }
    const cleaned = (0, installed_version_1.normalizeSemver)(declared);
    if (cleaned && (0, semver_1.lt)(cleaned, minSupportedVersion)) {
        throwForUnsupportedVersion(packageName, declared, minSupportedVersion);
    }
}
/**
 * Asserts that a package installed in the workspace is at or above the
 * plugin's supported floor. No-op when the package is not resolvable from
 * `node_modules` (peer not yet satisfied, fresh-install path). Throws via
 * `throwForUnsupportedVersion` when below floor.
 *
 * Use from executor / runtime / preset / library entry points where
 * node_modules is present and no `Tree` is available. Generator code should
 * use `assertSupportedPackageVersion` instead, which reads the declared
 * range from a tree.
 */
function assertSupportedInstalledPackageVersion(packageName, minSupportedVersion) {
    const installed = (0, installed_version_1.getInstalledPackageVersion)(packageName);
    if (!installed) {
        return;
    }
    // Coerce strips any prerelease tag (e.g. `19.0.0-rc.1` → `19.0.0`) so a
    // prerelease of the supported major isn't wrongly flagged as below floor
    // by semver's spec-mandated `lt(prerelease, release) === true` ordering.
    const normalized = (0, semver_1.coerce)(installed)?.version;
    if (!normalized || !(0, semver_1.lt)(normalized, minSupportedVersion)) {
        return;
    }
    throwForUnsupportedVersion(packageName, installed, minSupportedVersion);
}
