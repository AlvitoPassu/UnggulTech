import type { Tree } from 'nx/src/devkit-exports';
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
export declare function throwForUnsupportedVersion(packageName: string, installedVersion: string, floor: string): never;
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
export declare function assertSupportedPackageVersion(tree: Tree, packageName: string, minSupportedVersion: string): void;
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
export declare function assertSupportedInstalledPackageVersion(packageName: string, minSupportedVersion: string): void;
