# Smart Diff: незалежне рев'ю

Область: коміти Smart Diff після `8ab2184` (S2–S5), план `docs/plans/smart-diff.md`. Intent Layer поза областю.
Рев'юери: `architecture-reviewer` і `plan-verifier` (кастомні read-only агенти, запущені паралельно). Знахідки **не виправлялись**.
Агенти лише читали файли, тести й git не запускали. Що вони не могли перевірити, я перевірив окремо (розділ 3).

Нумерація: A1–A9 з архітектурного рев'ю, D1–D6 з відхилень від плану, P1.x і P2.x з матриці. Ключ P1/P2 призначив `plan-verifier` сам (тексту ДЗ він не бачив): P1 це поведінка функції, P2 це другорядне.

---

## 1. architecture-reviewer

Висновок: CRITICAL немає. 5 WARNING, 4 SUGGESTION.

### A1. WARNING. Route ходить у `container.db` напряму, хоча в модуля є repository/service
- Докази: `server/src/modules/reviews/smart-diff/routes.ts:26-31` (`container.db.select().from(t.pullRequests)`, імпорти `t` і `eq` у route-файлі), поруч `container.reviewRepo` (рядок 33). Решта модуля працює як route → `ReviewService` → `ReviewRepository` (`service.ts:160-174`).
- Чому важливо: route змішує транспорт, доступ до БД і перевірку workspace. Перевірку 403 продубльовано, тести route не можна підміняти на рівні repo.
- Пом'якшення: так само роблять `intent/routes.ts` і `pulls/routes.ts`, тож це прецедент Intent Layer. Але для `reviews` це порушення власного шаблону. `ReviewRepository.getPull` workspace-scoped і дав би 404 замість 403 для чужого PR.
- Напрям: `SmartDiffService` (або метод у `ReviewService`), route лишається тонким.

### A2. WARNING. Правило «видимі findings» продубльоване між сервером і клієнтом
- Сервер: `build.ts:29-40` (`latestFindingsPerAgent`) і `build.ts:53` (фільтр dismissed / `scope==='out'`). Клієнт: `client/src/lib/latest-findings.ts:12-26`, коментар «Keep them sync» (рядки 7-9).
- Спільного коду чи міжпакетного тесту нема. Розбіжність уже є: сервер порівнює `Date.getTime()` з БД, клієнт `Date.parse(created_at)` зі стрічки DTO. При рівних timestamp переможець залежить від порядку ітерації.
- Чому важливо: зміна правила (врахувати `signal`, інший ключ агента) тихо розведе лічильники й картки.
- Напрям: віддавати з сервера список finding id у відповіді smart-diff, або винести правило в `@devdigest/shared`, або contract-тест на однакових фікстурах.
- Примітка основного агента: у `client/src/lib/latest-findings.test.ts` є блок «parity with server smart-diff rule» на дзеркальних фікстурах. Він є, але не гарантує збігу з серверним кодом, бо імпортувати сервер не може.

### A3. WARNING. Лічильники й крапки беруть дані з двох джерел
- Сервер: `finding_lines` через `useSmartDiff` → `findingFiles` (`DiffTab/helpers.ts:32`) → крапка групи (`SmartDiffGroup.tsx:38-49`). Клієнт: `usePrReviews` → `latestFindingsPerAgent` (`DiffTab.tsx:36-37`) → крапка файла (`FileCard.tsx:92,111`) і inline-картки.
- Між двома запитами є вікно розсинхрону. Для smart-diff є fallback на плаский список (`DiffTab.tsx:43`), для reviews fallback нема.
- Файли, дописані в core як «missing» (`helpers.ts:37-41`), не мають `findingFiles`, хоча на клієнті для них може бути крапка.
- `finding_lines` на клієнті використовується лише як булевий прапорець (`length > 0`), самі номери ніхто не читає.
- Крапка групи горить і для findings із блоку «outside the diff».
- Напрям: одне джерело для обох індикаторів (рахувати лічильники на клієнті з тих самих findings або віддавати з сервера повні findings).

### A4. WARNING. `GROUP_ORDER` продубльований, порядок «нейтральний» у клієнта
- Сервер `constants.ts:75-81`, клієнт `DiffTab/constants.ts:4-10`, той самий масив. Сервер вже віддає групи в порядку, клієнт пересортовує (`helpers.ts:12-14,24`).
- Нова роль у `SmartDiffRole` без оновлення клієнтського масиву: `indexOf` дає -1, роль піде на початок. Типи вичерпності не вимагають.
- i18n-ключ складається динамічно (`smartDiff.${role}Label`, `SmartDiffGroup.tsx:25-26`): відсутній переклад не ловиться компіляцією.
- Напрям: покладатися на порядок із відповіді сервера (прибрати клієнтський `sortGroupsByRole`) або винести порядок у shared з `satisfies Record<SmartDiffRole, …>`.

