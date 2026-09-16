## Context

[Перед сохранением замените все подсказки в квадратных скобках и удалите
неприменимый текст. Опишите текущее состояние и ограничения, влияющие на
решение. Не повторяйте мотивацию из `proposal.md` и наблюдаемое поведение из
specs.]

## Goals / Non-Goals

**Goals:**

[Что должен обеспечить технический дизайн.]

**Non-Goals:**

[Что явно не входит в техническое решение.]

## Component Coverage

[Условный блок для Flutter-клиента на стандарте Surf: удалите, если change не
про Flutter-клиент. Одна строка на требование. Сопоставьте каждое требование
наименьшему владеющему компоненту закрытого словаря, слою, seam, который его
докажет, и имени теста — имени Scenario из спецификации дословно.

Компоненты: Presentation — Flow, ViewModel, View, Widget; Domain — Entity,
Bloc, Event, State, Action, IRepository, Failure; Data — Repository,
Converter, DataSource; сквозные — Assembly, Result, DTO, Storage, DAO. Каждый
класс change относится ровно к одному компоненту. Классов Helper, Service,
Manager, Handler и Utils, каталогов `common/` и `util/` на уровне фичи, use
case и interactor не существует; бизнес-логика живёт в Bloc, чистые правила —
в Entity и Converter.

Seams — ровно три плюс «not covered», по одному на компонент: Bloc →
bloc_test (мок IRepository, последовательность State на Event, Action через
поток действий); Repository → unit (мок DataSource, маппинг DTO → Entity в
`Result`, `Failure` при исключении); Converter, Entity, чистые правила →
табличный unit; View → golden с фейковым ViewModel, сценарий на каждый вариант
State; Widget → golden на каждый вариант и состояние; Flow, Assembly,
DataSource → not covered (склейка без логики и сгенерированный код).
End-to-end seam нет: журни доказывают Action у Bloc, golden у View и проверка
маршрута на устройстве в Definition of Done. Имя теста равно имени Scenario
(`<what happens> when <condition>`), имя golden-сценария — имени варианта
State. Путь к тесту, общие фейки и эталонные тесты берутся из `context` и
`rules` проекта.]

| Требование | Компонент | Слой | Seam | Имя теста |
|---|---|---|---|---|
| [имя или ID требования] | [например Bloc + State; Converter; View] | [presentation / domain / data / module] | [unit / bloc_test / golden / not covered] | [`<what happens> when <condition>`; для golden — имя варианта State] |

## Layer Boundaries And Registration

[Часть того же условного блока для Flutter-клиента. Границы слоёв — принцип
дизайна, каким бы линтером проект их ни проверял: domain не зависит от data,
presentation, datasource и ui; data не зависит от presentation и ui;
presentation не зависит от data и datasource; Repository не импортирует другие
Repository, Bloc — другие Bloc; DTO не покидают datasource; репозитории
возвращают `Result`; исключения не пересекают слои. Регистрация маршрута и
Assembly — обязательный факт дизайна; как именно они регистрируются в проекте
(генератором или вручную) — из `context` и `rules`.]

- **Регистрация маршрута:** [Flow → маршрут: путь, является ли начальным, кем добавляется]
- **Регистрация Assembly:** [Assembly фичи и где она подключается к родительской]
- **Пересекаемые границы модулей:** [какие модули затрагивает change]

### Backend contract: mini (клиент)

[Условный подблок: оставьте, только если клиент общается с бэкендом mini;
иначе удалите подблок и опишите фактический контракт API в Decisions. Опишите
только то, что затрагивает change.]

- **Сгенерированный контракт и DTO:** [контракт и версия API, к которой он привязан]
- **Ресурсы:** [CRUDL, `aggregate` и переходы FSM через клиент ресурсов]
- **CustomMethod:** [код операции, ключ идемпотентности и набор инвалидируемых ресурсов]
- **Realtime:** [SSE-событие → инвалидация Repository или кэша → refetch состояния активного экрана; REST-чтение остаётся источником истины]
- **Push:** [регистрация устройства для фоновой доставки]
- **HTTP-кэш и версия API:** [кэш по ETag и заголовок версии API]
- **Размещение:** [какой DataSource оборачивает каждый клиент mini; Bloc и View типов mini не видят]

## Decisions

[Опишите только существенные решения и применимые способы реализации на mini:

- Resource/registry;
- CRUDL или `aggregate`;
- чистые business rules и decision seams везде, где правило можно отделить от
  I/O и состояния: укажите точную форму — формула, инвариант, merge, selector,
  reducer, classifier или настоящая decision table — а также явные входы,
  выходы и границу unit-теста;
- `CustomMethod` и owning service;
- `task`/integration;
- FSM;
- SSE, invalidation и refetch.

Не составляйте общий каталог сущностей и registries: фиксируйте только то, что
нужно для реализации требований этого change. Для нетривиальных взаимодействий,
потоков, последовательностей и состояний используйте подходящую Mermaid-диаграмму
(`sequenceDiagram`, `flowchart` или `stateDiagram-v2`), когда она яснее текста.
Диаграмма не обязательна.]

## Risks / Trade-offs

[Известные риски и компромиссы.]
