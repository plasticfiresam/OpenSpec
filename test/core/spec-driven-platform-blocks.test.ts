import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSchema } from '../../src/core/artifact-graph/schema.js';
import { buildUpdatedSpec, findSpecUpdates } from '../../src/core/specs-apply.js';

const SCHEMA_DIR = path.join(process.cwd(), 'schemas', 'spec-driven');
const CYRILLIC = /[Ѐ-ӿ]/u;

/** Strings that belong to a concrete Surf template revision, never to the schema. */
const TEMPLATE_FACTS: RegExp[] = [/make /u, /apps\/main\//u, /\.dart/u, /docs\/code-rules/u];

const SURF_COMPONENTS = [
  'Flow', 'ViewModel', 'View', 'Widget',
  'Entity', 'Bloc', 'Event', 'State', 'Action', 'IRepository', 'Failure',
  'Repository', 'Converter', 'DataSource',
  'Assembly', 'Result', 'DTO', 'Storage', 'DAO',
];

const SEAM_PAIRS = [
  'Bloc → bloc_test',
  'Repository → unit',
  'Converter, Entity, pure rules → unit',
  'View → golden',
  'Widget → golden',
  'Flow, Assembly, DataSource → not covered',
];

/**
 * A delta written the way the spec template asks for: a coverage table above
 * the delta, a bold-labelled form with a table inside the requirement, and a
 * GIVEN/WHEN/THEN/AND scenario named as its test (`<what happens> when <condition>`).
 */
const RICH_DELTA = [
  '## Purpose',
  '',
  'Даёт вошедшему пользователю видеть и обновлять баланс основного счёта.',
  '',
  '## Capability Coverage',
  '',
  '| Аспект | Requirement(s) или N/A | Что требует подтверждения человеком |',
  '|---|---|---|',
  '| Чтение данных | Balance is refreshed on pull | форматирование |',
  '',
  '## ADDED Requirements',
  '',
  '### Requirement: Balance is refreshed on pull',
  '',
  'Приложение SHALL перезагружать баланс по pull-to-refresh',
  'и SHALL держать последний известный баланс видимым во время перезагрузки.',
  '',
  '**Правила отображения**',
  '',
  '| Поле | Источник | Формат |',
  '|---|---|---|',
  '| balance | баланс счёта | валюта с двумя знаками, с учётом локали |',
  '',
  '**Инвариант**',
  '',
  'показанный баланс == последний успешно загруженный баланс',
  '',
  '#### Scenario: keeps the last known balance visible when the refresh runs offline',
  '',
  '- **GIVEN** экран баланса показывает ранее загруженный баланс',
  '- **WHEN** пользователь тянет для обновления без сети',
  '- **THEN** последний известный баланс остаётся видимым с пометкой offline',
  '- **AND** диалог ошибки не показывается',
  '',
].join('\n');

async function readTemplate(name: string): Promise<string> {
  return fs.readFile(path.join(SCHEMA_DIR, 'templates', `${name}.md`), 'utf8');
}

function instructionOf(id: string): string {
  const schema = loadSchema(path.join(SCHEMA_DIR, 'schema.yaml'));
  return schema.artifacts.find((a) => a.id === id)?.instruction ?? '';
}

/** The apply phase instruction, which lives outside the artifact list. */
function applyInstruction(): string {
  return loadSchema(path.join(SCHEMA_DIR, 'schema.yaml')).apply?.instruction ?? '';
}

describe('spec-driven platform blocks', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('keeps the standard artifact graph', () => {
    const schema = loadSchema(path.join(SCHEMA_DIR, 'schema.yaml'));
    const artifact = (id: string) => schema.artifacts.find((a) => a.id === id);

    expect(schema.name).toBe('spec-driven');
    expect(schema.artifacts.map((a) => a.id)).toEqual(['proposal', 'specs', 'design', 'tasks']);
    expect(artifact('specs')?.requires).toEqual(['proposal']);
    expect(artifact('design')?.requires).toEqual(['proposal']);
    expect(artifact('tasks')?.requires).toEqual(['specs', 'design']);
    expect(schema.apply?.tracks).toBe('tasks.md');
  });

  it('describes the Flutter client in the design instruction next to the mini paragraph', () => {
    const design = instructionOf('design');

    expect(design).toContain('For mini-based implementation');
    expect(design).toContain('Flutter client on the Surf standard');
    for (const component of SURF_COMPONENTS) {
      expect(design).toContain(component);
    }
    expect(design).toMatch(/Prohibited: Helper, Service, Manager,\s+Handler, or Utils classes/u);
    expect(design).toMatch(/no use cases or\s+interactors/u);
    expect(design).toMatch(/Layer boundaries are a principle of the design/u);
    expect(design).toMatch(/domain does not depend on data, presentation,\s+datasource, or ui/u);
    expect(design).toMatch(/a Repository does\s+not import other Repositories and a Bloc does not import other Blocs/u);
    for (const seam of ['unit', 'bloc_test', 'golden', 'not covered']) {
      expect(design).toContain(seam);
    }
    for (const pair of SEAM_PAIRS) {
      expect(design).toContain(pair);
    }
    expect(design).toMatch(/Route registration and Assembly registration are mandatory facts of\s+the design/u);
    expect(design).toMatch(/generator hook or by hand - comes\s+from the project context and rules/u);
    // Mini client sub-block: concepts only, no SDK class names.
    for (const concept of ['generated contract and DTOs', 'CRUDL, `aggregate`, and FSM', '`CustomMethod`', 'idempotency key', 'SSE event → invalidation', 'refetch of the active screen state', 'push registration', 'ETag HTTP cache', 'Blocs and Views never see mini types']) {
      expect(design).toContain(concept);
    }
    expect(design).not.toMatch(/Mini[A-Z][A-Za-z]+Client|MiniSdkRuntime|Mini[A-Za-z]+Interceptor/u);
  });

  it('ships the Flutter block in the design template and keeps the mini hints', async () => {
    const template = await readTemplate('design');

    expect(template).toMatch(CYRILLIC);
    expect(template).toContain('удалите, если change не');
    expect(template).toContain('Flutter-клиент');
    expect(template).toContain('## Component Coverage');
    expect(template).toContain('| Требование | Компонент | Слой | Seam | Имя теста |');
    expect(template).toContain('|---|---|---|---|---|');
    for (const component of SURF_COMPONENTS) {
      expect(template).toContain(component);
    }
    expect(template).toContain('Helper, Service,\nManager, Handler и Utils');
    for (const seam of ['unit', 'bloc_test', 'golden', 'not covered']) {
      expect(template).toContain(seam);
    }
    expect(template).toContain('## Layer Boundaries And Registration');
    expect(template).toContain('- **Регистрация маршрута:**');
    expect(template).toContain('- **Регистрация Assembly:**');
    expect(template).toContain('### Backend contract: mini (клиент)');
    for (const line of ['- **Сгенерированный контракт и DTO:**', '- **Ресурсы:** [CRUDL, `aggregate`', '- **CustomMethod:**', '- **Realtime:** [SSE-событие → инвалидация Repository или кэша → refetch']) {
      expect(template).toContain(line);
    }
    // The pre-existing mini block under Decisions is untouched.
    expect(template).toContain('## Decisions');
    expect(template).toContain('- Resource/registry;');
    expect(template).toContain('- SSE, invalidation и refetch.');
  });

  it('names Scenarios as tests in the specs instruction and template', async () => {
    const specs = instructionOf('specs');
    const template = await readTemplate('spec');

    for (const text of [specs, template]) {
      expect(text).toContain('`<what happens> when <condition>`');
    }
    expect(specs).toMatch(/without the words "should"\s+and "test"/u);
    expect(specs).toMatch(/Give every observable screen state[\s\S]*its\s+own Scenario/u);
    expect(specs).toContain('- Each scenario: `#### Scenario: <what happens> when <condition>`');
    expect(template).toMatch(/без слов should и test/u);
    expect(template).toMatch(/У каждого наблюдаемого состояния экрана[\s\S]*свой Scenario/u);
    expect(template).toContain('#### Scenario: [what happens] when [condition]');
    expect(template).toMatch(CYRILLIC);

    // Every Scenario example in the schema and the spec template follows the form.
    const schema = loadSchema(path.join(SCHEMA_DIR, 'schema.yaml'));
    const scenarioNames = [schema.artifacts.map((a) => a.instruction).join('\n'), template]
      .flatMap((text) => [...text.matchAll(/#### Scenario: (.+)$/gmu)].map((m) => m[1].replace(/`\.?$/u, '')));
    expect(scenarioNames.length).toBeGreaterThan(1);
    for (const name of scenarioNames) {
      expect(name).toMatch(/^.+ when .+$/u);
      expect(name).not.toMatch(/\b(should|test)\b/iu);
    }
  });

  it('ships the conditional nine-row coverage table in the spec template', async () => {
    const specs = instructionOf('specs');
    const template = await readTemplate('spec');

    expect(specs).toMatch(/conditional\s+`## Capability Coverage` block/u);
    expect(specs).toMatch(/delete the whole block otherwise/u);
    expect(template).toContain('## Capability Coverage');
    expect(template).toContain('удалите блок целиком, если change не про клиент');
    expect(template).toContain('| Аспект | Requirement(s) или N/A | Что требует подтверждения человеком |');
    const rows = template.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Аспект'));
    expect(rows).toHaveLength(9);
    for (const concern of ['Чтение данных', 'UI-семантика', 'Чистая бизнес-логика', 'сверх обычного CRUD', 'timeout, offline и pending', 'loading, empty, error, partial и stale', 'Realtime, push и sync', 'сквозных пользовательских путей', 'права, персистентность, deep links']) {
      expect(template).toContain(concern);
    }
    expect(template.indexOf('## Capability Coverage')).toBeLessThan(template.indexOf('## ADDED Requirements'));
  });

  it('keeps the Flutter Definition of Done free of commands and paths', async () => {
    const tasks = instructionOf('tasks');
    const template = await readTemplate('tasks');

    expect(tasks).toContain('Flutter client on the Surf standard');
    expect(tasks).toMatch(/come from the project `context` and `rules` in\s+`openspec\/config\.yaml`/u);
    expect(tasks).toMatch(/Bloc,\s+Repository, Converter, and pure rule has a unit test/u);
    expect(tasks).toMatch(/View and\s+public Widget has a golden with a scenario per State variant/u);
    expect(tasks).toMatch(/every\s+changed snapshot is explained in the MR/u);
    expect(tasks).toMatch(/MR size limit comes from the project\s+rules/u);
    expect(tasks).toContain('`openspec validate <change> --strict` green');
    expect(tasks).toMatch(/Entity and Failure → IRepository → DTO,\s+DataSource, Converter, Repository → Bloc/u);

    expect(template).toMatch(CYRILLIC);
    expect(template).toContain('удалите, если change\n     не про Flutter-клиент');
    expect(template).toContain('## 3. Definition of Done');
    expect(template).toMatch(/берутся из `context` и\s+`rules` проекта в `openspec\/config\.yaml`/u);
    expect(template).toContain('- [ ] 3.1 Прогнать `openspec validate <change> --strict`');
    expect(template).toMatch(/Bloc, Repository, Converter и чистого правила есть unit-тест \(bloc_test для Bloc\)/u);
    expect(template).toMatch(/View и публичного Widget есть golden со сценарием на каждый вариант State/u);
    expect(template).toMatch(/каждый изменённый снимок объяснён в описании MR/u);
    expect(template).toMatch(/маршрут ведёт на него, а Assembly отдаёт ему зависимости/u);
    expect(template).toMatch(/лимит размера из правил проекта/u);
    expect(template).not.toMatch(/\b400\b/u);
  });

  it('carries no Surf template facts in schema.yaml or templates', async () => {
    const files = [
      await fs.readFile(path.join(SCHEMA_DIR, 'schema.yaml'), 'utf8'),
      ...(await Promise.all(['proposal', 'spec', 'design', 'tasks'].map(readTemplate))),
    ];
    for (const text of files) {
      for (const fact of TEMPLATE_FACTS) {
        expect(text).not.toMatch(fact);
      }
      expect(text).not.toMatch(/\b[0-9a-f]{40}\b/u);
      expect(text).not.toMatch(/chore\/flutter|feature\/testing-convention/u);
      for (const helper of ['FakeStateStreamable', 'FakeLogWriter', 'GoldenApp', 'failureOf', 'post_gen', 'Makefile']) {
        expect(text).not.toContain(helper);
      }
    }
  });

  it('writes all four templates in Russian, proposal included', async () => {
    for (const name of ['proposal', 'spec', 'design', 'tasks']) {
      expect(await readTemplate(name)).toMatch(CYRILLIC);
    }

    // The proposal template moved from HTML comments to bracketed hints,
    // keeping the headings the proposal instruction names and the technical
    // strings verbatim.
    const proposal = await readTemplate('proposal');
    expect(proposal).not.toContain('<!--');
    for (const heading of ['## Why', '## What Changes', '## Capabilities', '### New Capabilities', '### Modified Capabilities', '## Impact']) {
      expect(proposal).toContain(heading);
    }
    for (const kept of ['- `<capability-path>`:', '- `<existing-capability-path>`:', 'kebab-case', '`specs/<capability-path>/spec.md`', '`skip_specs: true`', '`.openspec.yaml`', '`openspec validate`', 'exact existing path under openspec/specs/']) {
      expect(proposal).toContain(kept);
    }
  });

  it('marks every conditional block as conditional, mini blocks included', async () => {
    const template = await readTemplate('design');
    const design = instructionOf('design');

    // Flutter client block.
    expect(template).toMatch(/Условный блок для Flutter-клиента[\s\S]*?удалите, если change не\s+про Flutter-клиент/u);
    expect(design).toMatch(/Component Coverage and Layer Boundaries And Registration are\s+conditional blocks of the template: keep them when the change is about a\s+Flutter client on the Surf standard, delete them otherwise/u);
    // mini client sub-block.
    expect(template).toMatch(/Условный подблок: оставьте, только если клиент общается с бэкендом mini;\s+иначе удалите подблок/u);
    expect(design).toMatch(/Delete the sub-block\s+when the backend is not mini/u);
    // mini backend hints under Decisions.
    expect(template).toMatch(/Условный список: оставьте пункты про mini, только если бэкенд change\s+построен на mini; иначе удалите их/u);
    expect(design).toMatch(/Keep the mini decisions below only when the change's backend is built\s+on mini; when the backend is a different one, delete them/u);
  });

  it('sends the apply phase to the Definition of Done checks and the project rules', () => {
    const apply = applyInstruction();

    expect(apply).toMatch(/Before marking a group of tasks complete, run the checks the tasks\s+Definition of Done names/u);
    expect(apply).toMatch(/project commands from `rules\.tasks` in\s+`openspec\/config\.yaml`/u);
    expect(apply).toMatch(/A red check keeps the group open/u);
  });

  it('tells the specs author how a journey is proven, in step with the design instruction', () => {
    const specs = instructionOf('specs');
    const design = instructionOf('design');

    expect(specs).toMatch(/row for key navigation and end-to-end journeys expects no separate\s+end-to-end test/u);
    expect(specs).toMatch(/the Bloc's Action \(bloc_test\), the View's golden, and the route\s+registration checked on a device in the tasks Definition of Done/u);
    expect(design).toMatch(/There is no end-to-end seam: a journey is proven by the Bloc's Action\s+\(bloc_test\), the View's golden, and the route registration checked on\s+a device in the tasks Definition of Done/u);
  });

  it('tells the README reader to replace every bracketed hint before --strict', async () => {
    const readme = await fs.readFile(path.join(SCHEMA_DIR, 'README.md'), 'utf8');

    expect(readme).toContain('`#### Scenario: [what happens] when [condition]`');
    expect(readme).toMatch(/Все подсказки в квадратных скобках, включая заготовку/u);
    expect(readme).toMatch(/заменяются целиком до\s+запуска `openspec validate <name> --strict`/u);
    expect(readme).toMatch(/незаменённая заготовка проверку\s+не проходит/u);
    // The CLI cannot tell a leftover hint from written text, so the README says who removes it.
    expect(readme).toMatch(/Снимает её\s+автор/u);
  });

  it('documents the conditional blocks and a Surf config example in the README', async () => {
    const readme = await fs.readFile(path.join(SCHEMA_DIR, 'README.md'), 'utf8');

    expect(readme).toMatch(CYRILLIC);
    expect(readme).toContain('## Условные блоки');
    expect(readme).toContain('schema: spec-driven');
    expect(readme).toContain('context: |');
    expect(readme).toMatch(/^rules:\n  design:\n/mu);
    expect(readme).toMatch(/^  tasks:\n/mu);
    for (const fact of [
      'Surf v1.1', 'Dart 3.13',
      'test/ зеркалит lib/', 'apps/main/test/feature/<feature>/<layer>/<file>_test.dart', 'goldens/ci/', 'modules/ui/test/',
      'apps/main/test/helpers/', 'FakeStateStreamable', 'FakeLogWriter', 'GoldenApp', 'failureOf',
      'make gen-screen', 'post_gen', "AutoRoute(page: <Screen>Route.page, path: '/<screen-kebab-case>')", 'make gen-app',
      'avoid-banned-imports', 'apps/main/analysis_options.yaml',
      'docs/code-rules/testing.md', 'docs/code-rules/components-index.md',
      'make format', 'make format-soft', 'make analyze', 'make run-tests', 'make reset-goldens',
      '400 строк',
    ]) {
      expect(readme).toContain(fact);
    }
    // The schema is conceptual: the README names no revision, no hash, and no template branch.
    expect(readme).not.toMatch(/\bpin/iu);
    expect(readme).not.toMatch(/\bпин/iu);
    expect(readme).not.toMatch(/\b[0-9a-f]{40}\b/u);
    expect(readme).not.toMatch(/chore\/flutter|feature\/testing-convention/u);
  });

  it('archives a rich delta without losing tables, bold forms, or GIVEN/WHEN/THEN', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-platform-blocks-'));
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'account-balance');
    const mainSpecsDir = path.join(tempDir, 'openspec', 'specs');
    const source = path.join(changeDir, 'specs', 'account-balance', 'spec.md');
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, RICH_DELTA);

    const [update] = await findSpecUpdates(changeDir, mainSpecsDir);
    const result = await buildUpdatedSpec(update, 'account-balance', { silent: true });

    expect(result.counts.added).toBe(1);
    expect(result.rebuilt).toContain('### Requirement: Balance is refreshed on pull');
    expect(result.rebuilt).toContain('**Правила отображения**');
    expect(result.rebuilt).toContain('| balance | баланс счёта | валюта с двумя знаками, с учётом локали |');
    expect(result.rebuilt).toContain('**Инвариант**');
    expect(result.rebuilt).toContain('#### Scenario: keeps the last known balance visible when the refresh runs offline');
    expect(result.rebuilt).toContain('- **GIVEN** экран баланса показывает ранее загруженный баланс');
    expect(result.rebuilt).toContain('- **WHEN** пользователь тянет для обновления без сети');
    expect(result.rebuilt).toContain('- **THEN** последний известный баланс остаётся видимым с пометкой offline');
    expect(result.rebuilt).toContain('- **AND** диалог ошибки не показывается');
    // The coverage table lives above the delta and is not merged into the main spec.
    expect(result.rebuilt).not.toContain('## Capability Coverage');
  });
});
