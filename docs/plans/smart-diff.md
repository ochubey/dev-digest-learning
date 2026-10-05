# Smart Diff Development Plan

## 1. Цілі та вимоги

**Мета:** на вкладці PR "Files changed" згрупувати файли за роллю `core → tests → wiring → docs → boilerplate`. У заголовку групи показати лічильник **файлів із findings** (не кількість findings). На картці файла показати крапку без числа. Коментар із finding виводити під рядком `start_line`. Додати перемикач "Original order". **Групування не викликає LLM:** це детермінований класифікатор за шляхом файла.

**Входи:** `pr_files` (path, additions, deletions, patch) та findings останнього рев'ю.
**Не входи:** тіла diff для класифікації (лише path), будь-які виклики моделі.
**Артефакти:** `classifyFile(path)`, route `GET /pulls/:id/smart-diff`, розширення enum до 5 ролей, UI-групи в `DiffTab`, i18n-ключі, тести.

**Requirements mapping:**
- [ ] `classifyFile(path)`: чиста функція, патерни та порядок у `constants.ts`
- [ ] Порядок правил: boilerplate, tests, wiring, docs, core. Перший збіг виграє, default `core`
- [ ] Enum `SmartDiffRole` розширено до 5 ролей в обох `brief.ts`, файли байт-в-байт однакові
- [ ] Route `GET /pulls/:id/smart-diff` без виклику моделі, відповідь валідується `SmartDiff`
- [ ] Працює з нульовою кількістю рев'ю (`finding_lines: []`)
- [ ] Групи з заголовками, лічильник файлів із findings, крапка на картці, коментар під `start_line`
- [ ] Docs і boilerplate згорнуті за замовчуванням
- [ ] Перемикач "Original order" і **одна** кнопка Hide/Show comments: ховає й показує і коментарі GitHub, і коментарі знахідок (показано за замовчуванням, кнопка є, якщо є хоча б один коментар або знахідка)
- [ ] Жодних захардкоджених рядків (i18n)

---

## 2. Поточний стан (перевірено читанням коду)

- **Server:** `GET /pulls/:id` (`server/src/modules/pulls/routes.ts:246`) повертає `PrDetail` з `files: PrFile`. `GET /pulls/:id/reviews` (`server/src/modules/reviews/routes.ts:129` → `service.reviewsForPull`) повертає `ReviewRecord[]`, найновіші першими, з `findings: FindingRecord[]` (`review.repo.ts:58`). Route `/pulls/:id/smart-diff` відсутній.
- **Шаблон route-модуля:** `server/src/modules/intent/routes.ts`. Він використовує `withTypeProvider<ZodTypeProvider>`, `getContext(container, req)`, `IdParams`, вибірку PR з перевіркою `pr.workspaceId !== workspaceId` (403) і `NotFoundError`. Реєстрація відбувається в `server/src/modules/index.ts` (імпорти `reviews`, `intent`).
- **Контракти:** `SmartDiffRole = z.enum(['core','wiring','boilerplate'])`, `SmartDiffFile {path, pseudocode_summary?, additions, deletions, finding_lines: int[]}`, `SmartDiffGroup {role, files}`, `SmartDiff {groups, split_suggestion{too_big,total_lines,proposed_splits[]}}` у `server/src/vendor/shared/contracts/brief.ts` (~91–124) та в клієнтській копії (ідентичні). `review-api.ts` експортує `SmartDiffResponse = SmartDiff`.
- **Finding** (`contracts/findings.ts`): `severity: 'CRITICAL'|'WARNING'|'SUGGESTION'` (INFO у enum `Severity` немає, хоча є в `SEV`), `start_line`, `end_line`, `scope?: 'in'|'out'|'signal'`. `FindingRecord` додає `review_id`, `accepted_at`, `dismissed_at`. `ReviewRecord` має `agent_id`, `kind: 'summary'|'review'`, `created_at`.
- **Client:** `DiffTab` (`client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`) використовує `usePrComments`/`useCreatePrComment` і `showComments`, рендерить `<DiffViewer files commenting/>`. `DiffViewer` (`client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx`) мапить files у `FileCard`. `FileCard` має `AUTO_EXPAND_MAX_LINES=200` (`constants.ts`), `parsePatch` (`helpers.ts`) і `buildThreads`/`keysForLine`/`partitionThreads` (`comments.ts`, ключ `${side}:${line}`). `CodeLine` рендерить треди під рядком. `usePrReviews` і `useFindingAction` лежать у `client/src/lib/hooks/reviews.ts`. `FindingCard` у `.../_components/FindingCard/`, `SEV` у `client/src/vendor/ui/primitives/tokens.ts` (`{c,bg,icon,label}`).
- **i18n:** є лише `client/messages/en/` (інших локалей немає). `prReview.json → smartDiff` містить `coreLabel, wiringLabel, boilerplateLabel, largeTitle, largeBody, filesCount, findingLines, groupedByRole`.
- **Тести сервера:** лежать у `server/test/` (не поруч з кодом). Unit: `*.test.ts` (`reviews-helpers.test.ts`, `grounding.test.ts`, `contracts.test.ts`, `routes-smoke.test.ts`, `pulls-status.test.ts`). DB-інтеграційні: `*.it.test.ts` (`reviews.it.test.ts`, `pulls-comments.it.test.ts`). Клієнтські тести поруч з компонентом (`FindingCard.test.tsx` тощо).

