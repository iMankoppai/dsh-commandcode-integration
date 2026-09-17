@echo off
rem Show Command Code quota with a double-click (delegates to the skill script, so
rem there is exactly ONE implementation shared with the in-session skill).
rem Keep this file pure ASCII: cmd.exe parses it in the OEM codepage.
chcp 65001 >nul

set "QUOTA=%~dp0skills\commandcode-quota\quota.mjs"
if not exist "%QUOTA%" set "QUOTA=%USERPROFILE%\.dsh\skills\commandcode-quota\quota.mjs"
if not exist "%QUOTA%" (
  echo [ERROR] quota.mjs not found. Looked in:
  echo         %~dp0skills\commandcode-quota\quota.mjs
  echo         %USERPROFILE%\.dsh\skills\commandcode-quota\quota.mjs
  echo         Run install-skill.cmd first, or run the script from this repo.
  echo.
  pause
  exit /b 1
)

node "%QUOTA%" %*
echo.
pause
