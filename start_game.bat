@echo off
rem start_game.bat - start a local web server and open the AUDIENCE version (game.html) in the browser.
rem Uses serve.py, which picks the next free port if 8000 is already taken.
cd /d "%~dp0"
set PY=python
if exist ".venv\Scripts\python.exe" set PY=.venv\Scripts\python.exe
%PY% serve.py game.html
pause
