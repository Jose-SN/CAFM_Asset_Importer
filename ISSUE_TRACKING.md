# Issue tracking - v8.0

When a CAFM step fails:

1. Do not clear the session.
2. Click **Download diagnostic JSON**.
3. Click **Download CSV log**.
4. Note what was visible in CAFM (for example: Contract list did not load, PPM Status popup did not open, Save validation appeared).
5. Send the diagnostic JSON and CSV log with the screenshot if available.

The diagnostic JSON is intentionally small and trace-oriented. It stores no CAFM credentials. It identifies the current Asset Code, workbook row, PPM key/index, automation phase, iteration progress, page URL, validation text and recent state transitions.

## Error isolation

- `phase: fill/filling` -> direct field or tab issue.
- `phase: lookup/...` -> dropdown selection or lookup result issue.
- `phase: await_save` -> asset save/validation issue.
- `phase: activate_*` -> Asset Status issue.
- `phase: ppm_*` -> PPM creation/save issue.
- `phase: ppm_status_*` -> PPM Active status issue.

## Resume principle

The importer persists the session after state transitions. Keep the workbook unchanged when troubleshooting a stopped run. Do not start a new bulk run until the failed record has been reviewed.
