import { describe, expect, it } from 'vitest';
import { findTemplatePlaceholderIssues } from '../../src/core/validation/template-placeholder.js';

const lines = (...rows: string[]) => rows.join('\n');

describe('findTemplatePlaceholderIssues', () => {
  describe('reports a prompt the template shipped with', () => {
    it('reports a line that is entirely a bracketed prompt', () => {
      expect(findTemplatePlaceholderIssues(lines('## Purpose', '', '[Опишите назначение.]'))).toEqual(
        [{ line: 3, kind: 'bracketed', text: '[Опишите назначение.]' }]
      );
    });

    it('reports a multi-paragraph prompt once, at the line it opens on', () => {
      const content = lines(
        '## ADDED Requirements',
        '',
        '[Опишите наблюдаемое поведение:',
        '',
        '- одно правило;',
        '- один Scenario.',
        '',
        'Конец подсказки.]',
        '',
        '### Requirement: Retries are bounded'
      );

      const issues = findTemplatePlaceholderIssues(content);

      expect(issues).toHaveLength(1);
      expect(issues[0].line).toBe(3);
    });

    it('reports a prompt behind a bullet and bold, which is presentation, not content', () => {
      const issues = findTemplatePlaceholderIssues('**[Название применимой формы]**');

      expect(issues).toEqual([
        { line: 1, kind: 'bracketed', text: '[Название применимой формы]' },
      ]);
    });

    it('reports an HTML comment, the English templates\' prompt form', () => {
      const issues = findTemplatePlaceholderIssues(
        lines('## Why', '', '<!-- Explain the motivation for this change. -->')
      );

      expect(issues).toEqual([
        { line: 3, kind: 'comment', text: '<!-- Explain the motivation for this change. -->' },
      ]);
    });

    it('reports a multi-line HTML comment once', () => {
      const content = lines('<!-- Capabilities being introduced.', '     One per line. -->', 'text');

      const issues = findTemplatePlaceholderIssues(content);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ line: 1, kind: 'comment' });
    });

    it('reports a Requirement named by a prompt, which the structure checks accept', () => {
      const issues = findTemplatePlaceholderIssues(
        '### Requirement: [Стабильный ID — Название, если проект использует IDs]'
      );

      expect(issues).toEqual([
        {
          line: 1,
          kind: 'header',
          text: '### Requirement: [Стабильный ID — Название, если проект использует IDs]',
        },
      ]);
    });

    it('reports a Scenario named by a prompt', () => {
      const issues = findTemplatePlaceholderIssues(
        '#### Scenario: [what happens] when [condition]'
      );

      expect(issues).toEqual([
        { line: 1, kind: 'header', text: '#### Scenario: [what happens] when [condition]' },
      ]);
    });
  });

  describe('leaves the lookalikes alone', () => {
    it('ignores an inline Markdown link', () => {
      expect(findTemplatePlaceholderIssues('[OpenSpec docs](https://example.test/docs)')).toEqual(
        []
      );
    });

    it('ignores a reference-style Markdown link', () => {
      expect(findTemplatePlaceholderIssues('[OpenSpec docs][docs]')).toEqual([]);
    });

    it('ignores task checkboxes, done and not done', () => {
      const content = lines('- [ ] 1.1 Write the parser', '- [x] 1.2 Write the test', '- [ ]');

      expect(findTemplatePlaceholderIssues(content)).toEqual([]);
    });

    it('ignores everything inside a fenced code block', () => {
      const content = lines(
        '## Purpose',
        '',
        'Shows the prompt syntax the templates use.',
        '',
        '```markdown',
        '[Опишите назначение.]',
        '### Requirement: [Стабильный ID — Название]',
        '<!-- Explain the motivation -->',
        '```'
      );

      expect(findTemplatePlaceholderIssues(content)).toEqual([]);
    });

    it('ignores a named header with a real name', () => {
      expect(
        findTemplatePlaceholderIssues('### Requirement: Retries are bounded [see ADR-4](adr-4.md)')
      ).toEqual([]);
    });

    it('ignores a sentence that merely contains brackets', () => {
      expect(
        findTemplatePlaceholderIssues('The parser SHALL accept [ and ] inside requirement text.')
      ).toEqual([]);
    });

    it('reports nothing for a bracket that never closes, rather than swallowing the file', () => {
      const content = lines('[Опишите назначение', '', '## Requirements', '', 'Real content.');

      expect(findTemplatePlaceholderIssues(content)).toEqual([]);
    });
  });

  it('reads CRLF documents the same way, so line numbers do not depend on the editor', () => {
    const issues = findTemplatePlaceholderIssues('## Purpose\r\n\r\n[Опишите назначение.]\r\n');

    expect(issues).toEqual([{ line: 3, kind: 'bracketed', text: '[Опишите назначение.]' }]);
  });
});
