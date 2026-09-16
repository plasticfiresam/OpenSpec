import { buildCodeFenceMask } from '../parsers/code-fence.js';

/**
 * Detects the prompts a template ships with, still sitting in the document
 * somebody was supposed to replace them in.
 *
 * Every structural check the validator already has is satisfied by an
 * untouched template: a `### Requirement: [Стабильный ID — Название…]` has a
 * name, its `#### Scenario: [what happens] when [condition]` is a scenario, and
 * a delta that is byte-for-byte the template parses into requirements. So the
 * one document that is certainly not written yet passes `validate --strict`,
 * which is the mode whose whole job is refusing unfinished work. The rule was
 * already written down for authors; this makes the tool the one that applies
 * it.
 *
 * Three forms count, and deliberately nothing else:
 *
 * - a line or paragraph that is entirely one bracketed prompt, which is how the
 *   Russian templates write theirs (`[Опишите …]`), including the multi-line
 *   blocks that run from `[` to a closing `]` several paragraphs later;
 * - an HTML comment, which is how the English templates write theirs;
 * - a Requirement or Scenario whose whole name is a bracketed prompt - the
 *   header form the structural checks read as a real, named block.
 *
 * Three lookalikes deliberately do not count, because reporting them would
 * teach authors to ignore the finding:
 *
 * - a Markdown link, inline `[text](url)` or reference `[text][ref]`;
 * - a task checkbox, `- [ ]` and `- [x]`;
 * - anything inside a fenced code block: templates and specs show their
 *   examples exactly there, so a document explaining the prompt syntax must not
 *   fail for quoting it.
 */

export type TemplatePlaceholderKind = 'bracketed' | 'comment' | 'header';

export interface TemplatePlaceholderIssue {
  /** 1-based line where the placeholder starts. */
  line: number;
  /** Which form matched, so the message can name what to replace. */
  kind: TemplatePlaceholderKind;
  /** The placeholder's first line, trimmed and shortened for the message. */
  text: string;
}

const MAX_QUOTED_LENGTH = 80;

/** `### Requirement: <name>` / `#### Scenario: <name>`, the two named headers. */
const NAMED_HEADER = /^ {0,3}(#{3,4})[ \t]+(Requirement|Scenario):[ \t]*(.*)$/i;

/** A bullet or ordered-list marker, stripped before a line is judged. */
const LIST_MARKER = /^(?:[-*+]|\d+[.)])[ \t]+/;

/** `[ ]`, `[]`, `[x]` - a checkbox, not a prompt. */
const CHECKBOX = /^\[[ xX]?\]$/;

/**
 * The text of a line with its list marker and surrounding emphasis removed, so
 * `- **[Название формы]**` is judged as `[Название формы]`. Emphasis and
 * bullets are how a prompt is presented, not part of what it says.
 */
function bareText(line: string): string {
  let text = line.trim().replace(LIST_MARKER, '').trim();
  for (;;) {
    const stripped = text.replace(/^(\*\*|__|\*|_)([\s\S]*)\1$/, '$2').trim();
    if (stripped === text) return text;
    text = stripped;
  }
}

interface BracketScan {
  /** Brackets still open after the text. */
  depth: number;
  /** The run closed on the last non-space character of the text. */
  closedAtEnd: boolean;
  /** The run closed with text still to come, so the text is not one prompt. */
  closedEarly: boolean;
}

/**
 * Where the bracket run stands after `text`, starting from `depth`.
 *
 * Counting (rather than matching a regex) is what separates a prompt from a
 * link: `[text][ref]` returns to depth 0 in the middle with `[ref]` still to
 * come, so it closed early and is a link; `[Опишите [что-то] ещё]` only returns
 * to 0 on the last character and is one prompt.
 */
function scanBrackets(text: string, depth: number): BracketScan {
  let current = depth;
  let closedAtEnd = false;
  let closedEarly = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') {
      current++;
      closedAtEnd = false;
    } else if (text[i] === ']') {
      current = Math.max(0, current - 1);
      if (current === 0) {
        const rest = text.slice(i + 1).trim();
        closedAtEnd = rest === '';
        if (rest !== '') closedEarly = true;
      }
    }
  }
  return { depth: current, closedAtEnd, closedEarly };
}

/**
 * True when a Requirement/Scenario NAME is nothing but the template's prompt.
 *
 * Looser than the body rule on purpose: the shipped Scenario prompt is
 * `[what happens] when [condition]` - two prompts with a word between them -
 * and a name that opens and closes in brackets is not something a person
 * writes. The two Markdown link spellings are still excluded, since `](` and
 * `][` are what makes a bracket pair a link rather than a prompt.
 */
function isPromptOnlyName(name: string): boolean {
  if (!name.startsWith('[') || !name.endsWith(']')) return false;
  return !name.includes('](') && !name.includes('][');
}

function quote(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ');
  return collapsed.length > MAX_QUOTED_LENGTH
    ? `${collapsed.slice(0, MAX_QUOTED_LENGTH - 1)}…`
    : collapsed;
}

/**
 * Every unreplaced prompt in `content`, in document order.
 *
 * Fenced code is masked through `buildCodeFenceMask`, the same masker the
 * requirement and structure parsers use, so this check and the parsers can
 * never disagree about where a code block is.
 *
 * A bracket that never closes reports nothing: the alternative is calling the
 * rest of the document one giant placeholder on the strength of one stray
 * character, and a finding that swallows a file is a finding authors switch
 * off. Line endings are normalised first, so a document reports the same lines
 * whether it was saved on Windows or on macOS/Linux.
 */
export function findTemplatePlaceholderIssues(content: string): TemplatePlaceholderIssue[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const fenced = buildCodeFenceMask(lines);
  const issues: TemplatePlaceholderIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const line = lines[i];

    // An HTML comment can span lines; skip to its end so one comment is one
    // finding rather than one per line of it.
    const commentStart = line.indexOf('<!--');
    if (commentStart !== -1) {
      issues.push({ line: i + 1, kind: 'comment', text: quote(line.slice(commentStart)) });
      if (!line.slice(commentStart).includes('-->')) {
        while (i + 1 < lines.length && !lines[i + 1].includes('-->')) i++;
        i++;
      }
      continue;
    }

    const header = NAMED_HEADER.exec(line);
    if (header) {
      if (isPromptOnlyName(header[3].trim())) {
        issues.push({ line: i + 1, kind: 'header', text: quote(line) });
      }
      continue;
    }

    const text = bareText(line);
    if (!text.startsWith('[') || CHECKBOX.test(text)) continue;

    const single = scanBrackets(text, 0);
    if (single.closedEarly) continue;
    if (single.depth === 0) {
      if (single.closedAtEnd) issues.push({ line: i + 1, kind: 'bracketed', text: quote(text) });
      continue;
    }

    // Open at end of line: a multi-paragraph prompt. It runs to the line whose
    // closing bracket ends it; blank lines inside are part of it.
    let depth = single.depth;
    let closedAtEnd = false;
    let closedEarly = false;
    let end = i;
    for (let j = i + 1; j < lines.length && depth > 0; j++) {
      if (fenced[j]) continue;
      const step = scanBrackets(lines[j], depth);
      depth = step.depth;
      closedAtEnd = step.closedAtEnd;
      closedEarly = step.closedEarly;
      end = j;
    }
    if (depth === 0 && closedAtEnd && !closedEarly) {
      issues.push({ line: i + 1, kind: 'bracketed', text: quote(text) });
      i = end;
    }
  }

  return issues;
}
