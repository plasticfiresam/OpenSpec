import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { makeStoreDiagnostic, type StoreDiagnostic } from './store/errors.js';

export const OPERATION_IDS = ['apply', 'archive'] as const;
export type OperationId = (typeof OPERATION_IDS)[number];

export interface OperationConfig {
  guidance?: string[];
}

export type OperationsConfig = Partial<Record<OperationId, OperationConfig>>;

const OperationConfigSchema = z.object({
  guidance: z.array(z.string()).optional(),
});

/**
 * Zod schema for project configuration.
 *
 * Purpose:
 * 1. Documentation - clearly defines the config file structure
 * 2. Type safety - TypeScript infers ProjectConfig type from schema
 * 3. Runtime validation - uses safeParse() for resilient field-by-field validation
 *
 * Why Zod over manual validation:
 * - Helps understand OpenSpec's data interfaces at a glance
 * - Single source of truth for type and validation
 * - Consistent with other OpenSpec schemas
 */
export const ProjectConfigSchema = z.object({
  // Required: which schema to use (e.g., "spec-driven", or project-local schema name)
  schema: z
    .string()
    .min(1)
    .describe('The workflow schema to use (e.g., "spec-driven")'),

  // Optional: project context (injected into all artifact instructions)
  // Max size: 50KB (enforced during parsing)
  context: z
    .string()
    .optional()
    .describe('Project context injected into all artifact instructions'),

  // Optional: per-artifact rules (additive to schema's built-in guidance)
  rules: z
    .record(
      z.string(), // artifact ID
      z.array(z.string()) // list of rules
    )
    .optional()
    .describe('Per-artifact rules, keyed by artifact ID'),

  // Optional: per-operation advisory guidance, kept separate from artifact rules.
  operations: z
    .object({
      apply: OperationConfigSchema.optional(),
      archive: OperationConfigSchema.optional(),
    })
    .optional()
    .describe('Per-operation advisory guidance'),

  // Note: the `references` field (id strings or {id, remote} maps) is
  // deliberately absent here — readProjectConfig parses and normalizes
  // it by hand (see DeclarationEntry below); a schema entry nothing
  // parses would only drift from the real behavior.

  // Optional: the declared default store. Only consulted by root
  // resolution when this openspec/ directory is config-only (no specs/
  // or changes/); a fallback, never an override.
  store: z
    .string()
    .optional()
    .describe('Store id used as the OpenSpec root when no local planning shape exists'),

  // Optional: GitHub Copilot integration preferences. `cloudAgent` is the
  // opt-in for generating the Copilot cloud coding-agent files (a GitHub
  // Actions workflow + agent file); absent means "not yet decided".
  githubCopilot: z
    .object({
      cloudAgent: z.boolean().optional(),
    })
    .optional()
    .describe('GitHub Copilot integration preferences'),
});

/** Normalized in-memory shape of a referenced store declaration. */
export interface DeclarationEntry {
  id: string;
  /** Clone source rendered into onboarding fixes. */
  remote?: string;
}

export type ProjectConfig = z.infer<typeof ProjectConfigSchema> & {
  references?: DeclarationEntry[];
};

export interface OperationInputs {
  context?: string;
  operationGuidance?: string[];
}

export function loadOperationInputs(
  projectConfig: ProjectConfig | null,
  operationId: OperationId
): OperationInputs {
  const context =
    projectConfig?.context !== undefined && projectConfig.context.trim().length > 0
      ? projectConfig.context
      : undefined;
  const guidance = projectConfig?.operations?.[operationId]?.guidance;
  const operationGuidance = guidance && guidance.length > 0 ? guidance : undefined;

  return {
    ...(context !== undefined ? { context } : {}),
    ...(operationGuidance !== undefined ? { operationGuidance } : {}),
  };
}