### A5. WARNING. Спільний `diff-viewer` залежить від прикладного контракту; перехресний імпорт між `_components`
- `findings.ts` і `SmartFindingCard/*` імпортують `FindingRecord` і `useFindingAction` з `@/lib/hooks/reviews` (`SmartFindingCard.tsx:10`) і чіпляють namespace `prReview` (`FindingsParts.tsx:1-2,14,35`). Спільний компонент сам викликає мутації та прив'язаний до сторінки PR. Прямих імпортів з `app/` у `diff-viewer` нема.
- `SmartDiffGroup.tsx:10` імпортує `COLLAPSED_BY_DEFAULT` із `../DiffTab/constants` (порушує колокацію).
- `FileCard.tsx:22` статично імпортує компоненти, які тягнуть `prReview`.
- Напрям: передавати `onAction`/render-prop (як `DiffCommentApi`), тримати хук і i18n на боці сторінки; константи групи в `SmartDiffGroup/constants.ts`.

### A6. SUGGESTION. Когезія `build.ts`
- `latestFindingsPerAgent` і три `*Input` типи (`build.ts:5-40`) не стосуються групування файлів. Типи вручну дублюють форму `pr_files`/`findings`, зміна колонки розійдеться тихо.
- Напрям: винести вибір findings окремо, типи виводити зі схеми (`$inferSelect` + `Pick`).

### A7. SUGGESTION. Помилка smart-diff не сигналізується, контракт обіцяє більше за реалізацію
- `DiffTab.tsx:43-47`: при помилці просто плаский список, користувач не знає чому.
- `SmartDiff` містить `pseudocode_summary` і `split_suggestion`, сервер завжди віддає `too_big:false, proposed_splits:[]` (`build.ts:80-83`). i18n-ключі `largeTitle`, `largeBody`, `findingLines`, `groupedByRole` не використовуються. Споживач може прийняти заглушку за справжній висновок.
- Напрям: позначити заглушку в контракті або прибрати невикористане.

### A8. SUGGESTION. i18n: лише `en`, динамічні ключі, частина рядків без перекладу
- Динамічні ключі не типізовані (`SmartDiffGroup.tsx:26`, `SmartFindingCard.tsx:41`).
- Захардкоджені рядки: `DiffTab.tsx:60,95,101`, `CodeLine.tsx:56-57`. **Підтверджено основним агентом: усі вони були вже в `8ab2184`, до Smart Diff.**
- Напрям: типізувати ключі (map роль → ключ), перенести рядки в `prReview`/`shell`.

### A9. SUGGESTION. Крихкість деталей
- `agentId ?? ''` як ключ групи: кілька рев'ю без агента схлопнуться в одне (однаково на обох боках, це дефект правила, а не розсинхрон).
- `FileCard.tsx:30-39` і `:42-50` майже ідентичні (`threadsForLine` / `findingsAt`), дубль ~10 рядків.
- На сервері `finding_lines` дедуплікується за рядком, на клієнті кілька findings на один рядок рендеряться всі (для булевого прапорця нормально).

