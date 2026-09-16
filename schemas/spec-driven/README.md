# Схема `spec-driven`

Схема по умолчанию: proposal → specs → design → tasks → apply → archive. Она
задаёт форму артефактов и словарь понятий, но не факты конкретного проекта.
Проект описывает себя сам в `openspec/config.yaml` (`context` и `rules`), и
эти факты попадают в инструкции каждого артефакта рядом с текстом схемы.

## Условные блоки

Шаблоны содержат блоки, которые нужны не каждому change. Каждый такой блок
начинается с подсказки в квадратных скобках или HTML-комментарии с пометкой,
когда его удалить. Правило одно: блок либо заполняется целиком, либо удаляется
целиком; пустые заготовки в артефакте не остаются.

Все подсказки в квадратных скобках, включая заготовку
`#### Scenario: [what happens] when [condition]`, заменяются целиком до
запуска `openspec validate <name> --strict`: Scenario с таким именем не
называет ни одного теста, и артефакт с ним не готов. Проверка сообщает о
каждой оставшейся подсказке: обычный прогон предупреждает, `--strict`
отклоняет change. Ссылки, чекбоксы задач и текст внутри блоков кода
подсказками не считаются.

| Артефакт | Блок | Когда оставить |
|---|---|---|
| `templates/spec.md` | `## Capability Coverage` — таблица покрытия клиентского приложения из девяти строк | change про клиентское приложение (мобильный, десктопный или веб-интерфейс) |
| `templates/design.md` | подсказки про mini в `## Decisions`: Resource/registry, CRUDL или `aggregate`, `CustomMethod`, FSM, SSE → invalidation → refetch | реализация на бэкенде mini |
| `templates/design.md` | `## Component Coverage` и `## Layer Boundaries And Registration` — таблица «требование → компонент → слой → seam → имя теста», регистрация маршрута и Assembly | change про Flutter-клиент на стандарте Surf |
| `templates/design.md` | `### Backend contract: mini (клиент)` внутри блока Flutter | тот же Flutter-клиент общается с бэкендом mini |
| `templates/tasks.md` | `## 3. Definition of Done` — чек-лист unit, bloc_test и golden, снимки, регистрация маршрута, лимит MR | change про Flutter-клиент на стандарте Surf |

Инструкции в `schema.yaml` содержат те же условные абзацы: агент видит и
блок в шаблоне, и правило, по которому он заполняется или удаляется. Когда
блок не относится к change, агент удаляет его без следа: в `design.md`
остаются только Context, Goals / Non-Goals, Decisions и Risks / Trade-offs, в
`tasks.md` — только группы задач.

## Что общее для всех проектов

- Имя Scenario — это имя теста: по-английски, в форме
  `<what happens> when <condition>`, без слов should и test. `design.md` и
  `tasks.md` повторяют его дословно; тело сценария пишется на языке
  спецификации. У каждого наблюдаемого состояния экрана свой Scenario.
- Для Flutter-клиента на стандарте Surf схема знает только концепты: закрытый
  словарь компонентов (Flow, ViewModel, View, Widget; Entity, Bloc, Event,
  State, Action, IRepository, Failure; Repository, Converter, DataSource;
  Assembly, Result, DTO, Storage, DAO), запрет Helper, Service, Manager,
  Handler и Utils, границы слоёв как принцип, три seam (unit, bloc_test,
  golden) и «not covered» для Flow, Assembly и DataSource, регистрацию
  маршрута и Assembly как обязательный факт дизайна.
- Для клиента mini схема знает только форму контракта: сгенерированный
  контракт и DTO, CRUDL и `aggregate` через клиент ресурсов, `CustomMethod` с
  идемпотентностью и инвалидацией, SSE-событие → инвалидация → refetch
  активного экрана, push, кэш по ETag, версия API; клиенты за DataSource.

## Что схема не знает

Схема концептуальна и не привязана к ревизии шаблона Surf, mini или другого
стека. В `schema.yaml` и шаблонах нет путей к файлам, имён хелперов, целей
Makefile, версий и ссылок на документы проекта: всё это меняется с каждым
релизом шаблона и живёт в `openspec/config.yaml` того проекта, который на этом
шаблоне построен. Ниже — пример такого файла: проект пишет его
один раз, при переходе на схему.