function parseOperations(raw: unknown): OperationsConfig | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn(`Invalid 'operations' field in config (must be object)`);
    return undefined;
  }

  const supported = new Set<string>(OPERATION_IDS);
  const operations: OperationsConfig = {};

  for (const [operationId, value] of Object.entries(raw)) {
    if (!supported.has(operationId)) {
      console.warn(
        `Unknown operation ID '${operationId}' in config. Supported operation IDs: ${OPERATION_IDS.join(', ')}`
      );
      continue;
    }

    const typedOperationId = operationId as OperationId;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      console.warn(
        `Invalid 'operations.${operationId}' field in config (must be object), ignoring this operation`
      );
      continue;
    }

    const operation = value as Record<string, unknown>;
    const unknownFields = Object.keys(operation).filter((field) => field !== 'guidance');
    if (unknownFields.length > 0) {
      console.warn(
        `Unknown field(s) in 'operations.${operationId}': ${unknownFields.join(', ')}. Supported fields: guidance`
      );
    }

    if (operation.guidance === undefined) {
      continue;
    }

    const guidanceResult = z.array(z.string()).safeParse(operation.guidance);
    if (!guidanceResult.success) {
      console.warn(
        `Guidance for operation '${operationId}' must be an array of strings, ignoring this operation's guidance`
      );
      continue;
    }

    const guidance = guidanceResult.data.filter((entry) => entry.length > 0);
    if (guidance.length < guidanceResult.data.length) {
      console.warn(
        `Some guidance for operation '${operationId}' are empty strings, ignoring them`
      );
    }
    if (guidance.length > 0) {
      operations[typedOperationId] = { guidance };
    }
  }

  return Object.keys(operations).length > 0 ? operations : undefined;
}

/**
 * Parser for `references:` declarations: string entries or
 * {id, remote} maps, normalized to DeclarationEntry[]. Dedup keys on
 * id and keeps the first position; the first entry carrying a remote
 * supplies it (a later duplicate fills a missing remote, never
 * overrides). Invalid entries drop with a warning like other resilient
 * fields; returns undefined when the field is absent or normalizes to
 * empty.
 */
function parseDeclarationList(raw: unknown): DeclarationEntry[] | undefined {
  const fieldName = 'references';
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    console.warn(`Invalid '${fieldName}' field in config (must be an array of store ids)`);
    return undefined;
  }

  const byId = new Map<string, DeclarationEntry>();
  let droppedEntries = false;
  let droppedRemotes = false;

  for (const entry of raw) {
    let declaration: DeclarationEntry | null = null;
    if (typeof entry === 'string') {
      declaration = { id: entry };
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.id === 'string') {
        declaration = { id: candidate.id };
        if (typeof candidate.remote === 'string' && candidate.remote.length > 0) {
          declaration.remote = candidate.remote;
        } else if (candidate.remote !== undefined) {
          droppedRemotes = true; // remote dropped, id kept
        }
      }
    }

    if (!declaration) {
      droppedEntries = true;
      continue;
    }

    const existing = byId.get(declaration.id);
    if (!existing) {
      byId.set(declaration.id, declaration);
    } else if (existing.remote === undefined && declaration.remote !== undefined) {
      existing.remote = declaration.remote;
    }
  }

  if (droppedEntries) {
    console.warn(`Some '${fieldName}' entries are invalid, ignoring them`);
  }
  if (droppedRemotes) {
    console.warn(
      `Some '${fieldName}' remotes are not non-empty strings; the ids are kept without a clone source`
    );
  }
  return byId.size > 0 ? [...byId.values()] : undefined;
}

export const MAX_CONTEXT_SIZE = 50 * 1024; // 50KB hard limit, shared with the references index

/**
 * Why a config file that EXISTS could not be read as project facts.
 *
 * `unparseable` is a YAML syntax error; `not_mapping` is a file that parses
 * into a scalar instead of a mapping. An absent file is not a reason, and
 * neither is an empty or comments-only one: nothing was written there, so
 * nothing was lost.
 */
export interface ProjectConfigUnreadable {
  kind: 'unparseable' | 'not_mapping';
  /** First line of the parser's own reason; never a stack trace. */
  detail: string;
}

/** A config read that carries the refusal reason next to the config. */
export interface ProjectConfigRead {
  /** Parsed config, or null when there is none to use. */
  config: ProjectConfig | null;
  /** Absolute path of the config file actually read, or null when none exists. */
  filePath: string | null;
  /** Set only when the file exists and could not be read as project facts. */
  unreadable?: ProjectConfigUnreadable;
}

