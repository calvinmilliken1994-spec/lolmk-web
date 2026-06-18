# scripts/

PowerShell shortcuts for working on LoLMK. Pick the loader that fits your workflow — your existing PowerShell profile stays untouched in all three cases.

## Commands available after loading

| Command | Does |
|---|---|
| `lolmk` | `cd` to the project from anywhere |
| `lolmk-dev` | Jump in + start `npm run dev` |
| `lolmk-build` | Jump in + production build (sanity check) |
| `lolmk-ship "msg"` | Stage all + commit + push. Vercel auto-deploys on push. |
| `lolmk-status` | Show repo state + recent commits |

## Option 1 — On-demand (no profile changes)

Open a PowerShell window, source the script, use the commands. Functions stay loaded for the life of that shell.

```powershell
. C:\projects\LoLMK\scripts\lolmk-shortcuts.ps1
lolmk-dev
```

Each new PowerShell session you want them in, dot-source again.

## Option 2 — Auto-load (one-line addition to your existing $PROFILE)

Adds one line to your profile. Doesn't overwrite anything that's already there.

```powershell
# Create the profile if it doesn't exist yet
if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }

# Append the loader (idempotent — won't add twice if you run this again)
$loader = ". 'C:\projects\LoLMK\scripts\lolmk-shortcuts.ps1'"
if (-not ((Get-Content $PROFILE -ErrorAction SilentlyContinue) -contains $loader)) {
    Add-Content $PROFILE "`n$loader"
}
```

Reload your shell (or run `. $PROFILE`). The LoLMK commands are now available in every PowerShell session.

## Option 3 — Dedicated Windows Terminal profile

Cleanest "extra profile" approach. Adds a **LoLMK** entry to the Windows Terminal dropdown that opens directly in the project folder with the shortcuts loaded. Doesn't touch your default profile or `$PROFILE`.

1. Open Windows Terminal → press `Ctrl+,` (Settings) → bottom-left **Open JSON file**.
2. Find the `"profiles": { "list": [ ... ] }` array.
3. Inside the `list` array, add this object (comma after the previous entry):

```json
{
  "name": "LoLMK",
  "commandline": "powershell.exe -NoExit -Command \". 'C:\\projects\\LoLMK\\scripts\\lolmk-shortcuts.ps1'\"",
  "startingDirectory": "C:\\projects\\LoLMK",
  "guid": "{ea9edfbb-56d4-4334-b031-658e48980084}",
  "icon": "🎮"
}
```

4. Generate a fresh GUID for the `guid` field — run this once in PowerShell and paste the result:

```powershell
[guid]::NewGuid().ToString("B")
```

(That gives you something like `{2f3a8e10-7c44-4e9f-b1d4-2c0e8a5f3b21}` — paste it including the braces.)

5. Save the JSON. The dropdown now has a **LoLMK** option that, when opened, drops you in `C:\projects\LoLMK` with all the `lolmk-*` commands ready.

### Optional polish

Add a tab-color or theme override inside the same profile object for a visual cue:

```json
"tabColor": "#BA263C"
```

That tints the tab brand-red so you can see at a glance which window is the LoLMK one.