Разделение простое: `context` — долговременные факты проекта (версия шаблона,
раскладка, документы правил, бэкенд), `rules.design` — что дизайн обязан
назвать по правилам проекта (пути тестов, фейки, границы, как регистрируется
маршрут), `rules.tasks` — команды проекта и лимиты, которые подставляются в
задачи и в Definition of Done. Правила не повторяют словарь, seams и форму
Scenario: их уже задаёт схема.

## Пример `openspec/config.yaml` для проекта на шаблоне Surf

```yaml
schema: spec-driven

context: |
  Приложение построено на шаблоне Surf v1.1 (Flutter 3.47.4, Dart 3.13):
  Melos-монорепозиторий, apps/main и modules/*, flutter_bloc с bloc_action,
  рукописные Assembly для DI, auto_route, dio + retrofit, Drift и secure
  storage, Result/FutureResult/Failure из module_foundation.
  Фича лежит в apps/main/lib/feature/<name>/: <name>_assembly.dart,
  presentation/{<name>_flow,<name>_view_model,<name>_view}.dart,
  domain/{bloc,entity,failure,repository}, data/{converter,data_source,repository}.
  Эталонная фича: apps/main/lib/feature/debug/.
  Документы правил: docs/code-rules/components-index.md (словарь компонентов),
  docs/code-rules/testing.md (конвенция тестирования), docs/code-rules/imports.md
  (границы слоёв), docs/code-rules/feature-structure.md, docs/code-rules/screen-structure.md,
  docs/architecture/08-unit-tests.ru.md, docs/architecture/07-golden-tests.ru.md.
  Тесты: test/ зеркалит lib/ — apps/main/test/feature/<feature>/<layer>/<file>_test.dart,
  golden-тест View — presentation/<name>_view_golden_test.dart, снимки в goldens/ рядом
  с тестом; коммитятся только goldens/ci/ (шрифт Ahem, текст закрашен блоками),
  goldens/macos|linux|windows/ в .gitignore и служат только для просмотра.
  Golden публичных Widget — в modules/ui/test/ (например modules/ui/test/uikit/widget/<name>_golden_test.dart).
  Bloc: единственный Bloc фичи лежит плоско в domain/bloc/<name>_bloc.dart с тестом
  domain/bloc/<name>_bloc_test.dart (эталон debug); несколько Bloc — каждый в
  domain/bloc/<name>/, как генерирует брик bloc; тест зеркалит раскладку.
  Общие фейки: apps/main/test/helpers/ — FakeStateStreamable, FakeLogWriter, GoldenApp,
  failureOf; импортируются относительным путём. Моки фичи (_MockDebugRepository) —
  приватные классы внутри теста. Таблица исключение → Failure в BaseRepository.handle
  проверяется один раз в test/feature/app/data/repository/base_repository_test.dart.
  Golden: alchemist, конфигурация в test/flutter_test_config.dart (платформенные снимки
  только локально под --update-goldens), diffThreshold 0.0, Jenkins экспортирует CI=true;
  один goldenTest на View с GoldenTestScenario на вариант State, constraints:
  GoldenApp.phoneConstraints; бесконечная анимация — pumpBeforeTest: pumpOnce;
  состояние взаимодействия — whilePerforming: press(find.byKey(...)).
  Эталонные тесты: apps/main/test/feature/debug/domain/bloc/debug_bloc_test.dart,
  apps/main/test/feature/debug/data/repository/debug_repository_test.dart,
  apps/main/test/feature/debug/data/converter/proxy_url_converter_test.dart,
  apps/main/test/feature/debug/presentation/debug_view_golden_test.dart,
  modules/ui/test/uikit/widget/app_scale_pressable_golden_test.dart.
  Границы слоёв проверяет DCM avoid-banned-imports в apps/main/analysis_options.yaml:
  domain не импортирует data/, presentation/, модули datasource и module_ui;
  data не импортирует presentation/ и module_ui; presentation не импортирует data/
  и модули datasource; env не импортирует feature/ и модули observability;
  Repository не импортирует другие Repository, Bloc — другие Bloc;
  приватный src/ модуля module_datasource_persistence снаружи не импортируется.
  DCM запускается только на lib/, поэтому на тесты границы не распространяются.
  Бэкенд: mini (tenant "romashka", версия API 2026-06-01).

rules:
  design:
    - >-
      В таблице Component Coverage называйте тест путём и именем: путь — по
      раскладке из context (test/ зеркалит lib/), имя — Scenario из
      спецификации дословно.
    - >-
      Repository тестируется с моком DataSource и FakeLogWriter, Failure
      достаётся через failureOf; View — golden с фейковым ViewModel на
      FakeStateStreamable в обёртке GoldenApp.
    - >-
      Регистрация маршрута: экран создаётся бриком `make gen-screen
      feature_name=… screen_name=… name=…`; его post_gen-хук находит роутер по
      @AutoRouterConfig в apps/main/lib/feature/app/, импортирует Flow и
      добавляет AutoRoute(page: <Screen>Route.page, path: '/<screen-kebab-case>')
      в routes в apps/main/lib/feature/app/presentation/router/app_router.dart.
      Путь и initial: true правятся вручную; если хук не нашёл роутер или
      список routes, маршрут регистрируется вручную. Назовите путь, признак
      initial и кем добавлен маршрут.
    - >-
      Регистрация Assembly всегда вручную: Assembly фичи подключается к
      родительской через AssemblyProvider во Flow. Назовите, где именно.
    - >-
      Аналитика идёт через AnalyticAction и AnalyticStrategy из
      observability/analytics.
  tasks:
    - >-
      Команды только цели Makefile; flutter, dart, melos, mason и DCM напрямую
      не вызываются.
    - >-
      Кодогенерация: `make gen-scope scope="apps/main/lib/feature/<name>/**/*.dart"`
      для фичи или `make gen-app` для всего приложения. После любого брика
      (`make gen-bloc`, `make gen-repository`, `make gen-screen`,
      `make gen-assembly`) обязателен `make gen-app`: хуки бриков build_runner
      не запускают.
    - >-
      Брики создают каркас теста рядом с компонентом; задача, использующая
      брик, заполняет каркас одним тестом на Scenario.
    - >-
      Форматирование: `make format` только проверяет и завершается ненулевым
      кодом на неотформатированном коде; `make format-soft` переписывает файлы.
    - >-
      Анализ: `make analyze` — анализатор Dart плюс DCM, включая проверку
      границ слоёв.
    - >-
      Прогон тестов: `make run-tests` — единый прогон unit, bloc_test и golden
      всех пакетов, тот же, что на CI.
    - >-
      Перегенерация golden: `make reset-goldens` только при намеренном
      изменении вёрстки; перегенерирует снимки в apps/main и modules/ui;
      коммитятся только goldens/ci/, каждый изменённый goldens/ci/*.png
      объясняется в описании MR.
    - >-
      Хук pre-push (`.githooks/pre-push`, включается `make init-hooks` из
      `make init`) повторяет `make format` и `make analyze-dart` перед push
      (DCM при HOOK_DCM=1); это часть шаблона, отдельных задач на хук и
      форматирование не нужно.
    - >-
      Лимит MR около 400 строк без сгенерированного кода; группа задач,
      которая не помещается, дробится, а не укрупняется.
    - >-
      Новые снимки в goldens/ci/ утверждает дизайнер фичи до слияния MR.
```

Строки `rules` записаны как folded-скаляры `>-`: так внутри них допустимы
двоеточия и кавычки, а YAML остаётся валидным. `context` ограничен 50 КБ, а
`rules` принимают только список строк на
артефакт (`proposal`, `specs`, `design`, `tasks`); лишние ключи OpenSpec отбрасывает
с предупреждением. Что показывает CLI:

```bash
openspec instructions design --change <name>   # <project_context> и <rules> перед шаблоном
openspec validate <name> --strict              # форма Scenario и Purpose проверяются здесь
openspec archive <name> --yes                  # таблица покрытия в основную спецификацию не переносится
```

## Локальные отклонения

Если проекту нужен другой шаблон или другой текст инструкции, схема
копируется в проект и правится там:

```bash
openspec schema fork spec-driven
```

Копия в `openspec/schemas/spec-driven/` версионируется вместе с проектом и
имеет приоритет над упакованной. Порядок разрешения: проект
(`openspec/schemas/`) → пользователь (`~/.local/share/openspec/schemas/`) →
пакет. Чтобы держать оба варианта, дайте копии новое имя:
`openspec schema fork spec-driven my-spec-driven`.