/**
 * Read openspec/config.yaml together with the reason it was refused.
 *
 * `readProjectConfig` drops that reason on the floor, which is right for the
 * fourteen callers that can work without a config and wrong for the three that
 * speak for the project: an instruction generated without `context` and `rules`
 * looks exactly like one where the project had nothing to say. Parsing lives
 * here, so both forms read the same file the same way and cannot drift.
 *
 * Silent by design - it reports the unusable file through the return value.
 * Field-level warnings (a dropped rule, an oversized context) still go to
 * stderr from here, because the fields around them ARE loaded and every caller
 * wants to know what was skipped.
 *
 * Performance note (Jan 2025):
 * Benchmarks showed direct file reads are fast enough without caching:
 * - Typical config (1KB): ~0.5ms per read
 * - Large config (50KB): ~1.6ms per read
 * - Missing config: ~0.01ms per read
 * Config is read 1-2 times per command (schema resolution + instruction loading),
 * adding ~1-3ms total overhead. Caching would add complexity (mtime checks,
 * invalidation logic) for negligible benefit. Direct reads also ensure config
 * changes are reflected immediately without stale cache issues.
 *
 * @param projectRoot - The root directory of the project (where `openspec/` lives)
 * @returns The config, the file it came from, and the refusal reason if any
 */
export function readProjectConfigResult(projectRoot: string): ProjectConfigRead {
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    return { config: null, filePath: null }; // No config is OK
  }

  let raw: any;
  try {
    raw = parseYaml(readFileSync(configPath, 'utf-8'));
  } catch (error) {
    return {
      config: null,
      filePath: configPath,
      unreadable: {
        kind: 'unparseable',
        detail: error instanceof Error ? error.message.split('\n')[0] : String(error),
      },
    };
  }

  try {
    if (raw === null || raw === undefined) {
      // Empty or comments-only: imperfect, not unusable. Warned about as
      // before and read as "no config", so a project that has not filled it
      // in yet keeps working.
      console.warn(`openspec/config.yaml is not a valid YAML object`);
      return { config: null, filePath: configPath };
    }

    if (typeof raw !== 'object') {
      return {
        config: null,
        filePath: configPath,
        unreadable: { kind: 'not_mapping', detail: `config is a ${typeof raw}, not a YAML mapping` },
      };
    }

    const config: Partial<ProjectConfig> = {};

    // Parse schema field using Zod
    const schemaField = z.string().min(1);
    const schemaResult = schemaField.safeParse(raw.schema);
    if (schemaResult.success) {
      config.schema = schemaResult.data;
    } else if (raw.schema !== undefined) {
      console.warn(`Invalid 'schema' field in config (must be non-empty string)`);
    }

    // Parse context field with size limit
    if (raw.context !== undefined) {
      const contextField = z.string();
      const contextResult = contextField.safeParse(raw.context);

      if (contextResult.success) {
        const contextSize = Buffer.byteLength(contextResult.data, 'utf-8');
        if (contextSize > MAX_CONTEXT_SIZE) {
          console.warn(
            `Context too large (${(contextSize / 1024).toFixed(1)}KB, limit: ${MAX_CONTEXT_SIZE / 1024}KB)`
          );
          console.warn(`Ignoring context field`);
        } else {
          config.context = contextResult.data;
        }
      } else {
        console.warn(`Invalid 'context' field in config (must be string)`);
      }
    }

    // Parse rules field using Zod
    if (raw.rules !== undefined) {
      const rulesField = z.record(z.string(), z.array(z.string()));

      // First check if it's an object structure (guard against null since typeof null === 'object')
      if (typeof raw.rules === 'object' && raw.rules !== null && !Array.isArray(raw.rules)) {
        // Artifact ids are intentionally not restricted to the built-in naming
        // convention, so keys such as "constructor" remain valid for custom
        // schemas. A null-prototype map preserves those keys as data without
        // letting "__proto__" mutate the lookup object's prototype.
        const parsedRules: Record<string, string[]> = Object.create(null);
        let hasValidRules = false;

        for (const [artifactId, rules] of Object.entries(raw.rules)) {
          const rulesArrayResult = z.array(z.string()).safeParse(rules);

          if (rulesArrayResult.success) {
            // Filter out empty strings
            const validRules = rulesArrayResult.data.filter((r) => r.length > 0);
            if (validRules.length > 0) {
              parsedRules[artifactId] = validRules;
              hasValidRules = true;
            }
            if (validRules.length < rulesArrayResult.data.length) {
              console.warn(
                `Some rules for '${artifactId}' are empty strings, ignoring them`
              );
            }
          } else {
            console.warn(
              `Rules for '${artifactId}' must be an array of strings, ignoring this artifact's rules`
            );
          }
        }

        if (hasValidRules) {
          config.rules = parsedRules;
        }
      } else {
        console.warn(`Invalid 'rules' field in config (must be object)`);
      }
    }

    const operations = parseOperations(raw.operations);
    if (operations) {
      config.operations = operations;
    }

    const references = parseDeclarationList(raw.references);
    if (references) {
      config.references = references;
    }

    // Parse store pointer field: a string, or dropped with a warning.
    // (Root resolution does NOT use this parse — it uses readStorePointer
    // below, which errors on malformed pointers instead of dropping.)
    if (raw.store !== undefined) {
      if (typeof raw.store === 'string') {
        config.store = raw.store;
      } else {
        console.warn(
          `Warning: ignoring invalid store: field in ${configPathForWarnings(projectRoot)} (must be a single store id string).`
        );
      }
    }

    // Parse githubCopilot preferences (only cloudAgent is recognized today).
    if (raw.githubCopilot !== undefined) {
      if (
        typeof raw.githubCopilot === 'object' &&
        raw.githubCopilot !== null &&
        !Array.isArray(raw.githubCopilot)
      ) {
        const cloudAgent = (raw.githubCopilot as Record<string, unknown>).cloudAgent;
        if (typeof cloudAgent === 'boolean') {
          config.githubCopilot = { cloudAgent };
        } else if (cloudAgent !== undefined) {
          console.warn(`Invalid 'githubCopilot.cloudAgent' field in config (must be a boolean)`);
        }
      } else {
        console.warn(`Invalid 'githubCopilot' field in config (must be an object)`);
      }
    }

    // Return partial config even if some fields failed
    return {
      config: Object.keys(config).length > 0 ? (config as ProjectConfig) : null,
      filePath: configPath,
    };
  } catch (error) {
    // Field parsing throwing is not a syntax error in the file, but it leaves
    // the same hole - no facts - so it is reported the same way.
    return {
      config: null,
      filePath: configPath,
      unreadable: {
        kind: 'unparseable',
        detail: error instanceof Error ? error.message.split('\n')[0] : String(error),
      },
    };
  }
}

