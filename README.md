# fsm
Finite State Machine simulator with Guards

Transition label:  `event [guard] / action`, e.g. `button [credit >= 200] / credit := credit - 200`

## Several machines
File / New, Open… and the examples each open a new diagram window.
The Simulation and Properties windows always work on the active diagram window
(click a diagram to make it active). A running simulation keeps running in the
background. All open machines are kept in the browser between sessions.

## Examples
Every `*.fsm.json` file in the `examples/` folder appears in the File menu as
"Example: <name>" (ordered by file name; the menu text is the machine's name).
To add one: draw the machine, File / Save, and copy the file into `examples/`
(the input sequence in the Simulation window is saved with it).

A web server cannot list a folder, so the tool reads `examples/index.json`.
Regenerate it after adding or removing a file:

    node tools/examples-index.js

The deploy workflow does this automatically. When testing locally with a server
that shows folder listings (`python -m http.server`, VS Code Live Server) new files
are found even without regenerating the list. Opening `index.html` directly from
disk (file://) does not allow the browser to read the folder, so use a local server.
