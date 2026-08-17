import type { Tree } from 'nx/src/devkit-exports';
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
export declare function getInstalledPackageVersion(packageName: string): string | null;
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
export declare function getDeclaredPackageVersion(tree: Tree, packageName: string, latestKnownVersion?: string): string | null;
export declare const NON_SEMVER_DIST_TAGS: readonly ['latest', 'next'];
export type NonSemverDistTag = (typeof NON_SEMVER_DIST_TAGS)[number];
export declare function isNonSemverDistTag(version: string): version is NonSemverDistTag;
export declare function normalizeSemver(version: string): string | null;
