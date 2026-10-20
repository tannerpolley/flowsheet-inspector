# Design: Flowsheet Inspector in the browser, with a live process explorer

Status: design, no implementation yet. Owner decisions recorded 2026-10-20.
Plan of record for the `feature/standalone-process-explorer` branches in
`tannerpolley/flowsheet-inspector` (this file) and `tannerpolley/flowsheet-inspector-lib`.
Case study: the owner's lithium solvent-extraction flowsheets
(`tannerpolley/Lithium_Extraction`).

## 1. Goal

Turn Flowsheet Inspector from a VS Code-only viewer into a tool that also runs in a
plain browser against a live IDAES model. It should do what the Lithium
`apps/process_explorer_web` app does by hand, but driven by the model, for any IDAES flowsheet:

1. a process flow diagram drawn from the model, with real port names and unit icons;
2. stream and unit result tables;
3. editable declared inputs with live re-solve;
4. costing display;
5. named scenarios with comparison and export.

The lithium flowsheets then become two thin case studies, extraction only and full
process, instead of a hand-coded app.

Out of scope here: parameter sweeps (the flowsheet-processor UI and
`parameter-sweep` own that), drawing flowsheets from scratch (Ahuora's model), and
changes to the legacy `IDAES/idaes-ui` `fs.visualize()` app.

## 2. Owner decisions (2026-10-20)

| Decision | Choice |
|---|---|
| Where the work lands | `prommis/flowsheet-inspector` and `prommis/flowsheet-inspector-lib`, not `IDAES/idaes-ui` |
| Lib fork | Yes. Data-side features go to the lib, UI to the inspector, and icon and port-name graph work to `idaes-connectivity` |
| App shape | One React UI, two hosts: the existing VS Code webview, plus a browser host served by a `127.0.0.1` Python server in the lib |
| Live solve | In-process: a long-lived Python process holds the built model; edits to declared inputs re-run steps from a declared step, with no rebuild and with rollback on failure |
| Diagram | Add an interactive process-flow view (React Flow + ELK layout, ports, icons, saved positions); keep Mermaid as the simple view |
| Licence | LBNL "Enhancements" clause accepted: LBNL may take any of this work |
| Upstream posting | None for now. All work stays on the tannerpolley forks; no upstream issues or pull requests until the owner says otherwise |

## 3. Why here and not `IDAES/idaes-ui`

Evidence gathered 2026-10-20:

- `IDAES/idaes-ui` has had no commits since 2025-10-02 (0.25.11.dev0).
  - Dan Gunter closed idaes-ui#61 on 2026-05-20 with "This won't be fixed in existing visualizer".
  - On the same day, idaes-pse #1738, #1741, #1755, #1761, #1763 and #1771 were closed as moved to `prommis/flowsheet-inspector-lib`.
  - Open idaes-pse #1833 turns idaes-pse's `structfs` into a mock backed by the lib.
- Its diagram runs on a vendored copy of Rappid 3.2 (commercial JointJS+) and ag-grid 27, loaded by script tags. `npm audit` reports 12 production advisories. Extending it would mean building on code its maintainers have set aside.
- Checked on Python 3.13.14 / idaes-pse 2.13.0 / Pyomo 6.10.1:
  - It installs and its diagram and stream table work.
  - Two diagnostics tests fail (`_vars_with_extreme_values` moved in idaes-pse), and `/diagnostics` drops the connection on unsolved models.
  - On the lithium full-process model it draws no connections: all 16 Arcs sit on sub-blocks, and it only reads top-level arcs.
- Flowsheet Inspector is the active IDAES/PrOMMiS front end: 293 commits since 2026-04-07, last push 2026-10-15. The owner's advisors are in PrOMMiS.

## 4. What exists today

| Feature | idaes-ui | Inspector + lib | idaes-connectivity | Lithium app |
|---|---|---|---|---|
| Diagram from a Python model | yes, top-level arcs only | Mermaid (via connectivity), descends into blocks | yes (Mermaid/D2/CSV) | hand-drawn SVG, not from the model |
| Port names on links | no ("in"/"out" groups) | no | no (arc parents only) | hand-placed |
| Custom unit icons | fixed 27-entry JSON | off (`_images = False  # TODO`), inspector #13 | fixed 14-name tuple | hand-drawn |
| Stream table | yes | yes (Arcs, `descend_into=True`) | no | none |
| Unit performance table | yes | yes (`model_reports`) | no | none |
| Declared inputs | no | `annotate_var(is_input=...)` stored, never emitted | no | hard-wired controls |
| Live re-solve | no | full subprocess re-run (`fi-run`) | no | 290 s subprocess per campaign case |
| Scenarios and comparison | no | history of past runs | no | solvent × brine matrix over stored records |
| Costing display | no | `add_costing` step, no panel | no | JS sums over stored masses |
| Runs outside VS Code | browser | no (README: needs extension host) | Jupyter | browser |

Prior art outside IDAES:

- **flowsheet-processor UI** (prommis): declared inputs and outputs (`export_to_ui`), solve, sweeps, saved-run tables. Its diagram is a static PNG, it has no stream table, and each flowsheet needs a hand-written export module (UKy: 534 lines).
- **Ahuora** (Waikato): JSON-defined, drawn flowsheets over a fixed list of 48 unit types, hosted. It cannot import a Python flowsheet with custom units such as PrOMMiS `SolventExtraction`. Its builder has no licence.

**The gap.** No tool combines a model-drawn process diagram, declared editable inputs, in-process re-solve and scenario comparison on an existing Python IDAES flowsheet with custom units. This design fills that gap by reusing IDAES's own declaration surface (`FlowsheetRunner` steps plus `annotate_var`) rather than inventing one.

## 5. Architecture

```
            Python process (one per flowsheet), lib: `fi-serve`
 flowsheet.py ──► FlowsheetRunner (steps, annotate_var) ── model in memory
                        │ actions: stream_table, model_reports, mermaid,
                        │          + flowsheet_graph, inputs, costing, scenarios (new)
                        ▼
                 report (pydantic, same contract as reportdb)
                        │
        ┌───────────────┴────────────────┐
  reportdb.sqlite (unchanged)      HTTP on 127.0.0.1 (new)
        │                               │ GET report, PUT inputs, POST solve,
  VS Code extension host          browser host   ◄── same React UI
  (vscode.postMessage)            (fetch + server-sent events)
```

### 5.1 One UI, two hosts (inspector)

All VS Code coupling in `webview_ui` goes through `src/vscode.ts` (`acquireVsCodeApi`)
and `window` `message` listeners, about 14 call sites. Replace `vscode.ts` with a
`host` module that exposes the same `postMessage` and `onMessage` with two
implementations:

- VS Code: today's behaviour, the default.
- HTTP: `fetch` for requests; server-sent events for run progress, which replaces SQLite polling.

The message shapes stay the same. A Vite build mode `browser` emits static assets that
the lib serves. The VS Code extension does not change.

### 5.2 `fi-serve` (lib)

Run it as `fi-serve flowsheet.py [--attr FS] [--port 0] [--host 127.0.0.1]`.

- It imports the runner, runs steps through `solve_*`, and keeps `runner.model` in memory.
- It serves the built UI with the standard library's `http.server` in a thread, the same pattern as idaes-ui, so no new web framework is added.
- It binds `127.0.0.1` only.
- It requires a random per-session token in the URL and in a header. It sends no `Access-Control-Allow-Origin` header at all; idaes-ui sends `*`.

Routes:

| Method | Path | Does |
|---|---|---|
| GET | `/api/report` | Current report (all actions), same schema as `reportdb` |
| GET | `/api/events` | Server-sent events: step status, solver log lines, done or failed |
| PUT | `/api/inputs` | `{key: value}` for annotated inputs only, with bounds and units checked |
| POST | `/api/solve` | Re-run from the runner's `resolve_from` step; one at a time (409 if busy) |
| GET/PUT | `/api/layout` | Diagram positions, saved next to the flowsheet file |
| GET/POST | `/api/scenarios` | List, or save a named snapshot of inputs, outputs and stream table |
| GET | `/api/scenarios/{a}/diff/{b}` | Differences between two scenarios |
| GET | `/api/export?fmt=csv\|json` | Current report or a scenario |

Every run also appends to `reportdb`, so the VS Code history tab sees browser runs.

#### Webview message protocol (owner: inspector pull request 4)

The browser host (`webview_ui/src/host.ts`) carries the same messages the VS Code webview
exchanges with the extension, unchanged in shape. It needs one route beyond the table above:

| Method | Path | Does |
|---|---|---|
| POST | `/api/message` | One UI-to-host message as the JSON body; token in the `X-FI-Token` header. Answer promptly with any 2xx once accepted (a run continues in the background); replies arrive on `/api/events` |

- `/api/events` (above) is the host-to-UI stream: each server-sent event's `data` is one JSON message. `EventSource` cannot set headers, so the token is the `token` query parameter.
- Both routes resolve relative to the page URL, so the UI served at `/?token=…` calls `/api/message` and `/api/events?token=…`.
- **Connection snapshot.** Each time `/api/events` connects (first load and the browser's automatic reconnects), `fi-serve` first sends what a freshly loaded page needs: `init` (`loadApp`, `fileName`), `switch_tab` with the real `idaesRunInfo` (not a `null` placeholder, which would reset the step selection), the latest step rows as `step_status_update` with `reset: true`, the current report as `flowsheet_runner_result` if one exists, and `run_flowsheet_done` if no run is active. The UI opens the stream only once it is listening, so the snapshot is not dropped, and it sends requests without waiting for the stream.
- **Open item (owners: lib pull request 5 with inspector pull request 7).** A page that connects while a run is in progress, or reconnects during one, cannot yet show it as running: the UI enters the running state only from its own Run click, and a lost `process_started` leaves Cancel without a process id. Likewise a Run click whose POST is accepted after an idle snapshot arrives shows as idle. Fixing this needs a run-state message the UI can apply on connect; it is not part of pull request 4.
- `fi-serve` refuses the page itself (HTTP 401 with a plain message) when the `token` is missing or wrong, so a bad URL shows an error rather than a blank page.
- A failed POST (network error or non-2xx) shows up in the UI as an `error` message; for `run_flowsheet` and `solve` the UI also ends the run locally, as if `run_flowsheet_done` had arrived. Unparseable event data and an event stream the browser has stopped retrying also show up as `error`.
- Known limit: if the server stops between serving the page and the first stream connection, the browser keeps retrying and the page stays on its loading state.
- The browser build is `npm run build -- --mode browser` in `webview_ui`. It writes `webview_ui/dist-browser/` with relative asset paths. The lib serves that directory.
- The UI reaches `fi-serve` only through these two routes, so one message protocol serves both hosts. Later inspector units (diagram layout, inputs and re-solve, costing, scenarios) append their message types to the tables below. The other REST routes in the table above remain the lib's choice for scripts and tests; the UI does not call them.

UI to host (`frontendInstruction`, always with `fromPanel`: `treeView` or `webView`). The browser host must support the first group; the second is VS Code-only, and `fi-serve` may ignore those or answer with an `error` message.

| Instruction | Fields | Expected reply |
|---|---|---|
| `ready` | — | Extension: the tree view gets `init` (`loadApp: "treeView"`), then for a wrapped flowsheet file a loading `switch_tab` (`isLoading: true`) followed by a `switch_tab` with the steps in `idaesRunInfo` or an `initError`; with no Python file active, or an unwrapped one, a single non-loading `switch_tab` with `initError`; the results panel gets only `init` (`loadApp: "webView"`). Browser host: the connection snapshot above (browser-only: it includes the in-memory report); answering `ready` with it again is optional |
| `run_flowsheet` | `selectedSteps`: last step name to run | `start_new_run`, `clear_terminal_logs`, `terminal_log` (spawn line), `process_started`, then `terminal_log`… and `step_status_update`… as the run goes. On exit, a final `step_status_update` (`final: true`, `runException`) if status rows were recorded. Success then sends an `error` saying per-step status is unavailable if there were no status rows, `flowsheet_runner_result` if the report can be read (otherwise a `terminal_log` saying so), and `run_flowsheet_done`. Failure (including failure before the process starts) sends `error` and `run_flowsheet_done`, with no report. Only `run_flowsheet_done` is guaranteed |
| `kill_process` | `pid` (from `process_started`) | `terminal_log` (stopped manually), a final `step_status_update` if any step was recorded, then `run_flowsheet_done`; no report |
| `pull_flowsheet_history` | `id`: reportdb run id | `flowsheet_runner_result`, `step_status_update` (`reset: true`), or `error` |
| `switch_sub_tab` | `tab_name`, `sub_tab_name` | the same `switch_sub_tab` broadcast back |
| VS Code-only: `focus_view`, `focus_document` (`target`, `line`), `open_interpreter_picker`, `post_github_issue` (reply `github_issue_result`) | | |
| `solve` | `values`: object mapping declared input keys (including `key[index]`) to finite numbers in the report's displayed units; `fromPanel: "webView"` | One transaction: `start_new_run`, `clear_terminal_logs`, `terminal_log`…, `step_status_update`…, `flowsheet_runner_result`, final `step_status_update`, `run_flowsheet_done`; or `solve_rejected` before starting |
| `cancel_solve` | `fromPanel`: `webView` or `treeView`; no process id | Cancel the active in-process run; restore values and send `solve_failed`, the restored `flowsheet_runner_result`, final `step_status_update`, `run_flowsheet_done` |

The UI also posts bare acknowledgements `{reload_mermaid: "done"}` and `{reload_webview: "done"}` with no `frontendInstruction`; the host may ignore them.

Host to UI (`type`):

| `type` | Fields | Effect |
|---|---|---|
| `init` | `loadApp` (`treeView` or `webView`), `fileName`, `content`, `idaesRunInfo`, `osPlatform` | Chooses the page and ends loading |
| `switch_tab` | `activate_tab_name`, `is_flowsheet`, `isLoading`, `idaesRunInfo`, `initError`, `packageWarnings`, `open_python_files` | Active flowsheet and its steps |
| `flowsheet_runner_result` | `data`: one report (reportdb schema) | All result panels |
| `step_status_update` | `data`: step rows (`step_name`, `errcode`, `solve_ok`, `errmsg`), `runException`, `final`, `reset` | Step icons and error log |
| `start_new_run`, `clear_terminal_logs`, `run_flowsheet_done` | — | Run lifecycle |
| `process_started` | `pid` | Enables cancel |
| `terminal_log` | `data`: text chunk | Terminal log tab |
| `error` | `message` | Error log |
| `history_update` | `data`: run list | History tab |
| `switch_sub_tab` | `tab_name`, `sub_tab_name` | Result tab selection |
| VS Code-only: `python_env_update`, `update_open_files`, `flowsheet_file_saved`, `highlight_view`, `github_issue_result` | | |
| `init` (live-solve additions) | `loadApp` also accepts `"standalone"`; optional `capabilities: {live_solve: bool}` | `standalone` renders run control and results together from one init; only `live_solve: true` enables editing fixed declared inputs. Absent/false stays read-only, including VS Code |
| `solve_rejected` | `message`: explanation; `errors`: object mapping input keys to error text (may be empty for busy) | Reject unknown/non-editable keys, non-finite or out-of-bounds values, or a concurrent solve. Keep draft edits and show errors beside the fields; no model changes |
| `solve_failed` | `message`: explanation; `rolled_back: true` | Solver failure, exception, timeout or cancellation restored the pre-solve model values. Also send the restored `flowsheet_runner_result`, final `step_status_update`, then `run_flowsheet_done` |

The UI still handles `update` and `flowsheet_detail`, but the extension no longer sends them; the browser host need not either.

### 5.3 How a flowsheet declares what to show and what is editable

Use what IDAES already has; add as little as possible.

```python
from idaes_fi.structfs.fsrunner import FlowsheetRunner
FS = FlowsheetRunner(resolve_from="initialize")    # new kwarg; default "solve_initial"

@FS.step("build")
def build(ctx):
    ...
    m.fs.feed.flow_vol.fix(1.0)
    FS.annotate_var(m.fs.feed.flow_vol[0], key="feed_flow", title="Brine feed",
                    units="L/h", is_input=True, input_category="Feed",
                    bounds=(0.1, 10))   # new optional kwarg
    FS.annotate_var(m.fs.costing.LCOP, key="lcop", title="Cost of Li2CO3",
                    is_input=False, is_output=True, output_category="Economics")
```

- **Inputs:** `annotate_var(is_input=True)` on a fixed `Var`. Only annotated inputs can be edited; the server rejects any other key. A new `inputs` action emits `key, title, units, value, bounds, category, fixed`.
- **Outputs:** `annotate_var(is_output=True)` puts the variable in an outputs table and makes it available as a scenario column.
- **Structural inputs** (for example the number of stages): an input annotated `rebuild=True` triggers a run from `build` instead of `resolve_from`. The cost is honest (a rebuild) and the UI says so.
- **Icons and ports:** a registry in `idaes-connectivity`,
  `register_unit_icon(cls_or_module_name, svg_path, ports={"aqueous_inlet": "left", ...})`.
  Lookup falls back from class to base class, then module name, then default. That covers PrOMMiS and custom units without editing a bundled JSON file.
- **Costing:** found automatically. A `costing` action walks `FlowsheetCostingBlock`s and `UnitModelCostingBlock`s and emits per-unit capital and fixed/variable operating cost plus flowsheet aggregates, with units. Nothing needs declaring.

### 5.4 Diagram

- **Graph data (connectivity, then a lib action `flowsheet_graph`):**
  - units: name, class, parent block and icon;
  - ports: name and direction;
  - arcs: source unit and port, destination unit and port;
  - descend into sub-blocks, so the lithium full process, whose arcs all sit on sub-blocks, draws correctly;
  - a "collapse block" option to show a sub-block as one unit.
- **View (inspector):**
  - React Flow (MIT) with elkjs (EPL-2.0) layered layout, left to right, using port sides from the icon registry;
  - drag to reposition and save to `/api/layout`;
  - hover a link to see stream values, and click to highlight its stream-table column;
  - export SVG/PNG.
- Mermaid stays as the simple tab.

### 5.5 Live solve semantics

- Inputs are applied with `var.fix(value)` in one transaction. Before applying, snapshot all variable values; on solver failure or an exception, restore the snapshot and report the failure.
- One solve at a time behind a lock (409 if busy). Each solve has a timeout and an explicit cancel.
- Solver output streams to the existing IPOPT tab over server-sent events.
- The report is regenerated by the same actions after every run, so the VS Code path and the browser path share one code path.

### 5.6 Backward compatibility

- **VS Code extension:** unchanged behaviour; the host module defaults to VS Code.
- **`fi-run`, `fi-steps`, `fi-db`:** unchanged.
- **Report schema:** additive only (new actions `inputs`, `flowsheet_graph`, `costing`, `scenarios`). Bump `reportdb` to minor 1.2 and keep lib PR #41's version check.
- **Flowsheets without annotations or costing:** still run; those panels show an empty state.
- **`IDAES/idaes-ui` / `fs.visualize()`:** untouched. A later, optional shim could make `fs.visualize()` start `fi-serve` when `idaes_fi` is installed, but only if IDAES maintainers want it.

## 6. Upstream pull request sequence

Each item is a separately reviewable unit with its own tests and docs, built and merged on
the forks. Owner decision 2026-10-20: nothing is opened upstream for now. When that changes,
open an issue first in each target repository and link the idaes-pse "moved to lib" issues.

| # | Repo | Pull request | Size goal |
|---|---|---|---|
| 1 | idaes-connectivity | Record port names on arcs; fix `if comp.is_indexed` (missing call); unit icon registry with class to module to default fallback | ~300 lines |
| 2 | lib | `flowsheet_graph` action (units, ports, arcs, sub-block descent) | ~300 |
| 3 | lib | `inputs` action that emits `annotate_var` metadata; `bounds` and `rebuild` kwargs | ~200 |
| 4 | inspector | `host` transport seam (VS Code and HTTP) plus `browser` build mode; no UI change | ~400 |
| 5 | lib | `fi-serve`, read-only: serve the UI plus `/api/report` and events | ~500 |
| 6 | inspector | Process-flow diagram view (React Flow + ELK) with saved layout | ~1,200 |
| 7 | lib + inspector | Editable inputs plus in-process re-solve with rollback, lock, timeout and cancel | ~800 + ~600 |
| 8 | lib + inspector | Costing action and panel | ~300 + ~400 |
| 9 | lib + inspector | Scenarios: save, compare, diff and CSV/JSON export | ~400 + ~600 |

The first upstream pull request is #1 or #4. Both are small and change no behaviour.

## 7. Tests and docs

- **lib (pytest, Python 3.11–3.14 matrix):**
  - For each new action, one test on the bundled flash/HDA flowsheets, plus one MSContactor fixture (multi-port, sub-block arcs).
  - `fi-serve` route tests with `http.client`: token required, unknown input key rejected, out-of-bounds value rejected, a failed solve restores values, and a concurrent solve returns 409.
- **connectivity:** port-name and icon-fallback tests; an IndexedArc regression test.
- **inspector:**
  - Vitest for the host transport and the diagram data mapping.
  - Extend the Playwright e2e suite with a browser-host run: start `fi-serve` on the flash flowsheet, edit an input, solve, check that the table changed and that a diff appears.
- **Docs:**
  - a "Browser mode" page;
  - an "Annotating inputs and outputs" how-to;
  - a "Registering unit icons" how-to;
  - each pull request updates the extension changelog or the lib docs, as the repo does now.

## 8. Lithium case studies (built in `Lithium_Extraction` after pull requests 5–7)

Both are thin runner modules plus a `t3.json` script that runs `fi-serve` on `127.0.0.1`.
The current hand-coded app stays until these reach parity on its checks.

| | Extraction only | Full process |
|---|---|---|
| Builder | `set_c.build_flowsheet` / `set_a.build_flowsheet`, extraction scope | Same plus `full_process.connect_units` (scrub, strip, saponification, carbonation, …) |
| Inputs (annotated) | O/A ratio, extractant concentration, saponification ratio, feed Li/Na; stage count (`rebuild=True`) | The same, plus reagent prices and product targets |
| Outputs (annotated) | Li extraction fraction, Na co-extraction, loaded organic | Product recovery, cost per kg Li, cost per m³ brine |
| Costing | `OperatingCosting` extraction accounts | Full-process accounts, plus optional `REECosting` plant costing |
| Scenarios | Solvent set × brine site as named presets | Same |

These stay Lithium-specific and are not upstreamed:

- solvent, brine and site sets and their presets;
- version labels and the frozen Version 1.0 APMonitor tab;
- ePC-SAFT, which the UI sees only as values inside the property `ExternalFunction`;
- campaign charts over retained records;
- the per-number provenance checker (`check_app.py`), whose idea could later become a generic "trace every displayed value" test.

Generic pieces the Lithium app has today, all replaced by the work above:

- live solve behind a lock;
- the costing breakdown;
- the scenario matrix;
- the diagram.

### Lithium environment needs

Changes go through the Lithium thread or a `tannerpolley/Lithium_Extraction` issue, not direct edits:

- Add `idaes-fi` and `idaes-connectivity`, pinned to fork commits during co-development and to upstream releases later.
- The lib currently pins `idaes-pse @ git+…@main`. It must accept `idaes-pse>=2.13,<2.14`, or uv cannot resolve it against Lithium's lock. Relaxing this pin is a small upstream lib pull request.
  Checked 2026-10-20: with the pin bypassed, the lib at `7e9c812` passes its own suite on
  Python 3.13.14 / idaes-pse 2.13.0 / Pyomo 6.10.1 (130 passed).
- Node is not needed at run time if the built browser assets ship inside the lib wheel. Node 24 is needed only to develop the UI; this machine has Node 22.
- Import `idaes` before other Pyomo modules in the runner modules. Otherwise Pyomo caches a failed PyNumero lookup and diagnostics fail.
- Solves take seconds to minutes: stored records have a median of 27 s for fixed designs and 59 s for optimized ones. The UI must show progress and allow cancel; the server-sent events in section 5.2 cover this.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Upstream bandwidth. The inspector is mostly one author; 19 of its last 20 merges had no recorded review; lib PR #15 has been open since May | Issue first, small pull requests, and the fork stays usable on its own. Ask Dan Gunter and sspoon, the issue assigners, early |
| The browser host is not on the inspector's stated plan (README: needs the VS Code host) | Pull request 4 is a no-behaviour-change refactor that is useful on its own (testability); propose browser mode in an issue before pull request 5 |
| Licence. All three PrOMMiS repos grant LBNL a perpetual licence to publicly shared enhancements | Accepted by the owner 2026-10-20 |
| Data contract drift between lib and inspector (no JSON Schema; the README says delete the DB on schema change) | Additive actions only; the version check from lib PR #41; generate TypeScript types from Pydantic in a later pull request |
| Long or failing solves leave the model in a bad state | Snapshot and restore, timeout, cancel; structural changes force a rebuild |
| A local server is reachable by any web page | `127.0.0.1` only, a per-session token, no CORS header, and edits allowed only on annotated inputs with bounds |
| idaes-pse pin conflicts | Relax the lib pin (section 8) |
| React Flow + ELK adds about 300 kB to the webview | Lazy-load the view; Mermaid stays the default if maintainers prefer |

## 10. Side findings for upstream (not posted; owner decision 2026-10-20 is fork-only)

- **idaes-ui on idaes-pse 2.13:**
  - `idaes_ui/fv/models/issues.py:145` and `:263` call names moved to `idaes.core.util.diagnostics_tools.utils.vars_with_extreme_values` and `idaes.core.util.model_statistics.variables_not_in_activated_constraints_set`.
  - `_get_diagnostics` has no error handling.
  - The `save_time_interval` setting is ignored (the client reads `.value`; the server sends `setting_value`).
  - The diagnostics numerical tab reads `toolbox_jacobian_condation`, a typo.
- **idaes-connectivity:** `if comp.is_indexed` is missing its call parentheses (`base.py`, around line 476; unverified).
