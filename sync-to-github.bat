@echo off
setlocal enabledelayedexpansion

REM Color codes
set "GREEN=[92m"
set "RED=[91m"
set "YELLOW=[93m"
set "CYAN=[96m"
set "WHITE=[97m"
set "RESET=[0m"

echo %CYAN%========================================%RESET%
echo %CYAN%Web-Alert Git Sync Script%RESET%
echo %CYAN%========================================%RESET%
echo.
cd /d "C:\Users\david\OneDrive\My Pet Projects\AI\Web-Alert"
echo %GREEN%Changed to directory: %CD%%RESET%
echo.

echo %YELLOW%========================================%RESET%
echo %YELLOW%STEP 0: FIXING GIT OWNERSHIP%RESET%
echo %YELLOW%========================================%RESET%
git config --global --add safe.directory "C:/Users/david/OneDrive/My Pet Projects/AI/Web-Alert"
if %errorlevel% equ 0 (
    echo %GREEN%Git ownership fixed successfully%RESET%
) else (
    echo %RED%Warning: Could not fix Git ownership%RESET%
)
echo.

echo %YELLOW%========================================%RESET%
echo %YELLOW%STEP 1: CHECKING GIT STATUS%RESET%
echo %YELLOW%========================================%RESET%
git status --porcelain
echo.

echo %YELLOW%========================================%RESET%
echo %YELLOW%STEP 2: ADDING ALL CHANGES%RESET%
echo %YELLOW%========================================%RESET%
git add .
echo %GREEN%All changes added to staging area%RESET%
echo.

echo %YELLOW%========================================%RESET%
echo %YELLOW%STEP 3: COMMITTING CHANGES%RESET%
echo %YELLOW%========================================%RESET%
git commit -m "Update Web-Alert project - %date% %time%"
if %errorlevel% equ 0 (
    echo %GREEN%Changes committed successfully%RESET%
) else (
    echo %RED%Commit failed - checking for issues%RESET%
    echo %YELLOW%Checking if there are uncommitted changes...%RESET%
    git status --porcelain
    echo %RED%Please resolve any issues and try again%RESET%
    goto :end
)
echo.

echo %YELLOW%========================================%RESET%
echo %YELLOW%STEP 4: PUSHING TO GITHUB%RESET%
echo %YELLOW%========================================%RESET%
git push origin main
if %errorlevel% equ 0 (
    echo.
    echo %GREEN%========================================%RESET%
    echo %GREEN%SUCCESS: Project synced to GitHub!%RESET%
    echo %GREEN%========================================%RESET%
    echo %WHITE%Repository: https://github.com/thomad99/LAB007-WebAlert%RESET%
    echo.
) else (
    echo.
    echo %RED%========================================%RESET%
    echo %RED%ERROR: Failed to push to GitHub%RESET%
    echo %RED%========================================%RESET%
    echo.
    echo %YELLOW%Possible solutions:%RESET%
    echo %WHITE%1. Check your internet connection%RESET%
    echo %WHITE%2. Verify GitHub credentials%RESET%
    echo %WHITE%3. Run: git remote -v%RESET%
    echo %WHITE%4. Try: git push --force origin main%RESET%
    echo.
    echo %YELLOW%If you see 'repository rule violations':%RESET%
    echo %WHITE%5. Check for exposed secrets in your code%RESET%
    echo %WHITE%6. Remove sensitive files and commit again%RESET%
    echo %WHITE%7. Note: System now uses email-to-SMS gateways (no external SMS services)%RESET%
    echo.
)

:end
echo %CYAN%Script completed.%RESET%
echo %WHITE%Press any key to continue . . .%RESET%
pause >nul
