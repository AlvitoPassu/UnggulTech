"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NON_SEMVER_DIST_TAGS = void 0;
exports.getInstalledPackageVersion = getInstalledPackageVersion;
exports.getDeclaredPackageVersion = getDeclaredPackageVersion;
exports.isNonSemverDistTag = isNonSemverDistTag;
exports.normalizeSemver = normalizeSemver;
const devkit_internals_1 = require("nx/src/devkit-internals");
const semver_1 = require("semver");
const package_json_1 = require("./package-json");
/**
 * Returns the concrete version of a package as resolved by Node module
 * resolution from the workspace. Reads the installed package's own
 * `package.json` — not the workspace's declared range.
 *
 * Use this from executor / runtime contexts where node_modules is present.
 * Generator-time code should use `getDeclaredPackageVersion` instead.
 *
 * Returns `null` when the package is not resolvable.
 */
function getInstalledPackageVersion(packageName) {
    try {
        const { packageJson } = (0, devkit_internals_1.readModulePackageJson)(packageName);
        return packageJson.version ?? null;
    }
    catch {
        return null;
    }
}
/**
 * Returns the declared version of a package as read from the workspace's
 * `package.json`, normalized to a plain semver string (range markers
 * stripped) suitable for arithmetic comparisons (e.g. `lt(v, '1.37.0')`).
 *
 * When the package is missing or declared as `latest`/`next`, falls back to
 * the cleaned `latestKnownVersion` if provided; otherwise returns `null`.
 *
 * Use this from generator-time contexts where node_modules is not assumed
 * to be present. Executor / runtime code should use
 * `getInstalledPackageVersion` instead.
 */
function getDeclaredPackageVersion(tree, packageName, latestKnownVersion) {
    const declared = (0, package_json_1.getDependencyVersionFromPackageJson)(tree, packageName);
    if (declared && !isNonSemverDistTag(declared)) {
        const normalized = normalizeSemver(declared);
        if (normalized)
            return normalized;
    }
    return latestKnownVersion ? normalizeSemver(latestKnownVersion) : null;
}
exports.NON_SEMVER_DIST_TAGS = ['latest', 'next'];
function isNonSemverDistTag(version) {
    return exports.NON_SEMVER_DIST_TAGS.includes(version);
}
function normalizeSemver(version) {
    return (0, semver_1.clean)(version) ?? (0, semver_1.coerce)(version)?.version ?? null;
}
