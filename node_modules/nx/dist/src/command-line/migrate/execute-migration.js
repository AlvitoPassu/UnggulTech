"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNgCompatLayer = exports.MigrationImplementationMissingError = exports.ChangedDepInstaller = exports.NpmPeerDepsInstallError = void 0;
exports.readPackageMigrationConfig = readPackageMigrationConfig;
exports.runInstall = runInstall;
exports.isNpmPeerDepsError = isNpmPeerDepsError;
exports.logNpmPeerDepsError = logNpmPeerDepsError;
exports.runNxOrAngularMigration = runNxOrAngularMigration;
exports.getStringifiedPackageJsonDeps = getStringifiedPackageJsonDeps;
exports.runNxMigration = runNxMigration;
exports.parseMigrationReturn = parseMigrationReturn;
exports.filterStrings = filterStrings;
exports.readMigrationCollection = readMigrationCollection;
exports.getImplementationPath = getImplementationPath;
exports.isAngularMigration = isAngularMigration;
const tslib_1 = require("tslib");
const pc = tslib_1.__importStar(require("picocolors"));
const child_process_1 = require("child_process");
const path_1 = require("path");
const semver_1 = require("semver");
const handle_import_1 = require("../../utils/handle-import");
const tree_1 = require("../../generators/tree");
const fileutils_1 = require("../../utils/fileutils");
const logger_1 = require("../../utils/logger");
const package_json_1 = require("../../utils/package-json");
const package_manager_1 = require("../../utils/package-manager");
const output_1 = require("../../utils/output");
const fs_1 = require("fs");
const installation_directory_1 = require("../../utils/installation-directory");
const project_graph_1 = require("../../project-graph/project-graph");
const version_utils_1 = require("./version-utils");
function readPackageMigrationConfig(packageName, dir) {
    const { path: packageJsonPath, packageJson: json } = (0, package_json_1.readModulePackageJson)(packageName, (0, installation_directory_1.getNxRequirePaths)(dir));
    const config = (0, package_json_1.readNxMigrateConfig)(json);
    if (!config) {
        return { packageJson: json, migrations: null, packageGroup: [] };
    }
    try {
        const migrationFile = require.resolve(config.migrations, {
            paths: [(0, path_1.dirname)(packageJsonPath)],
        });
        return {
            packageJson: json,
            migrations: migrationFile,
            packageGroup: config.packageGroup,
            supportsOptionalMigrations: config.supportsOptionalMigrations,
        };
    }
    catch {
        return {
            packageJson: json,
            migrations: null,
            packageGroup: config.packageGroup,
            supportsOptionalMigrations: config.supportsOptionalMigrations,
        };
    }
}
function runInstall(nxWorkspaceRoot, phase = 'pre-migration') {
    const cwd = nxWorkspaceRoot ?? process.cwd();
    const packageManager = (0, package_manager_1.detectPackageManager)(cwd);
    const pmCommands = (0, package_manager_1.getPackageManagerCommand)(packageManager, cwd);
    const installCommand = `${pmCommands.install} ${pmCommands.ignoreScriptsFlag ?? ''}`;
    output_1.output.log({
        title: `Running '${installCommand}' to make sure necessary packages are installed`,
    });
    return new Promise((resolve, reject) => {
        // For npm, pipe stderr so we can detect peer dependency errors while still
        // mirroring it live to the user's terminal. Other package managers inherit
        // stderr directly since we don't need to inspect their output.
        const shouldCaptureStderr = packageManager === 'npm';
        const child = (0, child_process_1.spawn)(installCommand, {
            shell: true,
            stdio: ['inherit', 'inherit', shouldCaptureStderr ? 'pipe' : 'inherit'],
            windowsHide: true,
            cwd,
        });
        const stderrChunks = [];
        child.stderr?.on('data', (chunk) => {
            process.stderr.write(chunk);
            stderrChunks.push(chunk);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            if (shouldCaptureStderr) {
                const stderr = Buffer.concat(stderrChunks).toString().trim();
                if (isNpmPeerDepsError(stderr)) {
                    // Log the remediation guidance here so every caller of `runInstall`
                    // (CLI migrate, `nx repair`, single-migration runner, etc.) surfaces
                    // it consistently. Top-level callers catch `NpmPeerDepsInstallError`
                    // and return a non-zero exit code without re-logging.
                    logNpmPeerDepsError(phase);
                    reject(new NpmPeerDepsInstallError());
                    return;
                }
            }
            reject(new Error(`Command failed: ${installCommand}`));
        });
    });
}
class NpmPeerDepsInstallError extends Error {
    constructor() {
        super('npm install failed due to peer dependency conflicts.');
        this.name = 'NpmPeerDepsInstallError';
    }
}
exports.NpmPeerDepsInstallError = NpmPeerDepsInstallError;
/**
 * Detects npm peer-dependency resolution failures. Keyed on the `ERESOLVE`
 * error code, which npm consistently emits for this class of failure across
 * v7+ (`npm ERR! code ERESOLVE` / `npm error code ERESOLVE`). Falls back to a
 * small set of stable phrases in case the code line is missing from the
 * captured output.
 */