/**
 * Read and parse openspec/config.yaml from project root.
 * Uses resilient parsing - validates each field independently using Zod safeParse.
 * Returns null if the file doesn't exist, and null (with a warning) if it exists
 * but cannot be read.
 * Returns partial config if some fields are invalid (with warnings).
 *
 * Kept warning-and-null because fourteen call sites work fine without a config;
 * the surfaces that speak FOR the project read
 * {@link readProjectConfigResult} instead and refuse out loud.
 *
 * @param projectRoot - The root directory of the project (where `openspec/` lives)
 * @returns Parsed config, or null if the file doesn't exist or is unusable
 */
export function readProjectConfig(projectRoot: string): ProjectConfig | null {
  const read = readProjectConfigResult(projectRoot);
  if (read.unreadable) {
    console.warn(projectConfigWarning(read));
  }
  return read.config;
}

/**
 * The stderr warning `readProjectConfig` has always printed for a config file
 * it could not use. Kept verbatim (including the "ignoring it" ending, which
 * describes exactly what this form does) so the callers that tolerate a missing
 * config keep reading the same line.
 */
function projectConfigWarning(read: ProjectConfigRead): string {
  const filePath = read.filePath ?? 'openspec/config.yaml';
  return read.unreadable?.kind === 'not_mapping'
    ? `openspec/config.yaml is not a valid YAML object`
    : `Warning: could not parse ${filePath} (${read.unreadable?.detail}); ignoring it.`;
}

