@echo off
echo ========================================
echo Push Web-Alert to GitHub
echo ========================================
echo.

:: Change to the repository directory
cd /d "C:\Users\david\OneDrive\My Pet Projects\AI\Web-Alert"
echo Changed to directory: %CD%
echo.

echo ========================================
echo STEP 1: CHECK CURRENT STATUS
echo ========================================
echo.

git status
echo.

echo ========================================
echo STEP 2: ADD AND COMMIT FILES
echo ========================================
echo.

:: Add all files (but exclude this script from deletion)
echo Adding project files to Git...
git add .
echo Files added.
echo.

:: Commit
echo Committing Web-Alert project...
git commit -m "Web-Alert project with welcome and summary notifications"
echo Commit completed.
echo.

echo ========================================
echo STEP 3: FORCE PUSH TO GITHUB
echo ========================================
echo.

echo IMPORTANT: When prompted for credentials:
echo - Username: thomad99
echo - Password: Use your Personal Access Token
echo.

echo Press any key to continue with the force push...
pause

:: Force push without pulling
echo Force pushing local version to GitHub...
git push -u origin main --force
if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo SUCCESS: Local version pushed to GitHub!
    echo ========================================
    echo.
    echo Your Web-Alert project is now on GitHub at:
    echo https://github.com/thomad99/LAB007-WebAlert
    echo.
    echo The remote repository now matches your local version exactly.
    echo.
) else (
    echo.
    echo ========================================
    echo ERROR: Force push failed
    echo ========================================
    echo.
    echo Try running this command manually:
    echo   git push -u origin main --force
    echo.
)

echo Script completed.
pause
