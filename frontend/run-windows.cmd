@echo off
rem Khởi chạy Vite bằng Node.js của Windows trong thư mục frontend hiện tại.
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js chua duoc cai hoac chua co trong PATH cua Windows.
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm chua co trong PATH cua Windows.
  exit /b 1
)

rem Cài lại dependency khi thư mục hiện có chứa binary dành cho Linux.
if not exist "node_modules\@rollup\rollup-win32-x64-msvc\package.json" (
  call npm ci
  if errorlevel 1 exit /b 1
)

if not exist "node_modules\@esbuild\win32-x64\package.json" (
  call npm ci
  if errorlevel 1 exit /b 1
)

call npm run dev -- --host 127.0.0.1
exit /b %errorlevel%
