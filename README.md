# Personal DB Client

Personal DB Client is a personal VS Code database client extension MVP.

The first supported database is PostgreSQL. MySQL/MariaDB is not implemented yet, but the code is structured around a replaceable driver interface so additional database drivers can be added later.

## English

### Goal

This project aims to provide a free personal database management tool inside VS Code. It is not intended to replace DBeaver or DataGrip from day one. The first milestone is a practical MVP that can connect to PostgreSQL, browse schemas and tables, preview table data, and run SQL from a `.sql` file.

### MVP Features

- DB Client view in the VS Code Activity Bar
- Connection profile registration
- Password storage through VS Code SecretStorage
- Connection profile storage through VS Code globalState
- Connection list in a Tree View
- PostgreSQL schema browsing
- PostgreSQL table browsing under each schema
- Table preview with `SELECT * FROM "schema"."table" LIMIT 100`
- SQL execution from selected text
- Current SQL statement execution when no text is selected
- Confirmation dialog before running `INSERT`, `UPDATE`, or `DELETE`
- Query result rendering in a minimal Webview HTML table
- `DbDriver` interface for future driver replacement
- MySQL/MariaDB stub driver for future expansion

### Project Structure

```text
src/
├─ extension.ts
├─ connection/
│  ├─ ConnectionManager.ts
│  ├─ ConnectionProfile.ts
│  └─ SecretManager.ts
├─ drivers/
│  ├─ DbDriver.ts
│  ├─ PostgresDriver.ts
│  └─ MysqlDriver.ts
├─ tree/
│  └─ DatabaseTreeProvider.ts
├─ query/
│  └─ QueryExecutor.ts
└─ webview/
   └─ ResultPanel.ts
```

### Requirements

- VS Code
- Node.js 20 or newer is recommended
- npm
- A PostgreSQL server for manual connection testing

### Clone and Install

```bash
git clone https://github.com/daewook0401/vscode-db-extension.git
cd vscode-db-extension
npm install
```

### Build

Run the TypeScript compiler:

```bash
npm run compile
```

Expected result:

- TypeScript source files in `src/` are compiled into `out/`
- No TypeScript errors are printed

### Run in VS Code

1. Open the project folder in VS Code.
2. Run `npm install` if dependencies are not installed yet.
3. Run `npm run compile`.
4. Press `F5` in VS Code.
5. A new Extension Development Host window opens.
6. Open the DB Client icon in the Activity Bar.
7. Click the add connection button.
8. Enter PostgreSQL connection information:
   - host
   - port
   - database
   - username
   - password
9. Expand the saved connection.
10. Expand a schema.
11. Click a table to preview the first 100 rows.

### Run SQL

1. Open or create a `.sql` file.
2. Select a SQL query and run `DB Client: Run Selected Query`.
3. If no text is selected, the extension runs the SQL statement around the cursor.
4. If the query starts with `INSERT`, `UPDATE`, or `DELETE`, confirm the warning dialog before execution.
5. Results are displayed in a Webview table.

Default keybinding:

```text
Windows/Linux: Ctrl+Alt+Enter
macOS: Cmd+Alt+Enter
```

### Optional Package Check

To inspect which files would be included in a VS Code extension package:

```bash
npx @vscode/vsce ls --no-dependencies
```

To create a `.vsix` package later:

```bash
npx @vscode/vsce package
```

### Current Limits

- PostgreSQL is the only implemented database driver.
- MySQL/MariaDB support is currently a stub.
- Connection editing and deletion are not implemented yet.
- SSL options are not implemented yet.
- Query history is not implemented yet.
- Result paging, sorting, filtering, export, and editable grid are not implemented yet.
- SQL parsing is intentionally simple for the MVP.

## 한국어

### 목표

이 프로젝트는 VS Code 안에서 사용할 수 있는 개인용 무료 DB Client 확장 프로그램 MVP입니다.

처음부터 DBeaver나 DataGrip 수준을 목표로 하지 않습니다. 첫 목표는 PostgreSQL에 연결하고, schema/table을 탐색하고, 테이블 데이터를 간단히 조회하고, `.sql` 파일에서 SQL을 실행할 수 있는 최소 기능을 완성하는 것입니다.

