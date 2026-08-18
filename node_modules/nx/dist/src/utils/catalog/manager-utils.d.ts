import type { Tree } from '../../generators/tree';
import type { CatalogDefinitions } from './types';
export declare function readCatalogDefinitions(filename: string, treeOrRoot: Tree | string, cache: Map<string, CatalogDefinitions | null>): CatalogDefinitions | null;
export declare function updateCatalogVersionsInFile(filename: string, treeOrRoot: Tree | string, updates: Array<{
    packageName: string;
    version: string;
    catalogName?: string;
}>): void;