---

## 3. Класифікатор

Розташування: `server/src/modules/reviews/smart-diff/classify.ts` (чиста функція, без IO) та `constants.ts` (патерни, порядок, порядок груп).

```ts
export function classifyFile(path: string): SmartDiffRole  // нормалізує '\\' → '/', lower-case для матчингу
```

`constants.ts` експортує `ROLE_RULES: ReadonlyArray<{ role; patterns: RegExp[] }>` у порядку оцінки та `GROUP_ORDER = ['core','tests','wiring','docs','boilerplate']`. **Увага:** порядок оцінки (boilerplate першим) відрізняється від порядку відображення. Це дві окремі константи.

### Порядок оцінки: перший збіг виграє, default `core`

1. **boilerplate**
   - лок-файли: `(^|/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum|Gemfile\.lock|composer\.lock)$`
   - міграції: `(^|/)(migrations?|drizzle)/` (включно з `meta/`)
   - згенероване: `(^|/)(generated|__generated__)/`, `\.generated\.[a-z]+$`, `\.min\.(js|css)$`, `\.map$`
   - снапшоти: `(^|/)__snapshots__/`, `\.snap$`
   - build-артефакти: `(^|/)(node_modules|dist|build|\.next|coverage)/`

   **Свідомо не входять у boilerplate** (рішення після рев'ю плану): `vendor/` (`server/src/vendor/shared/contracts/*` і `client/src/vendor/ui/*` це реальний API-контракт і UI-примітиви, їх зміни треба рев'юїти, тому вони йдуть у `core`), `*.d.ts` (ручні декларації типів), зображення та шрифти, голе `gen/`. Набір правил обмежений тим, що прямо випливає з завдання.
2. **tests**
   - `\.(test|spec)\.[cm]?[jt]sx?$` (покриває і `*.it.test.ts`)
   - `(^|/)(__tests__|tests?|e2e|__mocks__|fixtures)/`
   - `(^|/)(vitest|jest|playwright)\.config\.[a-z]+$`
3. **wiring**
   - маніфести: `(^|/)package\.json$`, `tsconfig(\..+)?\.json$`
   - конфіги: `\.config\.[cm]?[jt]s$`, `\.env(\..+)?\.example$`, `Dockerfile`, `docker-compose`, `\.ya?ml$`, `(^|/)\.github/`, `(^|/)scripts/`
   - barrel-файли та реєстрація модулів: `(^|/)index\.[jt]sx?$` (покриває і `modules/index.ts`)
   - агентні налаштування: `(^|/)\.claude/`
