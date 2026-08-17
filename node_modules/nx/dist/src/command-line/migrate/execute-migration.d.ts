import { MigrationsJson } from '../../config/misc-interfaces';
import { FileChange } from '../../generators/tree';
import { ArrayPackageGroup, NxMigrationsConfiguration, PackageJson } from '../../utils/package-json';
interface PackageMigrationConfig extends NxMigrationsConfiguration {
    packageJson: PackageJson;
    packageGroup: ArrayPackageGroup;
}
export declare function readPackageMigrationConfig(packageName: string, dir: string): PackageMigrationConfig;
export declare function runInstall(nxWorkspaceRoot?: string, phase?: MigrationInstallPhase): Promise<void>;
export type MigrationInstallPhase = 'pre-migration' | 'post-migration';
export declare class NpmPeerDepsInstallError extends Error {
    constructor();
}
/**
 * Detects npm peer-dependency resolution failures. Keyed on the `ERESOLVE`
 * error code, which npm consistently emits for this class of failure across
 * v7+ (`npm ERR! code ERESOLVE` / `npm error code ERESOLVE`). Falls back to a
 * small set of stable phrases in case the code line is missing from the
 * captured output.
 */
export declare function isNpmPeerDepsError(stderr: string): boolean;
export declare function logNpmPeerDepsError(phase: MigrationInstallPhase): void;
export declare class ChangedDepInstaller {
    private readonly root;
    private readonly shouldSkipInstall;
    private initialDeps;
    private _skippedInstall;
    constructor(root: string, shouldSkipInstall?: boolean);
    get skippedInstall(): boolean;
    installDepsIfChanged(): Promise<void>;
}
export declare function runNxOrAngularMigration(root: string, migration: {
    package: string;
    name: string;
    description?: string;
    version: string;
}, isVerbose: boolean, captureGeneratorOutput?: boolean, resolvedCollection?: {
    collection: MigrationsJson;
    collectionPath: string;
}): Promise<{
    changes: FileChange[];
    nextSteps: string[];
    agentContext: string[];
    logs: string;
    madeChanges: boolean;
}>;
export declare function getStringifiedPackageJsonDeps(root: string): string;
export declare function runNxMigration(root: string, collectionPath: string, collection: MigrationsJson, name: string, migrationVersion: string | undefined, captureGeneratorOutput: boolean): Promise<{
    changes: FileChange[];
    nextSteps: string[];
    agentContext: string[];
    logs: string;
}>;
export declare function parseMigrationReturn(value: unknown): {
    nextSteps: string[];
    agentContext: string[];
};
export declare function filterStrings(value: unknown): string[];
export declare function readMigrationCollection(packageName: string, root: string): {
    collection: MigrationsJson;
    collectionPath: string;
};
export declare function getImplementationPath(collection: MigrationsJson, collectionPath: string, name: string, migrationVersion?: string): {
    path: string;
    fnSymbol: string;
};
export declare class MigrationImplementationMissingError extends Error {
    constructor(baseMessage: string, collectionPath: string, migrationVersion: string | undefined);
}
export declare function isAngularMigration(collection: MigrationsJson, name: string): import("../../config/misc-interfaces").MigrationsJsonEntry;
export declare const getNgCompatLayer: () => Promise<typeof import("../../adapter/ngcli-adapter")>;
export {};