### Перевірено, проблем немає
Реєстрація плагіна в `modules/index.ts`; напрям залежностей `classify → constants → типи shared`, `build` без IO, у `smart-diff/*` циклів нема; route використовує `getContext`, `IdParams`, `AppError`/`NotFoundError` і валідує відповідь `SmartDiff`; доступ до даних через `container.reviewRepo`; `classifyFile` чиста (`\`, регістр, перший збіг, default `core`); правила й порядок показу розділені; `useSmartDiff` через `api.get`; ключ запиту під префіксом `["reviews", prId]`; структура папок і barrel за конвенціями; `findings.ts` використовує `lineKey` з `comments.ts`; `showComments` і `showFindings` розділені; `reviewer-core` не зачеплено.

---

## 2. plan-verifier

Висновок: MISSING немає. PASS майже скрізь. PARTIAL: P1.14, P2.4, P2.5 (+ R8.7). Шість відхилень від плану.

### Критерії ДЗ

| ID | Вимога | Статус | Доказ | Чого бракує |
|---|---|---|---|---|
| P1.1 | Порядок core → tests → wiring → docs → boilerplate, мітки з i18n | PASS | `constants.ts:75-81`, `build.ts:74-78`, `DiffTab/constants.ts:4-10`, `helpers.ts:12-14,24`, `SmartDiffGroup.tsx:37`, `prReview.json:54-58`; тести `smart-diff-classify.test.ts:76-80`, `smart-diff-build.test.ts:23-35`, `helpers.test.ts:17-27,51-60`, `DiffTab.test.tsx:65-81` | — |
| P1.2 | Lock-файл у boilerplate | PASS | `constants.ts:18`, boilerplate першим (`:14-15`); тест `smart-diff-classify.test.ts:13-16` | — |
| P1.3 | docs і boilerplate згорнуті, решта за `AUTO_EXPAND_MAX_LINES` | PASS (D1) | `DiffTab/constants.ts:13-16`, `SmartDiffGroup.tsx:24-25,52-58`, `FileCard.tsx:66-68`; тест `DiffTab.test.tsx:83-95` | D1 нижче |
| P1.4 | Лічильник групи рахує файли, перед «N files» | PASS | `helpers.ts:26,32`, `SmartDiffGroup.tsx:38-50`; тести `helpers.test.ts:92-98`, `DiffTab.findings.test.tsx:92-112` (3 findings в одному файлі дають 1) | — |
| P1.5 | Крапка без числа на картці, окремо від лічильника GitHub | PASS (D2) | `FindingsParts.tsx:13-25`, `FileCard.tsx:111`, окремий `file-comment-count` (`:112-120`); тести `FileCard.test.tsx:71-102` | D2 нижче |
| P1.6 | Коментар під `start_line`, `RIGHT:${start_line}`, `keysForLine` | PASS | `findings.ts:56-73`, `FileCard.tsx:42-50,86-91,134`, `CodeLine.tsx:80-82`; тест `FileCard.test.tsx:106-116` | `buildThreads`/`partitionThreads` для findings не використано, зроблено аналог `partitionFindings` з тим самим форматом ключа |
| P1.7 | Findings поза patch окремим блоком у кінці файла | PASS | `FindingsParts.tsx:28-45`, `FileCard.tsx:140-142`; тести `FileCard.test.tsx:118-134` | — |
| P1.8 | Original order повертає порядок GitHub | PASS | `SmartDiffToggle.tsx:12-25`, `DiffTab.tsx:33,72-77,103-118`; тести `DiffTab.test.tsx:97-104`, `DiffTab.findings.test.tsx:122-130` | — |
| P1.9 | Групування не викликає модель | PASS | імпорти `classify.ts`, `constants.ts`, `build.ts`, `routes.ts` (лише shared, fastify, zod-provider, drizzle `eq`, schema, context, errors, build); grep `llm|provider|resolveFeatureModel|anthropic|openai` знайшов лише `ZodTypeProvider`; тест route без LLM | — |
| P1.10 | Route працює до першого рев'ю | PASS | `review.repo.ts:67`, `build.ts:39,69`; тести `smart-diff-route.test.ts:105-123`, `smart-diff.it.test.ts:93-105` | — |
| P1.11 | Відповідь валідується `SmartDiff` | PASS | `routes.ts:22`, `withTypeProvider<ZodTypeProvider>`; тести парсять результат | серіалізатор Fastify без запуску не перевірений (див. розділ 3) |
| P1.12 | Спірні шляхи мають ролі з плану і тест | PASS | `constants.ts:27-28,58,37`; тест `smart-diff-classify.test.ts:54-56` | перший шлях у тесті `server/src/__tests__/__snapshots__/x.snap`, голий `__tests__/__snapshots__/x.snap` окремим рядком не перевірено (`(^|/)` покриває обидва) |
| P1.13 | Enum з 5 ролей | PASS | `brief.ts:92` в обох копіях; тест `contracts.test.ts:121-126` | — |
| P1.14 | Два `brief.ts` ідентичні | PARTIAL → **PASS після перевірки** (розділ 3) | вміст збігається | автоматичного тесту нема |
| P2.1 | Перемикач findings-коментарів | PASS | `DiffTab.tsx:39-40,78-87`, `FileCard.tsx:93,134,140`; тест `DiffTab.findings.test.tsx:138-159` | — |
| P2.2 | Мапінг CRITICAL→blocker, WARNING→warning, SUGGESTION→suggestion; SEV | PASS (D3) | `findings.ts:21-30`, `SmartFindingCard.tsx:22-23,33,36,40-41`; тест `SmartFindingCard.test.tsx:51-63` | D3 |
| P2.3 | Accept/Dismiss через `useFindingAction` | PASS | `SmartFindingCard.tsx:10,21,26-27,48-67`, `reviews.ts:139-160`; тест `SmartFindingCard.test.tsx:65-78` | — |
| P2.4 | Нових захардкоджених рядків нема | PARTIAL | `t(...)` у нових компонентах | `SmartDiffGroup.tsx:50` роздільник `· ` поза i18n (дрібниця). Рядки в `DiffTab`/`CodeLine` **були до Smart Diff** (розділ 3) |
| P2.5 | Спершу тести, потім код | PARTIAL | тести є для кожного кроку | порядок не перевірити без git; тести й код в одних комітах (розділ 3) |

### Решта вимог плану
Усі PASS, окрім: R4.1 (змінено лише рядок enum), R6.5 (`FindingCard` не змінено), R8.10 (typecheck і vitest) були не перевірювані читанням і закриті в розділі 3. R8.7: окремого `SmartDiffGroup.test.tsx` нема, сценарії покриті в `DiffTab.test.tsx` і `DiffTab.findings.test.tsx` (PARTIAL за формою). R8.6: файл названо `latest-findings.test.ts`.

### Відхилення від плану
- **D1.** Після ручного розгортання docs/boilerplate картки файлів закриті (`SmartDiffGroup.tsx:57`, `defaultOpen=false`), а в плані §6 відкривалися за `AUTO_EXPAND_MAX_LINES`. Тест закріплює нову поведінку (`DiffTab.test.tsx:93-94`). Згорнута група демонтує `DiffViewer` (`:52`), тому стан відкритих карток після повторного згортання губиться.
- **D2 (найважливіше).** У `FileCard` нема пропа `hasFindings?: boolean`. Крапка файла обчислюється з клієнтських findings (`FileCard.tsx:82-92,111`), лічильник групи з серверного `finding_lines` (`helpers.ts:32`). Два джерела (те саме, що A3).
- **D3.** Для `INFO` мітка падає на «suggestion», але колір і іконка беруться з `SEV.INFO`. Ризик у §10 описував повний fallback на suggestion.
- **D4.** Чиста логіка в окремому `build.ts` з тестом `smart-diff-build.test.ts`; у плані §11 цього файла нема.
- **D5.** Клієнт дублює `GROUP_ORDER` і пересортовує; fallback на плаский список при завантаженні/помилці; Original order видимий лише коли групи доступні. Цього в плані не було.
- **D6.** Назви тестів інші; колір крапки в заголовку групи фіксований (`var(--warn)`, `SmartDiffGroup/styles.ts:30`), не зі `SEV`.

---

## 3. Перевірки основного агента (те, що рев'юери не могли)

| Пункт | Результат |
|---|---|
| P1.14 байтова ідентичність двох `brief.ts` | `cmp` → **byte-identical**. Автоматичного тесту «diff порожній» нема (план §4 його пропонував) |
| R4.1 що змінилось у контракті | `git diff 8ab2184..HEAD` по `brief.ts`: **один рядок**, enum `SmartDiffRole` |
| R6.5 повний `FindingCard` | `git diff --stat` по теці `FindingCard` порожній: **не змінений** |
| P2.4 захардкоджені рядки | «Hide comments», «Files changed» в `DiffTab.tsx` і «Add a comment on this line» у `CodeLine.tsx` **є вже в `8ab2184`**, не з Smart Diff. Нове лише `· ` в `SmartDiffGroup.tsx:50` |
| P1.11 серіалізатор Fastify | `app.ts:65` `setSerializerCompiler(serializerCompiler)` і `:64` validator: схема відповіді справді застосовується. Запуском поведінку на невалідній відповіді не перевіряв |
| P2.5 порядок «спершу тести» | Після S2 тести й код у одному коміті на фазу. Для S4 і S5 `implementer` показав падаючий запуск у звіті. Для S3 він сам визнав, що запустив тести лише з готовою реалізацією. Для S2 падаючий запуск був мій (модуль відсутній) |
| R8.10 typecheck і тести | Client: 2 помилки з бази, 20 файлів / 80 тестів зелені. Server unit: 154 зелені / 7 з бази, `.it` 3/3 зелені (звіти S3, S4, S5 і мої перевірки). На HEAD після S5 серверний набір повторно не запускався |
| Додатково | Нових Smart Diff тестів на `Cargo.lock` нема (лише pnpm/npm/yarn). Правило є в `constants.ts:18` |

---

## 4. Зведення для рішення

Усі знахідки лише зафіксовані, жодна не виправлена. Рекомендації нижче це пропозиція, не рішення.

| Група | Знахідки | Суть |
|---|---|---|
| Два джерела істини | A2, A3, D2 | правило видимих findings дублюється, лічильник і крапка з різних запитів |
| Дублювання порядку | A4, D5 | `GROUP_ORDER` і динамічні i18n-ключі без перевірки типами |
| Шари | A1, A5, A6 | route напряму в БД, спільний viewer тягне хуки, перехресний імпорт констант |
| Поведінка | D1, D3, A7 | картки в розгорнутій групі закриті, `INFO` з розбіжним fallback, мовчазна помилка smart-diff |
| Тести | P1.14, R8.7, `Cargo.lock` | немає автотесту ідентичності `brief.ts`, немає `SmartDiffGroup.test.tsx` |
| Дрібне | A8, A9, P2.4 | `· ` поза i18n, дубль 10 рядків у `FileCard`, ключ `agentId ?? ''` |