4. **docs**: `\.(md|mdx|rst|txt)$`, `(^|/)docs?/`, `(^|/)(LICENSE|CHANGELOG|CONTRIBUTING)`
5. **core**: решта (default).

### Спірні шляхи: правила застосовуються буквально

| Шлях | Роль | Обґрунтування і компроміс |
|---|---|---|
| `__tests__/__snapshots__/x.snap` | **boilerplate** | boilerplate оцінюється першим, а `__snapshots__/` і `.snap` є в його патернах. Це згенерований артефакт, який ревʼюер не читає построчково. Компроміс: у групу tests він не потрапляє, зате зміна снапшота не відволікає від тестів. |
| `.claude/skills/security/SKILL.md` | **wiring** | Boilerplate і tests не збігаються. Wiring збігається через `(^|/)\.claude/` і оцінюється **раніше** за docs (`.md`). Обґрунтування: SKILL.md є конфігурацією агента, яку споживає рантайм (CLAUDE.md називає її "skill system state"), а не прозою для людей. Компроміс: за природою схожий на документ. Якщо потрібно docs, достатньо прибрати `\.claude/` з wiring. |
| `e2e/README.md` | **tests** | Tests оцінюється раніше за docs, а `(^|/)e2e/` збігається. Компроміс: README за природою є docs, але e2e-каталог відносимо до тестової інфраструктури цілком. Альтернатива, яку відхилено: звузити tests до `e2e/specs/`. Це ускладнює патерн заради одного файла. |

Ці три випадки фіксуються тестом **до** реалізації (розділ 8).

---

## 4. Розширення контракту (S2)

Файли: `server/src/vendor/shared/contracts/brief.ts` та `client/src/vendor/shared/contracts/brief.ts`. CLAUDE.md позначає їх read-only, але ця задача явно оновлює контракт.

```ts
export const SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
```

- Змінюється тільки рядок enum. `SmartDiffFile`, `SmartDiffGroup`, `SmartDiff` не змінюються.
- Обидві копії правляться в одному коміті. Перевірка: `diff` між двома файлами порожній (додати до `contracts.test.ts` або до кроку верифікації).
- Зворотна сумісність: розширення enum безпечне. Grep-ом перевірити, що `Record<SmartDiffRole, …>` ніде не лишився неповним.

---

## 5. API (S3)

### GET /pulls/:id/smart-diff

Новий файл `server/src/modules/reviews/smart-diff/routes.ts` (default export `smartDiffRoutes`) реєструється в `server/src/modules/index.ts` поруч з `reviews` та `intent`.

**Алгоритм:**
1. `getContext` → `workspaceId`. Вибрати PR за `req.params.id`. Якщо PR немає, `NotFoundError`. Якщо `pr.workspaceId !== workspaceId`, `AppError('Forbidden', 403)` (як в intent).
2. Прочитати `pr_files` за `prId`.
3. Прочитати findings **останнього рев'ю** (визначення нижче) через існуючий `service.reviewsForPull` / `ReviewRepository`. Нових запитів до БД не потрібно.
4. Для кожного файла: `role = classifyFile(path)`, `finding_lines` = унікальні відсортовані `start_line` findings з `file === path`.
5. Згрупувати в `GROUP_ORDER`. Всередині групи сортувати за `path`.
6. `split_suggestion = { too_big: false, total_lines: Σ(additions + deletions), proposed_splits: [] }`.
7. Відповідь проходить через `response: { 200: SmartDiff }` (Zod-валідація Fastify).

