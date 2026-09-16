import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { runCLI } from '../helpers/run-cli.js';

/**
 * A config that cannot be read used to pass as "the project declared nothing":
 * `instructions` handed an agent a complete-looking instruction with the
 * project's context and rules missing, and `validate` reported the change as
 * fine. These runs check the three surfaces that now say so out loud.
 */
const VALID_CONFIG = ['schema: spec-driven', 'context: The project is a CLI.', ''].join('\n');

// A plain scalar with a second ": " in it - the way a rules list actually
// broke in practice, not a synthetic syntax error.
const BROKEN_CONFIG = [
  'schema: spec-driven',
  'rules:',
  '  proposal:',
  '    - Title: no longer: than 80 characters',
  '',
].join('\n');

describe('a project config that cannot be read is reported, not ignored', () => {
  let projectDir: string;
  let configPath: string;

  beforeEach(async () => {
    projectDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-loud-config-')));
    configPath = path.join(projectDir, 'openspec', 'config.yaml');
    const changeDir = path.join(projectDir, 'openspec', 'changes', 'demo');
    await fs.mkdir(path.join(changeDir, 'specs', 'alpha'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'openspec', 'specs'), { recursive: true });
    await fs.writeFile(configPath, VALID_CONFIG, 'utf-8');
    await fs.writeFile(
      path.join(changeDir, 'proposal.md'),
      [
        '# Demo',
        '',
        '## Why',
        'Because the reason here is long enough for validation to accept it.',
        '',
        '## What Changes',
        '- **alpha:** add something',
        '',
      ].join('\n'),
      'utf-8'
    );
    await fs.writeFile(
      path.join(changeDir, 'specs', 'alpha', 'spec.md'),
      [
        '## ADDED Requirements',
        '### Requirement: Alpha SHALL be deterministic',
        'The alpha module SHALL produce a deterministic response.',
        '',
        '#### Scenario: Deterministic run',
        '- **WHEN** the module runs',
        '- **THEN** the output matches the fixture',
        '',
      ].join('\n'),
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  const breakConfig = () => fs.writeFile(configPath, BROKEN_CONFIG, 'utf-8');

  describe('openspec instructions', () => {
    it('refuses, naming the file and the parser reason', async () => {
      await breakConfig();

      const result = await runCLI(['instructions', 'proposal', '--change', 'demo'], {
        cwd: projectDir,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(configPath);
      expect(result.stderr).toContain('Nested mappings');
      expect(result.stderr).toContain('Fix:');
      // The instruction itself must not be produced.
      expect(result.stdout).not.toContain('<artifact');
    });

    it('puts the reason in the --json response, not only on stderr', async () => {
      await breakConfig();

      const result = await runCLI(['instructions', 'proposal', '--change', 'demo', '--json'], {
        cwd: projectDir,
      });

      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout);
      expect(payload.status).toHaveLength(1);
      expect(payload.status[0]).toMatchObject({
        severity: 'error',
        code: 'project_config_unreadable',
      });
      expect(payload.status[0].message).toContain(configPath);
      expect(payload.status[0].fix).toContain(configPath);
    });

    it('still generates the instruction, with the project context, when the config parses', async () => {
      const result = await runCLI(['instructions', 'proposal', '--change', 'demo'], {
        cwd: projectDir,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('<artifact id="proposal"');
      expect(result.stdout).toContain('The project is a CLI.');
    });
  });

  describe('openspec validate', () => {
    it('reports an ERROR and exits non-zero in the default mode, not only --strict', async () => {
      await breakConfig();

      const result = await runCLI(['validate', '--all'], { cwd: projectDir });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('[ERROR]');
      expect(result.stderr).toContain(configPath);
      expect(result.stderr).toContain('Fix:');
    });

    it('carries the reason in --json, alongside the command\'s empty payload', async () => {
      await breakConfig();

      const result = await runCLI(['validate', 'demo', '--json'], { cwd: projectDir });

      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout);
      expect(payload.items).toEqual([]);
      expect(payload.status[0]).toMatchObject({
        severity: 'error',
        code: 'project_config_unreadable',
      });
    });

    it('validates normally when the config parses', async () => {
      const result = await runCLI(['validate', '--all'], { cwd: projectDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('change/demo');
    });
  });

  describe('openspec doctor', () => {
    it('names the problem and how to fix it', async () => {
      await breakConfig();

      const result = await runCLI(['doctor'], { cwd: projectDir });

      expect(result.stdout).toContain('could not be read as project configuration');
      expect(result.stdout).toContain(configPath);
      expect(result.stdout).toContain('Fix: Fix the YAML in');
    });

    it('reports it as a root diagnostic in --json', async () => {
      await breakConfig();

      const result = await runCLI(['doctor', '--json'], { cwd: projectDir });

      const health = JSON.parse(result.stdout);
      const configStatus = health.root.status.find(
        (entry: { code: string }) => entry.code === 'project_config_unreadable'
      );
      expect(configStatus).toBeDefined();
      expect(configStatus.fix).toContain(configPath);
    });

    it('says nothing about the config when it parses', async () => {
      const result = await runCLI(['doctor', '--json'], { cwd: projectDir });

      const health = JSON.parse(result.stdout);
      expect(health.root.status).toEqual([]);
    });
  });

  it('keeps a missing config normal: no config is not a broken config', async () => {
    await fs.rm(configPath);

    const instructions = await runCLI(['instructions', 'proposal', '--change', 'demo'], {
      cwd: projectDir,
    });
    const validate = await runCLI(['validate', '--all'], { cwd: projectDir });

    expect(instructions.exitCode).toBe(0);
    expect(validate.exitCode).toBe(0);
  });
});
