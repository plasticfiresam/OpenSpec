import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Validator } from '../../src/core/validation/validator.js';
import { VALIDATION_MESSAGES } from '../../src/core/validation/constants.js';

const TEMPLATE_DELTA = [
  '## ADDED Requirements',
  '',
  '[Перед сохранением замените все подсказки в квадратных скобках и удалите',
  'неприменимый текст.]',
  '',
  '### Requirement: [Стабильный ID — Название, если проект использует IDs]',
  '',
  '[Сформулируйте нормативное правило с `SHALL` или `MUST`.]',
  '',
  '#### Scenario: [what happens] when [condition]',
  '',
  '- **WHEN** [условие или действие]',
  '- **THEN** [наблюдаемый результат]',
  '',
].join('\n');

const WRITTEN_DELTA = [
  '## ADDED Requirements',
  '',
  '### Requirement: Retries are bounded',
  'The system SHALL stop retrying a delivery after the configured budget.',
  '',
  '#### Scenario: Budget exhausted',
  '- **WHEN** the budget is exhausted',
  '- **THEN** the delivery is abandoned',
  '',
].join('\n');

describe('Template placeholder validation', () => {
  let tempDir: string;
  let changeDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-template-placeholder-'));
    changeDir = path.join(tempDir, 'changes', 'add-widgets');
    await fs.mkdir(path.join(changeDir, 'specs', 'widgets'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function writeDelta(content: string): Promise<void> {
    await fs.writeFile(path.join(changeDir, 'specs', 'widgets', 'spec.md'), content, 'utf-8');
  }

  const placeholderIssues = (issues: Array<{ message: string }>) =>
    issues.filter((issue) => issue.message.includes(VALIDATION_MESSAGES.TEMPLATE_PLACEHOLDER));

  describe('severity is what --strict is for', () => {
    it('warns but passes by default, so an author can validate a draft', async () => {
      await writeDelta(TEMPLATE_DELTA);

      const report = await new Validator().validateChangeDeltaSpecs(changeDir);

      expect(report.valid).toBe(true);
      expect(placeholderIssues(report.issues).length).toBeGreaterThan(0);
      expect(report.summary.errors).toBe(0);
    });

    it('fails under --strict, naming the file and the line of each prompt', async () => {
      await writeDelta(TEMPLATE_DELTA);

      const report = await new Validator(true).validateChangeDeltaSpecs(changeDir);

      expect(report.valid).toBe(false);
      const found = placeholderIssues(report.issues);
      expect(found.length).toBeGreaterThan(0);
      for (const issue of found) {
        expect(issue).toMatchObject({ level: 'WARNING', path: 'widgets/spec.md' });
        expect((issue as { line?: number }).line).toBeGreaterThan(0);
      }
      // The header prompts the structural checks accept are among them.
      expect(found.some((issue) => issue.message.includes('### Requirement: ['))).toBe(true);
      expect(found.some((issue) => issue.message.includes('#### Scenario: ['))).toBe(true);
    });

    it('leaves a written delta alone, including under --strict', async () => {
      await writeDelta(WRITTEN_DELTA);

      const report = await new Validator(true).validateChangeDeltaSpecs(changeDir);

      expect(placeholderIssues(report.issues)).toEqual([]);
      expect(report.valid).toBe(true);
    });
  });

  describe('lookalikes do not fail a written change', () => {
    it('accepts links, checkboxes and fenced examples of the prompt syntax', async () => {
      await writeDelta(
        [
          '## ADDED Requirements',
          '',
          '### Requirement: Retries are bounded',
          'The system SHALL stop retrying after the budget, per [ADR-4](../adr-4.md) and [the note][note].',
          '',
          '- [ ] follow-up: measure the budget',
          '- [x] done: pick the default',
          '',
          'The template prompt looks like this:',
          '',
          '```markdown',
          '### Requirement: [Стабильный ID — Название]',
          '<!-- Explain the motivation -->',
          '```',
          '',
          '#### Scenario: Budget exhausted',
          '- **WHEN** the budget is exhausted',
          '- **THEN** the delivery is abandoned',
          '',
          '[note]: ../notes.md',
          '',
        ].join('\n')
      );

      const report = await new Validator(true).validateChangeDeltaSpecs(changeDir);

      expect(placeholderIssues(report.issues)).toEqual([]);
      expect(report.valid).toBe(true);
    });
  });

  describe('the change proposal is read the same way', () => {
    it('warns about the HTML-comment prompts an unedited proposal still carries', async () => {
      const proposal = [
        '# Add widgets',
        '',
        '## Why',
        '<!-- Explain the motivation for this change. What problem does this solve? -->',
        '',
        '## What Changes',
        '- **widgets:** add the capability',
        '',
      ].join('\n');
      const proposalPath = path.join(changeDir, 'proposal.md');
      await fs.writeFile(proposalPath, proposal, 'utf-8');
      await writeDelta(WRITTEN_DELTA);

      const report = await new Validator(true).validateChange(proposalPath);

      const found = placeholderIssues(report.issues);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ level: 'WARNING', path: 'file', line: 4 });
      expect(report.valid).toBe(false);
    });
  });
});