**Рішення: що таке "останнє рев'ю".** Вибрано **найновіше рев'ю кожного агента** (`kind === 'review'`, групування за `agent_id`, береться найновіше за `created_at`), а потім обʼєднання їхніх findings. Альтернатива "найновіший рядок review загалом" відхилена: при мульти-агентному запуску вона показує findings лише одного агента. Недолік вибраного варіанту: дублікати між агентами (див. ризики), але лічильник рахує **файли**, а `finding_lines` дедуплікується за номером рядка. Додатково виключаються findings з `dismissed_at != null` та `scope === 'out'` (вони не видимі в UI, тому крапка не має на них спиратись). Нуль рев'ю дає `finding_lines: []` без помилки.

**Рішення: порожні групи.** **Пропускати.** Клієнту не потрібно фільтрувати, порядок задає `GROUP_ORDER`, контракт це дозволяє.

**Файли без patch** (бінарні, завеликі): входять у відповідь як є, `additions/deletions` з БД. UI показує картку без diff-тіла.

**Перейменовані файли:** класифікація за поточним `path`.

**Без моделі:** у модулі немає імпортів `llm`, `provider` чи `resolveFeatureModel`. Тест route працює з фейковим контейнером без LLM.

---

## 6. Client UI (S4, S5)

### S4: групи

Місце: `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/`.

- Новий хук `useSmartDiff(prId)` у `client/src/lib/hooks/` (TanStack Query, інвалідується разом з `usePrReviews`).
- `DiffTab` бере `files` з PR та `groups` зі smart-diff. Хелпер `groupFiles(files, smartDiff)` (`DiffTab/helpers.ts`) повертає `[{role, files, findingFiles}]`. Файли, яких немає у відповіді, потрапляють у `core`.
- Нові компоненти: `SmartDiffGroup` (заголовок і тіло групи), `SmartDiffToggle`.
- **Заголовок групи:** мітка з i18n (`smartDiff.<role>Label`), крапка та кількість файлів із findings (лише якщо > 0), далі `smartDiff.filesCount`. Приклад: `Core ● 2 · 5 files`. Множина через ICU plural (`{count, plural, one {# file} other {# files}}`), без зашитого тексту. Лічильник рахується на клієнті з **видимих** знахідок (`groupFiles(files, smartDiff, findingItems)`: файли, що мають хоча б одну видиму знахідку), а не з `finding_lines` відповіді сервера. Це прибирає два джерела правди. Порядок груп клієнт бере з відповіді сервера і не пересортовує. Над групами показується заголовок `smartDiff.filesChanged` (`Files changed · N files`, з тим самим plural).
- **Згортання:** групи не згортаються за замовчуванням (`defaultOpen=false` прибрано). Усередині групи картка файла відкривається за `AUTO_EXPAND_MAX_LINES` (`DiffTab/constants.ts`). Користувач може змінити вручну.
- **Збій групування:** якщо `GET /pulls/:id/smart-diff` дав помилку, `DiffTab` показує плоский список у початковому порядку й повідомлення `smartDiff.groupingUnavailable`. Перемикач "Original order" у цей час прихований.
- **"Original order":** перемикач у тулбарі `DiffTab`. Увімкнено означає плоский `DiffViewer files={files}` без груп (поточна поведінка). Стан локальний, за замовчуванням вимкнено.
- Повторно використовуються `DiffViewer` та `FileCard`: кожна група рендерить `<DiffViewer files={group.files} …/>`. **Нового парсера не додається**, лише `parsePatch`.

### S5: findings у diff