function isNpmPeerDepsError(stderr) {
    if (/\bERESOLVE\b/.test(stderr)) {
        return true;
    }
    const lowerStderr = stderr.toLowerCase();
    return (lowerStderr.includes('unable to resolve dependency tree') ||
        lowerStderr.includes('could not resolve dependency') ||
        lowerStderr.includes('conflicting peer dependency'));
}
function logNpmPeerDepsError(phase) {
    const peerDepsResolutionSteps = [
        'Recommended approaches (in order of preference):',
        '',
        '1. Use "overrides" in package.json to force compatible versions across the dependency tree.',
        '   See https://docs.npmjs.com/cli/configuring-npm/package-json#overrides',
        '2. Persist legacy peer deps resolution in the project ".npmrc":',
        '   npm config set legacy-peer-deps=true --location=project',
        '   (bypasses peer dependency resolution; use with caution)',
        '3. As a last resort, force the installation by running "npm install --force".',
        '   (does not persist and may produce broken installs)',
    ];
    const manualInstallHint = [
        'If you installed the dependencies manually, pass "--skip-install" to avoid re-installing them:',
        '   nx migrate --run-migrations --skip-install',
    ];
    if (phase === 'pre-migration') {
        output_1.output.error({
            title: 'You need to resolve the peer dependency conflicts before the migration can continue',
            bodyLines: [
                ...peerDepsResolutionSteps,
                '',
                'Once the conflicts are resolved, re-run the migrations:',
                '   nx migrate --run-migrations',
                '',
                ...manualInstallHint,
            ],
        });
    }
    else {
        output_1.output.error({
            title: 'Some migrations have been applied, but installing the updated dependencies failed',
            bodyLines: [
                ...peerDepsResolutionSteps,
                '',
                'Once the conflicts are resolved, run "npm install" to install the updated dependencies.',
                'If the migration was interrupted before completing, re-run the remaining migrations:',
                '   nx migrate --run-migrations',
                '',
                ...manualInstallHint,
            ],
        });
    }
}
class ChangedDepInstaller {
    constructor(root, shouldSkipInstall = false) {
        this.root = root;
        this.shouldSkipInstall = shouldSkipInstall;
        this._skippedInstall = false;
        this.initialDeps = getStringifiedPackageJsonDeps(root);
    }
    get skippedInstall() {
        return this._skippedInstall;
    }
    async installDepsIfChanged() {
        const currentDeps = getStringifiedPackageJsonDeps(this.root);
        if (this.initialDeps !== currentDeps) {
            if (this.shouldSkipInstall) {
                this._skippedInstall = true;
            }
            else {
                await runInstall(this.root, 'post-migration');
            }
        }
        this.initialDeps = currentDeps;
    }
}
exports.ChangedDepInstaller = ChangedDepInstaller;
async function runNxOrAngularMigration(root, migration, isVerbose, captureGeneratorOutput = false, resolvedCollection) {
    const { collection, collectionPath } = resolvedCollection ?? readMigrationCollection(migration.package, root);
    let changes = [];
    let nextSteps = [];
    let agentContext = [];
    let logs = '';
    // Angular's `ngResult.changes` is synthesized from the schematic's
    // DryRunEvent stream so Nx and Angular paths can share commit/validation
    // gating via `changes.length > 0`.
    let madeChanges = false;
    logger_1.logger.info(pc.dim('→ Running generator…'));
    if (!isAngularMigration(collection, migration.name)) {
        ({ nextSteps, changes, agentContext, logs } = await runNxMigration(root, collectionPath, collection, migration.name, migration.version, captureGeneratorOutput));
        madeChanges = changes.length > 0;
        logger_1.logger.info(`Ran ${migration.name} from ${migration.package}`);
        if (migration.description) {
            logger_1.logger.info(`  ${migration.description}`);
        }
        logger_1.logger.info('');
        if (!madeChanges) {
            logger_1.logger.info(`No changes were made\n`);
            return { changes, nextSteps, agentContext, logs, madeChanges };
        }
        logger_1.logger.info('Changes:');
        (0, tree_1.printChanges)(changes, '  ');
        logger_1.logger.info('');
    }
    else {
        const ngCliAdapter = await (0, exports.getNgCompatLayer)();
        const migrationProjectGraph = await (0, project_graph_1.createProjectGraphAsync)();
        const ngResult = await ngCliAdapter.runMigration(root, migration.package, migration.name, (0, project_graph_1.readProjectsConfigurationFromProjectGraph)(migrationProjectGraph).projects, isVerbose, migrationProjectGraph);
        changes = ngResult.changes;
        madeChanges = ngResult.madeChanges;
        logs = ngResult.loggingQueue.join('\n');
        logger_1.logger.info(`Ran ${migration.name} from ${migration.package}`);
        if (migration.description) {
            logger_1.logger.info(`  ${migration.description}`);
        }
        logger_1.logger.info('');
        if (!madeChanges) {
            logger_1.logger.info(`No changes were made\n`);
            return { changes, nextSteps, agentContext, logs, madeChanges };
        }
        logger_1.logger.info('Changes:');
        ngResult.loggingQueue.forEach((log) => logger_1.logger.info('  ' + log));
        logger_1.logger.info('');
    }
    return { changes, nextSteps, agentContext, logs, madeChanges };
}
function getStringifiedPackageJsonDeps(root) {
    try {
        const { dependencies, devDependencies } = (0, fileutils_1.readJsonFile)((0, path_1.join)(root, 'package.json'));
        return JSON.stringify([dependencies, devDependencies]);
    }
    catch {
        // We don't really care if the .nx/installation property changes,
        // whenever nxw is invoked it will handle the dep updates.
        return '';
    }
}
async function runNxMigration(root, collectionPath, collection, name, migrationVersion, captureGeneratorOutput) {
    const { path: implPath, fnSymbol } = getImplementationPath(collection, collectionPath, name, migrationVersion);
    const fn = require(implPath)[fnSymbol];
    const host = new tree_1.FsTree(root, process.env.NX_VERBOSE_LOGGING === 'true', `migration ${collection.name}:${name}`);
    let result;
    let logs = '';
    if (captureGeneratorOutput) {
        const { withGeneratorOutputCapture } = require('./agentic/capture-generator-output');
        ({ result, logs } = await withGeneratorOutputCapture(() => fn(host, {})));
    }
    else {
        result = await fn(host, {});
    }
    const { nextSteps, agentContext } = parseMigrationReturn(result);
    host.lock();
    const changes = host.listChanges();
    (0, tree_1.flushChanges)(root, changes);
    return { changes, nextSteps, agentContext, logs };
}
function parseMigrationReturn(value) {
    if (Array.isArray(value)) {
        return { nextSteps: filterStrings(value), agentContext: [] };
    }
    if (value && typeof value === 'object') {
        const obj = value;
        return {
            nextSteps: filterStrings(obj.nextSteps),
            agentContext: filterStrings(obj.agentContext),
        };
    }
    // Catches `void`, mistakenly-returned generator callbacks, malformed values.
    return { nextSteps: [], agentContext: [] };
}
// Bucket-level tolerance: a single non-string entry shouldn't discard the
// whole `nextSteps` / `agentContext` array. Migration authors occasionally
// push `null` / `undefined` / a number into the array; we drop the bad entries
// and keep the rest so end-of-run guidance isn't silently lost.
function filterStrings(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((v) => typeof v === 'string');
}
function readMigrationCollection(packageName, root) {
    const collectionPath = readPackageMigrationConfig(packageName, root).migrations;
    const collection = (0, fileutils_1.readJsonFile)(collectionPath);
    collection.name ??= packageName;
    return {
        collection,
        collectionPath,
    };
}
function getImplementationPath(collection, collectionPath, name, migrationVersion) {
    const g = collection.generators?.[name] || collection.schematics?.[name];
    if (!g) {
        throw new MigrationImplementationMissingError(`Unable to determine implementation path for "${collectionPath}:${name}"`, collectionPath, migrationVersion);
    }
    const implRelativePathAndMaybeSymbol = g.implementation || g.factory;
    const [implRelativePath, fnSymbol = 'default'] = implRelativePathAndMaybeSymbol.split('#');
    let implPath;
    try {
        implPath = require.resolve(implRelativePath, {
            paths: [(0, path_1.dirname)(collectionPath)],
        });
    }
    catch (e) {
        try {
            // workaround for a bug in node 12
            implPath = require.resolve(`${(0, path_1.dirname)(collectionPath)}/${implRelativePath}`);
        }
        catch {
            throw new MigrationImplementationMissingError(`Could not resolve implementation for migration "${name}" from "${collectionPath}"`, collectionPath, migrationVersion ?? g.version);
        }
    }
    return { path: implPath, fnSymbol };
}
class MigrationImplementationMissingError extends Error {
    constructor(baseMessage, collectionPath, migrationVersion) {
        super(buildMigrationMissingMessage(baseMessage, collectionPath, migrationVersion));
        this.name = 'MigrationImplementationMissingError';
    }
}
exports.MigrationImplementationMissingError = MigrationImplementationMissingError;
function buildMigrationMissingMessage(baseMessage, collectionPath, migrationVersion) {
    if (!migrationVersion) {
        return baseMessage;
    }
    try {
        const packageJsonPath = (0, path_1.join)((0, path_1.dirname)(collectionPath), 'package.json');
        if (!(0, fs_1.existsSync)(packageJsonPath)) {
            return baseMessage;
        }
        const packageJson = (0, fileutils_1.readJsonFile)(packageJsonPath);
        const installedVersion = packageJson.version;
        if (installedVersion &&
            (0, semver_1.lt)((0, version_utils_1.normalizeVersion)(installedVersion), (0, version_utils_1.normalizeVersion)(migrationVersion))) {
            const packageManager = (0, package_manager_1.detectPackageManager)();
            const pmc = (0, package_manager_1.getPackageManagerCommand)(packageManager);
            const overrideFieldName = getOverrideFieldName(packageManager);
            return (`${baseMessage}\n\n` +
                `The installed version of "${packageJson.name}" is ${installedVersion}, ` +
                `but this migration requires version ${migrationVersion}. ` +
                `This likely means the package version is being held back by an ${overrideFieldName} ` +
                `in your package.json. ` +
                `Remove the ${overrideFieldName} and run "${pmc.install}" to install the correct version.`);
        }
    }
    catch {
        // Fall through to return the base message if we can't read package info
    }
    return baseMessage;
}
function getOverrideFieldName(packageManager) {
    switch (packageManager) {
        case 'pnpm':
            return '"pnpm.overrides"';
        case 'yarn':
            return '"resolutions"';
        case 'npm':
        case 'bun':
            return '"overrides"';
    }
}
function isAngularMigration(collection, name) {
    return !collection.generators?.[name] && collection.schematics?.[name];
}
exports.getNgCompatLayer = (() => {
    let _ngCliAdapter;
    return async function getNgCompatLayer() {
        if (!_ngCliAdapter) {
            _ngCliAdapter = await (0, handle_import_1.handleImport)('../../adapter/ngcli-adapter.js', __dirname);
            require('../../adapter/compat');
        }
        return _ngCliAdapter;
    };
})();
