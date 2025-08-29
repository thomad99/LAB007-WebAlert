# Web-Alert Git Sync Script (PowerShell)
# Run this script whenever you want to sync your project to GitHub
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Web-Alert Git Sync Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
$projectPath = "C:\Users\david\OneDrive\My Pet Projects\AI\Web-Alert"
Set-Location $projectPath
Write-Host "Changed to directory: $(Get-Location)" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "STEP 1: CHECKING GIT STATUS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
git status --porcelain
Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "STEP 2: ADDING ALL CHANGES" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
git add .
Write-Host "All changes added to staging area" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "STEP 3: COMMITTING CHANGES" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
$commitMessage = "Update Web-Alert project - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
git commit -m $commitMessage
Write-Host "Changes committed successfully" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "STEP 4: PUSHING TO GITHUB" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
$pushResult = git push origin main 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "SUCCESS: Project synced to GitHub!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Repository: https://github.com/thomad99/LAB007-WebAlert" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "ERROR: Failed to push to GitHub" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Push output:" -ForegroundColor Yellow
    Write-Host $pushResult -ForegroundColor Red
    Write-Host ""
    Write-Host "Possible solutions:" -ForegroundColor Yellow
    Write-Host "1. Check your internet connection" -ForegroundColor White
    Write-Host "2. Verify GitHub credentials" -ForegroundColor White
    Write-Host "3. Run: git remote -v" -ForegroundColor White
    Write-Host "4. Try: git push --force origin main" -ForegroundColor White
    Write-Host ""
}
Write-Host "Script completed." -ForegroundColor Cyan
Write-Host "Press any key to continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