- **Крапка на картці файла:** `FileCard` не має окремого пропа `hasFindings`: крапку без числа він виводить сам із `findings.items` для свого файла (колір зі `SEV` для найвищої серйозності). Крапка й лічильники лишаються і тоді, коли коментарі приховано.
- **Коментар під `start_line`:** findings файла перетворюються на треди з ключем `RIGHT:${start_line}` через `keysForLine`/`buildThreads`/`partitionThreads`, і `CodeLine` рендерить їх під рядком так само, як звичайні коментарі.
- **`SmartFindingCard`** (спрощений): ліва кольорова смуга (`SEV[severity].c`), справа мітка, заголовок, `rationale`, кнопки Accept і Dismiss через `useFindingAction()`. Мапінг: `CRITICAL → blocker`, `WARNING → warning`, `SUGGESTION → suggestion`. Іконка та колір зі `SEV`. Повний `FindingCard` не чіпаємо.
- **Findings без збігу рядка** (рядок поза hunk): блок у кінці файла зі списком таких findings.
- **Перемикач коментарів:** **один** стан `showComments` і **одна** кнопка. Вона ховає й показує і коментарі GitHub, і коментарі знахідок; за замовчуванням показано для обох. Кнопка видима, якщо є хоча б один GitHub-коментар **або** хоча б одна знахідка. Число в підписі (`smartDiff.hideComments`/`showComments`, `Hide comments (N)`) = GitHub-коментарі + видимі знахідки; рахуються лише знахідки на файлах цього PR (знахідки на файлах поза PR не рендеряться, тому не завищують число і не показують кнопку). Окремого перемикача знахідок немає.
- **Узгодженість:** `usePrReviews(prId)` дає рев'ю, а клієнт застосовує **ту саму** функцію `latestFindingsPerAgent(reviews)` (latest per agent, без dismissed і `scope === 'out'`; `signal` лишається видимим, `scope = null` вважається `in`; предикати `isVisibleScope`/`isInScope` в одному місці), що й сервер. Вона лежить у `client/src/lib/` і тестується окремо, щоб крапка/лічильник (з `finding_lines`) не розходились з видимими коментарями.

---

## 7. i18n

Файл: `client/messages/en/prReview.json` (інших локалей немає). Нові ключі в `smartDiff`:

| Ключ | Значення |
|---|---|
| `testsLabel` | `Tests` |
| `docsLabel` | `Docs` |
| `originalOrder` | `Original order` |
| `hideComments` / `showComments` | `Hide comments ({count})` / `Show comments ({count})` (одна кнопка для коментарів GitHub і знахідок) |
| `filesChanged` | `Files changed · {count, plural, one {# file} other {# files}}` |
| `groupingUnavailable` | `Grouping by role is unavailable; showing files in the original order.` |
| `outOfScopeHidden` | `{count, plural, one {# out-of-scope finding hidden} other {# out-of-scope findings hidden}}` (пасивна підказка в Diff tab) |
| `filesWithFindings` | `{count, plural, one {# file} other {# files}} with findings` (aria-label/tooltip) |
| `fileHasFindings` | `Has findings` (tooltip крапки) |
| `severity.blocker` / `severity.warning` / `severity.suggestion` | `blocker` / `warning` / `suggestion` |
| `accept` / `dismiss` | `Accept` / `Dismiss` (спершу перевірити наявні ключі, щоб не дублювати) |
| `unmatchedFindings` | `Findings outside the diff` |

Наявні `coreLabel`, `wiringLabel`, `boilerplateLabel` лишаються, `filesCount` тепер ICU plural. Порядок груп в UI задає сервер (`GROUP_ORDER` на сервері); копії порядку на клієнті немає.

---

## 8. Тести (спершу тести, потім реалізація)

**Сервер (`server/test/`, vitest):**
- `smart-diff-classify.test.ts`: табличний тест `classifyFile`, **пишемо першим**. Три лок-файли → boilerplate, міграції, `.snap`, `dist/`, `*.test.ts`, `__tests__/x.ts`, `server/src/vendor/shared/contracts/brief.ts` → core, `package.json`, `index.ts`, `README.md`, `docs/a.md`, `src/foo.ts` → core, та **три спірні випадки**: `__tests__/__snapshots__/x.snap` → boilerplate, `.claude/skills/security/SKILL.md` → wiring, `e2e/README.md` → tests. Додатково: Windows-роздільники та регістр.
- `smart-diff-route.test.ts` (unit, фейковий контейнер за зразком `routes-smoke.test.ts`/`pulls-status.test.ts`): порядок груп, пропуск порожніх, `finding_lines` відсортовані й унікальні, нуль рев'ю, `split_suggestion.total_lines`, 404 для відсутнього PR.
- `smart-diff.it.test.ts` (DB, за зразком `reviews.it.test.ts`): реальні `pr_files` та рев'ю різних агентів, новіше рев'ю агента перекриває старіше, dismissed виключено, чужий workspace → 403.
- `contracts.test.ts`: `SmartDiffRole` приймає 5 значень, відхиляє невідоме.

