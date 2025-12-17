# Family Circle

An Electron desktop app for managing family documents, records, and AI-powered Q&A using local or hosted LLMs.

## Features

- User authentication with JWT
- Document upload and text extraction (PDF, DOCX, TXT)
- Local SQLite database for records
- AI Q&A with embeddings (Xenova Transformers)
- Support for hosted SLM (Granite) or local Ollama
- P2P file sharing
- Profile management

## Prerequisites

- Node.js 18.20.0 LTS (recommended; 22.x may cause native module issues)
- Windows (for building; app runs on Windows/Mac/Linux)

## Setup

1. **Install Node.js 18.20.0**:
   - Download from [nodejs.org](https://nodejs.org/)
   - Or use nvm-windows: `nvm install 18.20.0 && nvm use 18.20.0`

2. **Clone or extract the project**:
   - Avoid placing in OneDrive or synced folders (can cause EPERM errors).

   ```powershell
   xcopy /E /I /H /Y "C:\Users\kasul\OneDrive\Desktop\code\upload\app" "C:\dev\upload\app"
   ```

3. **Install dependencies**:

   ```bash
   npm install
   ```

4. **Rebuild native modules**:

   ```bash
   npx electron-rebuild -f -w better-sqlite3
   ```

5. **Run the app**:

   ```bash
   npm start
   ```

## Building the App

1. **Ensure prerequisites** are met (Node 18, dependencies installed).

2. **Build distributables** (run as Administrator on Windows):

   ```bash
   npx electron-builder --win --publish=never
   ```

3. **Output**:
   - `dist/Family Circle Setup X.X.X.exe` (installer)
   - `dist/win-unpacked/` (portable version)

## Configuration

- **Version**: Update `"version"` in `package.json` before building.
- **Author**: Set `"author"` in `package.json`.
- **Environment variables** (optional):
  - `OLLAMA_HOST`, `OLLAMA_PORT` for local Ollama
  - `SLM_URL`, `SLM_MODEL` for hosted Granite
  - `JWT_SECRET` for authentication

## Troubleshooting

### npm install fails with EPERM or compilation errors

- Move project out of OneDrive to a local folder (e.g., `C:\dev\project`).
- Use Node 18.20.0 (not 22.x).
- Clean and reinstall: `rmdir /s /q node_modules && del package-lock.json && npm install`

### electron-builder fails with symlink errors

- Run PowerShell as Administrator.
- Ensure no antivirus blocking file operations.

### JSON syntax errors in package.json

- Validate with `node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')) ? 'Valid' : 'Invalid')"`

### App won't start

- Check console for Ollama/Granite connectivity.
- Ensure ports are available (Ollama default: 11434).

## Project Structure

- `src/main.js` - Electron main process
- `src/preload.js` - IPC bridge
- `public/` - UI files (HTML, JS, CSS)
- `app/` - Backend logic (database, services, IPC handlers)
- `assets/` - Icons and resources

## Dependencies

- Electron for desktop app
- better-sqlite3 for database
- @xenova/transformers for embeddings
- axios for HTTP requests
- bcrypt & jsonwebtoken for auth

## License

[Add license here]

## Author

Lyazi Marvin