/**
 * The same warning, for callers that read through
 * {@link readProjectConfigResult} but must not go quieter than
 * `readProjectConfig` was.
 */
export function warnUnreadableProjectConfig(read: ProjectConfigRead): void {
  if (!read.unreadable) return;
  console.warn(projectConfigWarning(read));
}

/**
 * What to tell a person about a config file that exists and cannot be used,
 * and what to do about it. One wording for every surface that refuses on it,
 * so `instructions`, `validate` and `doctor` cannot describe the same file
 * three different ways.
 */
export function projectConfigProblem(read: ProjectConfigRead): { message: string; fix: string } {
  const filePath = read.filePath ?? 'openspec/config.yaml';
  const reason =
    read.unreadable?.kind === 'not_mapping'
      ? 'it is not a YAML mapping'
      : `it could not be parsed (${read.unreadable?.detail})`;
  return {
    message:
      `${filePath} could not be read as project configuration: ${reason}. ` +
      'The project context and rules it declares reach nothing until it parses.',
    fix: `Fix the YAML in ${filePath} (or remove the file if the project declares no configuration).`,
  };
}

/** The diagnostic code every surface reports an unusable config under. */
export const PROJECT_CONFIG_UNREADABLE_CODE = 'project_config_unreadable';

/**
 * Thrown by the surfaces that must not continue without the project's facts.
 * Carries the CLI's diagnostic envelope, so `--json` callers get the reason in
 * the response and human callers get the `Fix:` line.
 */
export class ProjectConfigUnreadableError extends Error {
  readonly diagnostic: StoreDiagnostic;

  constructor(read: ProjectConfigRead) {
    const problem = projectConfigProblem(read);
    super(problem.message);
    this.name = 'ProjectConfigUnreadableError';
    this.diagnostic = makeStoreDiagnostic('error', PROJECT_CONFIG_UNREADABLE_CODE, problem.message, {
      target: read.filePath ?? 'openspec/config.yaml',
      fix: problem.fix,
    });
  }
}

function configPathForWarnings(projectRoot: string): string {
  return resolveConfigFilePath(projectRoot) ?? path.join(projectRoot, 'openspec', 'config.yaml');
}

/**
 * Validate artifact IDs in rules against the artifacts of every available
 * schema. The `rules:` map is global, but each change can use a different
 * schema, so a key is only unknown when it matches no artifact in ANY schema.
 * Returns warnings for keys that are unknown everywhere.
 *
 * @param rules - The rules object from config
 * @param validArtifactIds - Set of valid artifact IDs across all schemas
 * @returns Array of warning messages for unknown artifact IDs
 */
export function validateConfigRules(
  rules: Record<string, string[]>,
  validArtifactIds: Set<string>
): string[] {
  const warnings: string[] = [];

  for (const artifactId of Object.keys(rules)) {
    if (!validArtifactIds.has(artifactId)) {
      const validIds = Array.from(validArtifactIds).sort().join(', ');
      warnings.push(
        `Unknown artifact ID in rules: "${artifactId}". ` +
          `It matches no artifact in any available schema. Known artifact IDs: ${validIds}`
      );
    }
  }

  return warnings;
}

/**
 * Suggest valid schema names when user provides invalid schema.
 * Uses fuzzy matching to find similar names.
 *
 * @param invalidSchemaName - The invalid schema name from config
 * @param availableSchemas - List of available schemas with their type (built-in or project-local)
 * @returns Error message with suggestions and available schemas
 */
