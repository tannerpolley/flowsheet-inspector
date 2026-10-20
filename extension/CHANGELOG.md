# Change Log
* Unreleased
1. Add a declared inputs and outputs result tab, read-only in VS Code.
2. Browser hosts can combine run control and results on one standalone page and advertise live solve, with bounded input edits, rebuild confirmation, cancellation, and rollback feedback.

* 0.0.15
1. Add a feedback panel that lets users submit an issue to the GitHub repo or send a feedback email to flowsheetinspector@lbl.gov.
2. Add a rerun notice: when a user changes and saves a flowsheet, a notice appears in the control panel reminding them to rerun the inspector.
3. Add a flowsheet template Emmet-style code snippet. Users can now create an empty Python file, type `flowsheet:idaes`, and hit Enter to automatically generate a default wrapped flowsheet template.

* 0.0.14
1. The error log panel now displays file paths as clickable links. Clicking a link opens the file in the VS Code editor and highlights the exact line where the error occurred.

* 0.0.13
1. Added a stream table view to the Variable tab.
2. Added a toggle button to switch between the variable tree view and the stream table view.
3. Added a shared badge to show degrees of freedom across the stream table view and variable tree view.

* 0.0.12
1. Redesign the step selector in the Run Flowsheet panel: the checkboxes are replaced with a vertical slider-style bar with a dot per step. Click a dot to select that step and every step before it, or press and drag along the bar to adjust the selection; the selected range is highlighted in blue.
---

* 0.0.11
1. Fix interpreter selection when the Microsoft Python extension is not installed: the extension now discovers Python environments on its own (conda environments, workspace venvs, `CONDA_PREFIX`, and pythons on `PATH`) and offers a picker with a manual-path option, so conda users no longer need the Python extension.
2. Add report database checks for users running an older version of flowsheet-inspector-lib: a database with missing tables no longer causes errors, and users get a clear "upgrade the lib" message instead.
---

* 0.0.10
1. Fix a bug where the report tab always showed `hda_flowsheet.py` when loading a history item: the tab title now shows the flowsheet file the loaded run actually belongs to, and is reset to the current file when a new run starts.
2. Change the extension side panel background to the standard VS Code side panel color (matching other extensions) instead of the editor background.
3. Rename the "Load Flowsheet" tab in the side panel to "History".
---

* 0.0.9
1. Re-order the IPOPT output: the solver result summary now appears at the top with the `EXIT:` conclusion as a headline, instead of below thousands of iteration lines.
2. Make the IPOPT problem statistics and iteration table collapsible; the expanded iteration table scrolls inside its own bounded box so the result stays visible.
---

* 0.0.8
1. Distinguish a failed solve step from a code error: a step whose solver ran without raising but found no solution (infeasible or maximum iterations exceeded) now shows an orange cross, separate from the red cross used when a step's code raises an exception.
2. Report each step failure in the error log, including the reason when the solver did not find a solution.
3. Show per-step status icons when loading a past run from the Load Flowsheet view, so the tree view and error log reflect the loaded run.
---

* 0.0.7
1. Add live per-step run status indicators in the Run Flowsheet tree view: a spinner for the step currently running, a green check for completed steps, and a red cross for a failed step.
---

* 0.0.6
1. Add Python interpreter detection so users can choose which Python environment to run flowsheets with.
2. Interpreter selection relies on Microsoft's Python extension. It is now optional — if the extension is not installed, the user is prompted to install it.
---

* 0.0.5
1. Fix an issue where previous flowsheet results remained visible when starting a new run.
2. Fix compatibility issues on Windows and Linux.
3. Fix a bug where switching editor tabs caused the extension tab title to always display `hda_flowsheet.py`.
4. Fix a bug on Windows where the full file path was shown instead of just the file name.
5. Add a wrapped flowsheet validator.
6. Fix a bug where an incorrect warning was shown when the initially loaded file (or the file loaded from global state) was not a wrapped flowsheet.
7. Fix a bug where loading a file — whether on initial load, tab switch, or opening a new file — did not notify the user when the file was not a valid wrapped flowsheet.
---

* 0.0.4
1. Add a new "Load Flowsheet" tab to the tree view.
2. Running a flowsheet with the IDAES runner CLI now generates a SQLite database at `~/.idaes/reportdb.sqlite` to store run reports. Users can load flowsheet run history from the "Load Flowsheet" view in the Flowsheet Inspector.
---

* 0.0.3
1. Fix a bug where users were unable to update the shell type.
---

* 0.0.2
1. Move the diagram panel out of the terminal panel and group it with the variable panel.
2. Update the tree panel styling.
3. Update the IPOPT and logs panels: remove borders and split them into individual tabs.


## [Unreleased]

- Initial release
