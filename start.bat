@echo off
rem start.bat - start a local web server and open the classroom UI in the browser.
rem (Comments are in English on purpose: cmd.exe can misread UTF-8 Chinese in .bat files.)
rem Uses the project's .venv Python if it exists, otherwise the system "python".
cd /d "%~dp0"
set PY=python
if exist ".venv\Scripts\python.exe" set PY=.venv\Scripts\python.exe
start "" http://localhost:8000/
echo Classroom UI is running at http://localhost:8000/  (close this window to stop)
%PY% -m http.server 8000 --bind 127.0.0.1
pause
