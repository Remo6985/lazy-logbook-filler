# Lazy Logbook Filler

A Tampermonkey userscript that fills visible daily logbook entries on the BINUS Activity Enrichment site from rows pasted out of Excel.

It is designed for the manual workflow of opening each visible `ENTRY` row, entering an Activity and Description, and submitting. It does not log in, solve CAPTCHAs, generate content, or click the page-level `SUBMIT` button.

## Features

- Reads Date, Activity, and Description copied directly from Excel.
- Processes visible `ENTRY` rows from top to bottom.
- Skips rows without available `ENTRY` buttons.
- Skips dates with blank spreadsheet content.
- Handles `OFF` rows through the site's own `OFF` button.
- Captures the site's native success or error alert so the run does not block.
- Waits for the table to refresh before continuing.
- Configurable delay between entries, default 5 seconds.
- Dry-run mode shows what will be filled without clicking anything.
- Stop button halts after the current entry finishes.
- Close button hides the panel; a `Logbook` launcher reopens it.
- No backend, API calls, credentials, or telemetry.

## Requirements

- Firefox or Chrome-based desktop browser.
- A Tampermonkey or Violentmonkey installation, or access to the browser console.
- An already authenticated Activity Enrichment session.
- A spreadsheet with three columns:

| Date | Activity | Description |
| --- | --- | --- |
| `2026-11-02` | Activity text | Description text |
| `2026-11-01` | `OFF` | `OFF` |

- Dates must use `YYYY-MM-DD`.
- Activity is required and limited to 255 characters.
- Description is required.
- Any date marked off must have both Activity and Description set to `OFF`.
- Blank weekday rows are allowed and skipped.

A blank template covering November 2026 through January 2027 is included at:

```text
template/logbook-template.xlsx
```

Sundays are pre-filled as `OFF`. Weekday rows are blank.

## Installation

### Tampermonkey or Violentmonkey

1. Install the extension.
2. Open its dashboard and create a new userscript.
3. Replace the generated code with the contents of `logbook-filler.user.js`.
4. Save.
5. Open the Activity Enrichment logbook page and reload.

The script matches:

```text
https://activity-enrichment.apps.binus.ac.id/*
```

### Browser console

1. Open the logbook page.
2. Open `logbook-filler.user.js` in a text editor and copy everything.
3. Open the browser console.
4. Paste into the console and press Enter.
5. If the browser blocks pasting, type `allow pasting`, press Enter, then paste again.

Console mode lasts until the page is reloaded. The userscript manager is recommended for repeated use.

## Spreadsheet Workflow

1. Open `template/logbook-template.xlsx`, or use your own sheet with the same three columns.
2. Fill Activity and Description for weekdays.
3. Mark Sundays or holidays as `OFF` in both columns.
4. Select the header and the data rows in Excel and copy.
5. The panel expects tab-separated data, which is what Excel puts on the clipboard.

Blank future rows do not need to be removed. They are skipped because they have no fillable `ENTRY` row, or because their content is blank.

## Usage

1. Open the logbook month you want to fill. The script only scans the active table.
2. Paste the Excel range into the panel.
3. Click **Dry run**.
4. Confirm the log shows the expected ready dates and missing dates.
5. Set the delay in seconds.
6. Click **Fill ready entries**.
7. Keep the tab open until the run finishes.
8. Check the rows in the page after the run.

Example dry run:

```text
Page rows: 30. Visible ENTRY buttons: 3.
No data for: 2026-11-04. These will be skipped.
READY 2026-11-02 [ENTRY] Example activity
```

For a safe first test, paste only the header and one filled row. This limits the run to a single entry.

## What The Script Does

For each matched row:

1. Clicks the row's `ENTRY` button.
2. Waits for the entry dialog and its auto-filled clock values.
3. Fills Activity and Description.
4. Clicks the dialog's `OFF` button instead when the row is marked `OFF`.
5. Clicks the dialog's `Submit` button.
6. Intercepts the site's native `alert`.
7. Waits until the table row no longer has an `ENTRY` button.
8. Waits for the configured delay before the next row.

It does not change clock-in or clock-out values for normal entries. The site fills those automatically when the dialog opens.

## Delay Setting

The panel has a numeric delay field:

- Default: `5` seconds.
- Range: `0` to `300` seconds.
- Read at the start of a run.
- Disabled while a run is active.

Set `0` only if you do not need the cooldown between entries.

## Close And Reopen

- The `x` button in the panel header hides the panel.
- A small `Logbook` button appears at the bottom right.
- Click the launcher to reopen the panel.
- Closing the panel does not stop a running fill. Use **Stop** to stop.

## Page-Level Submit

The page has a separate bottom `SUBMIT` button that sends ready entries to the site supervisor. This script never clicks it.

If you want to send the entries, review the page and click that button yourself.

## Failure Behavior

The script stops instead of guessing when:

- The pasted data has invalid dates, duplicate dates, incomplete rows, or Activity longer than 255 characters.
- The entry dialog does not appear.
- The dialog date does not match the row.
- Clock-in or clock-out is empty for a normal entry.
- The site returns a validation or error alert.
- The row does not refresh after a save.
- The dialog remains open after a save.

It does not automatically retry a failed or ambiguous save. Reload and inspect the row before running again.

## Troubleshooting

**No rows are ready**

- Check that the correct month tab is active.
- Check that the date has an `ENTRY` button. Future and locked dates are skipped.
- Check that the spreadsheet row is not blank.
- Run **Dry run** and read the missing date list.

**The dialog stays open**

- The site may have rejected the save. Check the panel log.
- Do not click Submit repeatedly.
- Reload the page and inspect the row.

**Clock In or Clock Out is empty**

- The site did not populate the row's time values.
- Enter the time manually before using the filler.

**The site alert is not visible**

- The script captures native alerts so it can continue.
- Success and error messages are written to the panel log.

**The fixed panel is in the way**

- Click the `x` in the panel header.
- Use the `Logbook` launcher to reopen it.

**An old panel appears after updating**

- Reload the page before pasting the new script. The script uses a guard to avoid duplicate panels.

## Privacy And Security

- The script does not read cookies, tokens, or credentials.
- It does not send data anywhere.
- Pasted content stays in the page.
- Do not commit your filled logbook spreadsheet, probe reports, browser exports, or screenshots to a public repository.
- This repository intentionally contains no personal logbook data.

## Limitations

- Only the currently visible table is scanned. Open another month and run again to process it.
- Only rows with a visible `ENTRY` button are eligible. The site may lock future dates.
- The script does not create or rewrite Activity or Description content.
- The script does not bypass site validation or date restrictions.
- It depends on the site's current element IDs and button labels. A site update can break it.
- Not affiliated with BINUS University.

## Project Structure

```text
logbook-filler.user.js          Userscript
template/logbook-template.xlsx  Blank date template, Sundays OFF
README.md                       This guide
```

No build step is required.

## Version

`0.1.2`