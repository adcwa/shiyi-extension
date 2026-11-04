@echo off
where py >nul 2>nul
if %errorlevel% equ 0 (py -3 "%~dp0upgrade\install.py") else (python "%~dp0upgrade\install.py")
pause
