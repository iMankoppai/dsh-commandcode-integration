@echo off
rem Install the commandcode-quota skill into the DSH user-level skill root
rem (%USERPROFILE%\.dsh\skills), where every DSH profile/workspace can see it.
rem Re-run after updating the skill files. Start a NEW session afterwards.
rem Keep this file pure ASCII.
setlocal
set "SRC=%~dp0skills\commandcode-quota"
set "DST=%USERPROFILE%\.dsh\skills\commandcode-quota"

if not exist "%SRC%\quota.mjs" (
  echo [ERROR] %SRC%\quota.mjs not found - run this from the repository root.
  pause
  exit /b 1
)
if not exist "%DST%" mkdir "%DST%"
copy /y "%SRC%\quota.mjs" "%DST%\quota.mjs" >nul
copy /y "%SRC%\SKILL.md" "%DST%\SKILL.md" >nul
echo Installed to %DST%
echo   - in a DSH session: ask "check the quota" / use the command list entry
echo   - double-click:     check-quota.cmd
echo   - start a NEW DSH session if the skill does not show up right away
echo.
pause
