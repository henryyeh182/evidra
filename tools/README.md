# Internal Decision Graph Viewer

Open `decision-graph-viewer.html` in a browser, choose
`../harness/regression-baseline.json` as the primary artifact, and optionally
choose a second regression artifact for comparison. The viewer is local-only:
it reads files selected by the user and does not send evidence or graph data
over the network.

The graph is intentionally an audit surface, not a health dashboard. It shows
evidence signals, applied and overruled rules, the governing decision, and the
resulting action. Use the case selector for the 37 regression cases, and click
a node to inspect its structured value.