export function suggestSchemas(
  invalidSchemaName: string,
  availableSchemas: { name: string; isBuiltIn: boolean }[]
): string {
  // Simple fuzzy match: Levenshtein distance
  function levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  // Find closest matches (distance <= 3)
  const suggestions = availableSchemas
    .map((s) => ({ ...s, distance: levenshtein(invalidSchemaName, s.name) }))
    .filter((s) => s.distance <= 3)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);

  const builtIn = availableSchemas.filter((s) => s.isBuiltIn).map((s) => s.name);
  const projectLocal = availableSchemas.filter((s) => !s.isBuiltIn).map((s) => s.name);

  let message = `Schema '${invalidSchemaName}' not found in openspec/config.yaml\n\n`;

  if (suggestions.length > 0) {
    message += `Did you mean one of these?\n`;
    suggestions.forEach((s) => {
      const type = s.isBuiltIn ? 'built-in' : 'project-local';
      message += `  - ${s.name} (${type})\n`;
    });
    message += '\n';
  }

  message += `Available schemas:\n`;
  if (builtIn.length > 0) {
    message += `  Built-in: ${builtIn.join(', ')}\n`;
  }
  if (projectLocal.length > 0) {
    message += `  Project-local: ${projectLocal.join(', ')}\n`;
  } else {
    message += `  Project-local: (none found)\n`;
  }

  message += `\nFix: Edit openspec/config.yaml and change 'schema: ${invalidSchemaName}' to a valid schema name`;

  return message;
}

// -----------------------------------------------------------------------------
// Store pointer (declared default store)
// -----------------------------------------------------------------------------

export interface StorePointerRead {
  /** The declared store id, when present and a string. */
  value?: string;
  /** Set when the pointer cannot be trusted: the config file could not be
   * read as YAML, or the store key is present but not a string. An empty
   * or comments-only config is NOT malformed - it simply has no pointer. */
  malformed?: 'unparseable' | 'non_string';
  /** Absolute path of the config file actually read, or null when none exists. */
  filePath: string | null;
}

/**
 * Warning-silent targeted read of the `store:` pointer. Used by root
 * resolution (which must not re-emit the resilient parser's field
 * warnings) and by `openspec init`'s pointer guard. Unlike
 * `readProjectConfig`, a malformed value is REPORTED, not dropped —
 * a dropped pointer would silently flip where work lands.
 */
export function readStorePointer(projectRoot: string): StorePointerRead {
  const configPath = resolveConfigFilePath(projectRoot);
  if (configPath === null) {
    return { filePath: null };
  }

  try {
    const raw = parseYaml(readFileSync(configPath, 'utf-8'));
    // Empty, comments-only, or non-mapping configs carry no pointer;
    // they are imperfect, not malformed (readProjectConfig owns the
    // field warnings for those).
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { filePath: configPath };
    }
    const value = (raw as Record<string, unknown>).store;
    if (value === undefined) {
      return { filePath: configPath };
    }
    if (typeof value === 'string') {
      return { value, filePath: configPath };
    }
    return { malformed: 'non_string', filePath: configPath };
  } catch {
    return { malformed: 'unparseable', filePath: configPath };
  }
}

/** Shared .yaml/.yml probe used by readProjectConfig and readStorePointer. */
export function resolveConfigFilePath(projectRoot: string): string | null {
  const yamlPath = path.join(projectRoot, 'openspec', 'config.yaml');
  if (existsSync(yamlPath)) {
    return yamlPath;
  }
  const ymlPath = path.join(projectRoot, 'openspec', 'config.yml');
  return existsSync(ymlPath) ? ymlPath : null;
}

/** Human rendering of a malformed pointer reason, shared by every surface. */
export function storePointerProblem(reason: 'unparseable' | 'non_string'): string {
  return reason === 'unparseable'
    ? 'the config file could not be read as YAML'
    : 'the store key must be a single store id string';
}

export interface OpenSpecDirClassification {
  /** True when openspec/specs or openspec/changes exists as a directory. */
  hasPlanningShape: boolean;
  pointer: StorePointerRead;
}

/**
 * One classification for "real root vs config-only pointer dir", shared
 * by root resolution and the init pointer guard so they can never
 * disagree (slice 3.2).
 */
export function classifyOpenSpecDir(projectRoot: string): OpenSpecDirClassification {
  const openspecDir = path.join(projectRoot, 'openspec');
  const hasPlanningShape =
    isDirectorySync(path.join(openspecDir, 'specs')) ||
    isDirectorySync(path.join(openspecDir, 'changes'));
  return { hasPlanningShape, pointer: readStorePointer(projectRoot) };
}

function isDirectorySync(candidatePath: string): boolean {
  try {
    return statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}