**Клієнт (vitest, поруч з компонентами):**
- `DiffTab/helpers.test.ts`: `groupFiles` (порядок, fallback у `core`, лічильник файлів із findings).
- `client/src/lib/latest-findings.test.ts`: відповідність серверному правилу видимості.
- `DiffTab/DiffTab.test.tsx` і `DiffTab.findings.test.tsx` (окремого `SmartDiffGroup.test.tsx` немає): п'ять груп разом у правильному порядку з підписами та plural, лічильник рахує файли, а не findings, toggle "Original order" прибирає групи, fallback `groupingUnavailable`, одна кнопка Hide/Show comments (умови видимості, число, приховування обох типів).
- `SmartFindingCard.test.tsx`: мапінг CRITICAL→blocker тощо, Accept/Dismiss викликають `useFindingAction`.
- `FileCard` тест: крапка без числа; коментар під рядком `start_line`; unmatched-блок у кінці.

**Верифікація:** `pnpm typecheck` та `pnpm exec vitest run --exclude '**/*.it.test.ts'` у `server/` і `client/`, `.it.test` окремо (Docker). Lint-кроків не додавати (за CLAUDE.md).

**Базова лінія (HEAD перед S2, до змін Smart Diff).** Ці падіння вже були, вони не з Smart Diff. «Перевірки пройшли» означає: нових падінь нема.
- `server` typecheck: 12 помилок у файлах Intent Layer: `intent/ref-resolver.ts` (1), `intent/repository.ts` (3), `intent/routes.ts` (3), `reviews/repository/pull.repo.ts` (2), `reviews/run-executor.ts` (3). Жодної в файлах Smart Diff.
- `client` typecheck: 2 помилки, `IntentBlock.tsx:156` і `pulls/[number]/page.tsx:137`.
- `server` unit: 1 тест `Intent` у `contracts.test.ts` (стара фікстура) і 6 тестів `indexer-pipeline.test.ts` (Windows-шляхи, ENOENT).
- `client` тести: усі зелені (35).

---

## 9. Послідовність комітів

Усі повідомлення за Conventional Commits.

1. **S2:** `feat(smart-diff): file role classifier and contract` (тест класифікатора першим, потім `constants.ts` + `classify.ts`, потім enum в обох `brief.ts`).
2. **S3:** `feat(smart-diff): GET /pulls/:id/smart-diff route` (route, реєстрація в `modules/index.ts`, unit та integration тести).
3. **S4:** `feat(smart-diff): role groups and original order toggle` (`useSmartDiff`, групи в `DiffTab`, i18n, helpers, тести).
4. **S5:** `feat(smart-diff): findings counters, indicators and inline comments` (`SmartFindingCard`, dot, unmatched-блок, hide toggle, тести).

---

## 10. Ризики та пом'якшення

