# Personal DB Client

Personal DB Client is a VS Code extension MVP for browsing PostgreSQL databases and running SQL queries.

## MVP Features

- DB Client Activity Bar view
- Connection profile registration
- Password storage through VS Code SecretStorage
- Connection list Tree View
- PostgreSQL schema and table browsing
- Table preview with `SELECT * FROM schema.table LIMIT 100`
- SQL execution from the selected text or current SQL document
- Confirmation before `INSERT`, `UPDATE`, or `DELETE`
- Result display in a minimal Webview HTML table

## Development

```bash
npm install
npm run compile
```

To run manually:

1. Open this folder in VS Code.
2. Press `F5` to launch the Extension Development Host.
3. Open the DB Client view in the Activity Bar.
4. Add a PostgreSQL connection.
5. Browse schemas and tables, then click a table to preview rows.
6. Open a `.sql` file and run the selected query with `DB Client: Run Selected Query`.

## Current Limits

- PostgreSQL is the only implemented driver.
- MySQL/MariaDB support is a stub for future expansion.
- Query extraction is selection-first, then full document.
- Result rendering is a basic HTML table.
