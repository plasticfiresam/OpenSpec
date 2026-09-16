/**
 * The relationship-data gather shared by doctor and context (4.1): one
 * registry snapshot, the health-mode reference index, and the root
 * inspection. Doctor layers its health-only inputs (store facts,
 * wrong-turn detection) on top.
 */
import * as path from 'node:path';

import { readRegistrySnapshot, type RegistrySnapshot } from '../core/store/registry.js';
import {
  readProjectConfigResult,
  resolveConfigFilePath,
  warnUnreadableProjectConfig,
  type ProjectConfig,
  type ProjectConfigRead,
} from '../core/project-config.js';
import { assembleReferenceIndex, type ReferenceIndexEntry } from '../core/references.js';
import { inspectOpenSpecRoot, type OpenSpecRootInspection } from '../core/openspec-root.js';
import type { ResolvedOpenSpecRoot } from '../core/root-selection.js';

export interface RelationshipData {
  registrySnapshot: RegistrySnapshot;
  projectConfig: ProjectConfig | null;
  /** The same read with its refusal reason, for surfaces that report it. */
  projectConfigRead: ProjectConfigRead;
  storeConfigPath: string;
  referenceEntries: ReferenceIndexEntry[];
  rootInspection: OpenSpecRootInspection;
}

export async function gatherRelationshipData(
  root: ResolvedOpenSpecRoot
): Promise<RelationshipData> {
  const registrySnapshot = await readRegistrySnapshot();

  // One read serves both consumers. The warning is re-emitted here because
  // this gather replaced a readProjectConfig call: doctor turns the reason
  // into a reported problem, and `context` must not get quieter than it was.
  const projectConfigRead = readProjectConfigResult(root.path);
  warnUnreadableProjectConfig(projectConfigRead);
  const projectConfig = projectConfigRead.config;
  const storeConfigPath =
    resolveConfigFilePath(root.path) ?? path.join(root.path, 'openspec', 'config.yaml');

  const referenceEntries = await assembleReferenceIndex({
    references: projectConfig?.references ?? [],
    resolvedRoot: root,
    includeSpecs: false,
    registryEntries: registrySnapshot.entries,
  });

  const rootInspection = await inspectOpenSpecRoot(root.path);

  return {
    registrySnapshot,
    projectConfig,
    projectConfigRead,
    storeConfigPath,
    referenceEntries,
    rootInspection,
  };
}