### MVP 기능

- VS Code Activity Bar에 DB Client 전용 View 추가
- DB 연결 프로필 등록
- password는 VS Code SecretStorage에 저장
- 일반 연결 정보는 VS Code globalState에 저장
- 등록된 연결 목록을 Tree View에 표시
- PostgreSQL schema 목록 조회
- schema 하위 table 목록 조회
- table 클릭 시 `SELECT * FROM "schema"."table" LIMIT 100` 실행
- SQL 파일에서 선택 영역 실행
- 선택 영역이 없으면 커서 주변 현재 SQL 문장 실행
- `INSERT`, `UPDATE`, `DELETE` 실행 전 확인창 표시
- 조회 결과를 Webview HTML table로 표시
- DB별 드라이버 교체를 위한 `DbDriver` 인터페이스 제공
- 이후 확장을 위한 MySQL/MariaDB stub 드라이버 제공

### 프로젝트 구조

```text
src/
├─ extension.ts
├─ connection/
│  ├─ ConnectionManager.ts
│  ├─ ConnectionProfile.ts
│  └─ SecretManager.ts
├─ drivers/
│  ├─ DbDriver.ts
│  ├─ PostgresDriver.ts
│  └─ MysqlDriver.ts
├─ tree/
│  └─ DatabaseTreeProvider.ts
├─ query/
│  └─ QueryExecutor.ts
└─ webview/
   └─ ResultPanel.ts
```

### 필요 환경

- VS Code
- Node.js 20 이상 권장
- npm
- 수동 연결 테스트용 PostgreSQL 서버

### 다운로드 및 설치

```bash
git clone https://github.com/daewook0401/vscode-db-extension.git
cd vscode-db-extension
npm install
```

### 빌드 방법

TypeScript 컴파일을 실행합니다.

```bash
npm run compile
```

정상 결과:

- `src/` 아래 TypeScript 파일이 `out/` 폴더로 컴파일됩니다.
- TypeScript 오류가 출력되지 않아야 합니다.

### VS Code에서 실행하는 방법

1. VS Code에서 프로젝트 폴더를 엽니다.
2. 아직 의존성을 설치하지 않았다면 `npm install`을 실행합니다.
3. `npm run compile`을 실행합니다.
4. VS Code에서 `F5`를 누릅니다.
5. Extension Development Host 창이 새로 열립니다.
6. Activity Bar에서 DB Client 아이콘을 엽니다.
7. 연결 추가 버튼을 누릅니다.
8. PostgreSQL 연결 정보를 입력합니다.
   - host
   - port
   - database
   - username
   - password
9. 저장된 연결을 펼칩니다.
10. schema를 펼칩니다.
11. table을 클릭하면 처음 100개 row를 조회합니다.

### SQL 실행 방법

1. `.sql` 파일을 열거나 새로 만듭니다.
2. 실행할 SQL을 선택한 뒤 `DB Client: Run Selected Query` 명령을 실행합니다.
3. 선택 영역이 없으면 커서가 위치한 SQL 문장을 실행합니다.
4. SQL이 `INSERT`, `UPDATE`, `DELETE`로 시작하면 실행 전 확인창이 표시됩니다.
5. 실행 결과는 Webview table로 표시됩니다.

기본 단축키:

```text
Windows/Linux: Ctrl+Alt+Enter
macOS: Cmd+Alt+Enter
```

### 패키징 확인

VS Code 확장 패키지에 어떤 파일이 포함되는지 확인하려면 다음 명령을 실행합니다.

```bash
npx @vscode/vsce ls --no-dependencies
```

나중에 `.vsix` 파일을 만들려면 다음 명령을 사용할 수 있습니다.

```bash
npx @vscode/vsce package
```

### 현재 제한사항

- 실제 구현된 DB 드라이버는 PostgreSQL뿐입니다.
- MySQL/MariaDB는 현재 stub 상태입니다.
- 연결 수정/삭제 기능은 아직 없습니다.
- SSL 옵션은 아직 없습니다.
- Query history 기능은 아직 없습니다.
- 결과 paging, sorting, filtering, export, editable grid는 아직 없습니다.
- SQL parsing은 MVP 범위에 맞춰 단순하게 처리합니다.
