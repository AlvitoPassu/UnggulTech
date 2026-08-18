"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamicImport = void 0;
exports.loadConfigFile = loadConfigFile;
exports.getRootTsConfigPath = getRootTsConfigPath;
exports.getRootTsConfigFileName = getRootTsConfigFileName;
exports.clearRequireCache = clearRequireCache;
const fs_1 = require("fs");
const node_url_1 = require("node:url");
const devkit_exports_1 = require("nx/src/devkit-exports");
const devkit_internals_1 = require("nx/src/devkit-internals");
const path_1 = require("path");
exports.dynamicImport = new Function('modulePath', 'return import(modulePath);');
async function loadConfigFile(configFilePath, tsconfigFileNames) {
    const extension = (0, path_1.extname)(configFilePath);
    const module = await loadModule(configFilePath, extension, tsconfigFileNames);
    return module.default ?? module;
}
async function loadModule(path, extension, tsconfigFileNames) {
    if (isTypeScriptFile(extension)) {
        return await loadTypeScriptModule(path, extension, tsconfigFileNames);
    }
    return await loadJavaScriptModule(path, extension);
}
function isTypeScriptFile(extension) {
    return extension.endsWith('ts');
}
async function loadTypeScriptModule(path, extension, tsconfigFileNames) {
    const tsConfigPath = getTypeScriptConfigPath(path, tsconfigFileNames);
    if (!tsConfigPath) {
        return await loadModuleByExtension(path, extension);
    }
    // loadTsFile was added in nx@23. @nx/devkit's peer range supports older
    // nx majors, so fall back to the legacy registerTsProject + require path
    // when loadTsFile isn't available on the host nx.
    if (typeof devkit_internals_1.loadTsFile !== 'function') {
        const cleanup = (0, devkit_internals_1.registerTsProject)(tsConfigPath);
        try {
            return await loadModuleByExtension(path, extension);
        }
        finally {
            cleanup();
        }
    }
    // Both .ts and .mts go through loadTsFile first. Node 22.12+ supports
    // require() of synchronous ESM by default, and loadTsFile's lazy fallback
    // covers swc/ts-node + tsconfig-paths registration when needed (swc-node
    // hooks .cts/.mts/.ts via Module._extensions). Async-only ESM modules
    // (top-level await) throw ERR_REQUIRE_ASYNC_MODULE and fall through to
    // dynamic import(). ERR_REQUIRE_ESM is the legacy code for the same case
    // - kept for older Node lines.
    try {
        return (0, devkit_internals_1.loadTsFile)(path, tsConfigPath);
    }
    catch (e) {
        if (e?.code !== 'ERR_REQUIRE_ESM' &&
            e?.code !== 'ERR_REQUIRE_ASYNC_MODULE') {
            throw e;
        }
        // The module must be loaded via dynamic import(). Register
        // tsconfig-paths first so workspace alias imports resolve, then try a
        // native dynamic import. Node 22.18+ LTS strips TS types on the ESM
        // path natively, so pure-ESM TLA configs load without any swc/ts-node
        // ESM loader. Only escalate to forceRegisterEsmLoader (which throws
        // when neither @swc-node/register nor ts-node is installed) if the
        // native attempt hits unsupported TS syntax.
        const cleanup = (0, devkit_internals_1.registerTsProject)(tsConfigPath);
        try {
            return await loadESM(path);
        }
        catch (esmErr) {
            if (esmErr?.code !== 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' ||
                typeof devkit_internals_1.forceRegisterEsmLoader !== 'function') {
                throw esmErr;
            }
            // Module.register is global and one-shot per process. After this
            // runs, every subsequent ESM import in the process is routed
            // through the registered loader, forfeiting Node's native TS
            // stripping for the dynamic-import path. If neither swc-node nor
            // ts-node is installed, forceRegisterEsmLoader throws - surface the
            // original ESM error in that case so the user sees the real
            // problem, not a misleading "loader missing" message.
            try {
                (0, devkit_internals_1.forceRegisterEsmLoader)();
            }
            catch {
                throw esmErr;
            }
            return await loadESM(path);
        }
        finally {
            cleanup();
        }
    }
}
function getTypeScriptConfigPath(path, tsconfigFileNames) {
    const siblingFiles = (0, fs_1.readdirSync)((0, path_1.dirname)(path));
    const tsConfigFileName = (tsconfigFileNames ?? ['tsconfig.json']).find((name) => siblingFiles.includes(name));
    return tsConfigFileName
        ? (0, path_1.join)((0, path_1.dirname)(path), tsConfigFileName)
        : getRootTsConfigPath();
}
async function loadJavaScriptModule(path, extension) {
    return await loadModuleByExtension(path, extension);
}
async function loadModuleByExtension(path, extension) {
    switch (extension) {
        case '.cts':
        case '.cjs':
            return await loadCommonJS(path);
        case '.mjs':
            return await loadESM(path);
        default:
            // For both .ts and .mts files, try to load them as CommonJS first, then try ESM.
            // It's possible that the file is written like ESM (e.g. using `import`) but uses CJS features like `__dirname` or `__filename`.
            return await load(path);
    }
}
function getRootTsConfigPath() {
    const tsConfigFileName = getRootTsConfigFileName();
    return tsConfigFileName ? (0, path_1.join)(devkit_exports_1.workspaceRoot, tsConfigFileName) : null;
}
function getRootTsConfigFileName() {
    for (const tsConfigName of ['tsconfig.base.json', 'tsconfig.json']) {
        const pathExists = (0, fs_1.existsSync)((0, path_1.join)(devkit_exports_1.workspaceRoot, tsConfigName));
        if (pathExists) {
            return tsConfigName;
        }
    }
    return null;
}
const packageInstallationDirectories = [
    `${path_1.sep}node_modules${path_1.sep}`,
    `${path_1.sep}.yarn${path_1.sep}`,
];
function clearRequireCache() {
    for (const k of Object.keys(require.cache)) {
        if (!packageInstallationDirectories.some((dir) => k.includes(dir))) {
            delete require.cache[k];
        }
    }
}
async function load(path) {
    try {
        // Try using `require` first, which works for CJS modules.
        // Modules are CJS unless it is named `.mjs` or `package.json` sets type to "module".
        return await loadCommonJS(path);
    }
    catch (e) {
        if (e.code === 'ERR_REQUIRE_ESM') {
            // If `require` fails to load ESM, try dynamic `import()`. ESM requires file url protocol for handling absolute paths.
            return loadESM(path);
        }
        // Re-throw all other errors
        throw e;
    }
}
/**
 * Load the module after ensuring that the require cache is cleared.
 */
async function loadCommonJS(path) {
    // Clear cache if the path is in the cache
    if (require.cache[path]) {
        clearRequireCache();
    }
    return require(path);
}
async function loadESM(path) {
    const pathAsFileUrl = (0, node_url_1.pathToFileURL)(path).pathname;
    return await (0, exports.dynamicImport)(`${pathAsFileUrl}?t=${Date.now()}`);
}
