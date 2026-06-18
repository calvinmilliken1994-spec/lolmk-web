# =============================================================================
# LoLMK shortcuts - load this script to get the lolmk-* commands.
#
# Three ways to use it (pick one, see scripts/README.md):
#   1) On-demand:   . C:\projects\LoLMK\scripts\lolmk-shortcuts.ps1
#   2) Auto-load:   add the above line to your existing $PROFILE
#   3) Windows Terminal: add a dedicated LoLMK profile that sources this
# =============================================================================

$LOLMK_DIR = "C:\projects\LoLMK"

# Jump to project from anywhere
function lolmk {
    Set-Location $LOLMK_DIR
}

# Start dev server
function lolmk-dev {
    Set-Location $LOLMK_DIR
    npm run dev
}

# Production build (sanity-check before pushing)
function lolmk-build {
    Set-Location $LOLMK_DIR
    npm run build
}

# Commit everything and push. Vercel auto-deploys on push to main.
#   Usage:  lolmk-ship "fix the hero spacing"
function lolmk-ship {
    param(
        [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
        [string[]]$Message
    )
    Set-Location $LOLMK_DIR
    $msg = $Message -join " "

    git add -A
    git commit -m $msg
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Nothing committed (or commit failed). Stopping." -ForegroundColor Yellow
        return
    }

    git push
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Pushed to GitHub. Vercel will auto-deploy in ~30s." -ForegroundColor Green
        Write-Host "Watch progress: https://vercel.com/dashboard" -ForegroundColor Green
    }
}

# Show local repo state + recent history
function lolmk-status {
    Set-Location $LOLMK_DIR
    Write-Host "Repo state:" -ForegroundColor Cyan
    git status --short
    Write-Host ""
    Write-Host "Last 3 commits:" -ForegroundColor Cyan
    git log -3 --oneline
}

Write-Host "LoLMK shortcuts loaded: lolmk, lolmk-dev, lolmk-build, lolmk-ship, lolmk-status" -ForegroundColor DarkGray