| Ризик | Пом'якшення |
|---|---|
| **INFO-серйозності немає** в enum `Severity` | Мапінг покриває три значення. Для невідомого значення (захист на майбутнє) fallback на `suggestion`, без падіння. |
| **Застарілі findings** (рев'ю для старішого head SHA) | `ReviewRecord` не має `head_sha`. Findings з рядками поза hunk потрапляють у блок "unmatched". Майбутнє покращення: банер stale, як в intent. Поза скоупом. |
| **Файли без patch** | Картка без diff-тіла, findings йдуть в unmatched-блок, `finding_lines` враховуються в лічильнику. |
| **Дублікати findings від кількох агентів** | `finding_lines` дедуплікується за рядком, лічильник рахує файли. Кілька коментарів під одним рядком допустимі. Дедуплікація за змістом не робиться. |
| **Перейменовані файли** | Класифікація за поточним `path`. Findings привʼязані до `file` рев'ю, тому після перейменування можливий промах (unmatched). Прийнятно. |
| **Розбіжність серверного та клієнтського вибору findings** | Одне правило задокументоване в обох місцях і покрите тестами. |
| **Хибна класифікація евристик** (напр. `index.ts` з логікою → wiring) | Патерни в одному `constants.ts`, тест-таблиця. Користувач завжди може ввімкнути "Original order". |
| **Редагування vendored-контракту** | Явно дозволено задачею. Обидві копії в одному коміті, перевірка `diff` на ідентичність. |

---

## 11. Ключові файли

- Новий код: `server/src/modules/reviews/smart-diff/{classify.ts,constants.ts,routes.ts}`
- Змінити: `server/src/modules/index.ts`, `server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts`
- Клієнт: `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`, `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx`, `FileCard` (`helpers.ts`, `comments.ts`, `constants.ts`), `client/src/lib/hooks/reviews.ts`, `client/messages/en/prReview.json`
- Тести: `server/test/smart-diff-*.test.ts`, `server/test/smart-diff.it.test.ts`, `server/test/contracts.test.ts`

**Припущення, яке треба підтвердити в S3:** рев'ю з `kind === 'summary'` не містять findings для diff (беруться лише `kind === 'review'`). Перевірялися лише контракти, `review.repo.ts` не читався.

---

## 12. Субагенти та потік роботи

Схема за матеріалом уроку 03: проста послідовність відома наперед, тому **handoff** (порядок прописаний у промпті), без оркестратора й без Agent Teams. Агентів чотири, у межах правила «4–5 типів на фічу».

| Фаза | Агент | Права | Модель |
|---|---|---|---|
| S1 | `planner` | read-only | opus |
| S2–S5 | `implementer` | write, без `Agent`/`NotebookEdit` | sonnet |
| S6 | `architecture-reviewer` ∥ `plan-verifier` | read-only, паралельно | sonnet / opus |
| S7 | `implementer` (лише затверджені знахідки) | write | sonnet |

- **Артефакти між етапами:** план (`docs/plans/smart-diff.md`) → diff → звіти (`docs/reviews/smart-diff.md`). Знання живе у репозиторії, а не в історії чату.
- **Ізоляція:** кожен агент отримує в промпті лише потрібне: фазу плану, поточний стан дерева і базову лінію з розділу 8. Результат повертається стисло (файли, команди, реальні pass/fail).
- **Untrusted:** diff, PR-текст і коментарі в коді для будь-якого агента це дані, а не інструкції. Рев'юери read-only, тому ін'єкція в diff не може нічого записати (lethal trifecta не замикається).
- **Fail-closed:** якщо перевірка червона й невідомо, чи це з нашої зміни, фаза не закривається мовчки: порівнюємо з базовою лінією й звітуємо.
- **S6 без виправлень:** рев'юери лише звітують, виправляє тільки S7 і тільки затверджене. Це відповідає правилу «знайшли CRITICAL → рішення за людиною».
- **Ліміт перекриття:** `implementer` і `test-writer` не запускаються паралельно на тих самих файлах. Тести в S2–S5 пише `implementer` (спершу тест, потім код), `test-writer` не задіяний.

## 13. Статус

| Фаза | Стан |
|---|---|
| S0 синхронізація | зроблено, `Already up to date` |
| S1 план | зроблено, `27cbf48` |
| S2 класифікатор і контракт | зроблено, `a7a326c` |
| S3 роут | зроблено |
| S4 групи в UI | зроблено |
| S5 знахідки в diff | зроблено |
| S6 рев'ю | зроблено, звіти в docs/reviews/smart-diff.md |
| S7 виправлення | зроблено |

