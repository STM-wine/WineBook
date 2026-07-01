# Stem Intelligence QuickBooks Web Connector Setup

This checklist is for the person who has access to the Windows VM/server where
Stem's QuickBooks Desktop company file runs.

Stem Intelligence uses its own QuickBooks Web Connector application. It is
separate from Vinosmith and Melio. Do not edit, remove, disable, repoint, or
reconfigure the existing Vinosmith or Melio connector rows.

## What You Need

- Access to the Windows VM/server where QuickBooks Desktop runs.
- QuickBooks Admin login.
- Permission to use Single-User Mode during setup if QuickBooks requires it.
- Stem `.qwc` config file:
  <https://stmhq.com/api/integrations/quickbooks-desktop/qwc>
- Web Connector username: `stem-qbwc`.
- Web Connector password, provided securely by Stem/Junaid.

Do not use the Vinosmith password.

## Setup Steps

1. Log into the Windows VM/server that hosts QuickBooks Desktop.
2. Open QuickBooks Desktop.
3. Sign in as Admin.
4. If QuickBooks requires it, switch to Single-User Mode for initial setup.
5. In a browser on that same Windows machine, download the Stem config file:
   <https://stmhq.com/api/integrations/quickbooks-desktop/qwc>
6. In QuickBooks, open `File > App Management > Update Web Services`.
7. QuickBooks Web Connector should open.
8. Confirm the existing Vinosmith and Melio rows are present, but leave them unchanged.
9. Click `Add Application`.
10. Select the downloaded `stem-intelligence.qwc` file.
11. Proceed through the QuickBooks authorization prompts.
12. When prompted to allow access, choose the option that allows this application to
    access the company file.
13. If prompted for which QuickBooks user to log in as, choose `Admin`.
14. After setup, Web Connector should show a new row named `Stem Intelligence`.
15. In the Stem Intelligence row, click the Password field.
16. Enter the Stem Web Connector password provided separately.
17. Press `Enter`, then confirm/save the password if prompted.
18. Make sure `Auto-Run` is unchecked for Stem Intelligence for the first test.
19. Select/check only the `Stem Intelligence` row.
20. Click `Update Selected` to run it manually once.

## Expected Result

- The Stem connector authenticates successfully.
- It contacts:
  <https://stmhq.com/api/integrations/quickbooks-desktop/web-connector>
- It runs read-only QuickBooks queries for customers, items, invoices, credit
  memos, and payments.
- It does not create, edit, delete, or modify any QuickBooks records.
- Vinosmith and Melio continue working normally.

## Stem Status Endpoint

After a manual run, Stem can check:

<https://stmhq.com/api/integrations/quickbooks-desktop/web-connector>

This endpoint shows safe, redacted diagnostics:

- whether required configuration is present;
- which read-only request types are enabled;
- active session count;
- recent session summaries with request types, response status codes/messages, and
  response checksums.

It does not expose the Web Connector password or raw QuickBooks response XML.

## Troubleshooting

If setup or the first manual run fails, send Stem/Junaid:

- the exact Web Connector error message;
- a screenshot of the Stem Intelligence row/status, if possible;
- whether the failure happened while adding the `.qwc`, authorizing in QuickBooks,
  saving the password, manually running `Update Selected`, or processing the
  QuickBooks response.

Common failure modes:

- **Wrong password**: Web Connector authentication fails. Re-enter the Stem Web
  Connector password, press `Enter`, and save it when prompted.
- **Wrong `.qwc` file or endpoint**: The `.qwc` should point to
  `https://stmhq.com/api/integrations/quickbooks-desktop/web-connector`.
- **QuickBooks not open or wrong company file**: Open the correct company file in
  QuickBooks Desktop, then retry `Update Selected`.
- **Not Admin / setup permissions issue**: Sign in as Admin and use Single-User
  Mode for initial setup if QuickBooks asks for it.
- **Network or TLS issue from the VM**: Open
  `https://stmhq.com/api/integrations/quickbooks-desktop/web-connector` in a
  browser on the Windows VM. It should load a JSON status response.
- **QuickBooks qbXML error**: Send the Web Connector status message. Stem will
  inspect the redacted session summary and adjust the read-only query shape if
  needed.

## First-Test Guardrails

- Do not use the Vinosmith password.
- Do not modify Vinosmith or Melio.
- Do not enable Auto-Run for Stem yet.
- Do not leave QuickBooks in Single-User Mode after setup unless accounting needs it.
- The first Stem run is read-only only.
