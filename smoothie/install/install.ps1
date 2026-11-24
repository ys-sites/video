# Smoothie installer. DEFAULT IS A DRY RUN: it checks every step and measures sizes, and writes nothing.
#   powershell -ExecutionPolicy Bypass -File smoothie\install\install.ps1                 # dry run, all phases
#   powershell -ExecutionPolicy Bypass -File smoothie\install\install.ps1 -Phase 0        # dry run, one phase
#   ... -Install -IUnderstand -Phase 0                                                    # real install (only after "install now")
# Budget: refuses to continue if the planned total would pass 100 GB or free space would fall under 200 GB.
param([ValidateSet('0','1','2','all')][string]$Phase = 'all', [switch]$Install, [switch]$IUnderstand)
$ErrorActionPreference = 'Continue'   # native tools write progress to stderr; failures are checked with $LASTEXITCODE and throw
# The main checkout (holds the gitignored quarantine, captions venv and live site), even when run from a worktree.
$Repo    = Split-Path -Parent (git -C $PSScriptRoot rev-parse --path-format=absolute --git-common-dir)
$AILocal = 'C:\Users\Sharafath\AI-Local'
$Engines = "$AILocal\engines"
$uv      = 'C:\Users\Sharafath\AppData\Roaming\Python\Python314\Scripts\uv.exe'
$BudgetGB = 100; $MinFreeGB = 200
$env:PLAYWRIGHT_BROWSERS_PATH = "$AILocal\browsers"         # one shared Chromium for every engine
$Real = $Install -and $IUnderstand
if ($Install -and -not $IUnderstand) { throw 'Add -IUnderstand to confirm a real install (the user said "install now").' }

# Reviewed sources: repo, commit, tree hash (from smoothie/audit/verdicts.json). Clones are verified against the tree.
$Reviewed = @{
  'ffmpeg-skill'       = @('kajisho5/ffmpeg-skill',         'bad487c5c4c1d3db52893b27d5ff1278da5274a8', '2e35c1d379fd86bd9b66bfc5e7ffca3e82c09d58')
  'motion-educator'    = @('zeative/motion-educator',       '7ff07ee71d02ebc31ffc128da5a59351c413b1fd', '77a0767ddaf82f068c91dc1c7f1c367e5749fc21')
  'cinematic-film'     = @('Moh4696/cinematic-skill',       'bf435561c6203f90f971300efe952b68b5ec3417', '6cdd117eefee2ad398c3e2fade1b85aa0356b3c5')
  'still-to-film'      = @('AustinZ21/cinematic-skills',    '0e5b3fe575740cd022d9ffdec7b7568684c885a5', 'bf9662f15fcc528974ada6e41da68d8f18e838ef')
  'sfx-generator'      = @('thisisvela/sfx-generator-skill','a7c25d55911cc289b42a472350c60353efcda874', 'b911ee3b56ddefb44506d604cffdb6948bd79495')
  'stickman-director'  = @('kaomei/stickman-video-director','8394bec0148fa281ea59171d90fddc13afb80c4e', 'ff1dbfad4be9f91b95b3025506cb1b55654d6b6e')
  'paper2video'        = @('lunamos/paper2video',           'a8c966b1439dd41d38abbab2a309cb2415cf409f', '94624d0cc572028e50cfb95db1cc5fb780467842')
}
$results = New-Object System.Collections.ArrayList
function Report($name, $ok, $cmd, $note, $gb) {
  [void]$results.Add([pscustomobject]@{Step=$name; Result=$(if($ok){'PASS'}else{'FAIL'}); GB=$gb; Command=$cmd; Note=$note})
  Write-Host ("[{0}] {1}  ({2} GB)  {3}" -f $(if($ok){'PASS'}else{'FAIL'}), $name, $gb, $note)
}
function FreeGB { [math]::Round((Get-PSDrive C).Free / 1GB, 1) }
function Git-Hardened { & git -c credential.helper= -c core.hooksPath=NUL -c core.symlinks=false -c core.longpaths=true -c filter.lfs.smudge= -c filter.lfs.required=false -c protocol.file.allow=never @args }

function Engine($key, $gb, [scriptblock]$after) {
  $r = $Reviewed[$key]; $dest = "$Engines\$key@$($r[1].Substring(0,7))"
  if (-not $Real) {
    $remote = (Git-Hardened ls-remote "https://github.com/$($r[0]).git" HEAD 2>$null)
    $q = "$Repo\resources\repo-quarantine\$($r[0])"
    $tree = if (Test-Path $q) { (git -C $q rev-parse 'HEAD^{tree}') } else { '' }
    $head = if ($remote) { ($remote -split "`t")[0].Substring(0,7) } else { 'unreachable' }
    Report "engine $key" ($tree -eq $r[2] -and $remote) "git fetch --depth 1 $($r[0]) $($r[1])" ("reviewed tree matches quarantine: $($tree -eq $r[2]); upstream HEAD now $head; dest $dest") $gb
    return
  }
  if (Test-Path $dest) { Report "engine $key" $true '' 'already installed' 0; return }
  New-Item -ItemType Directory -Force $dest | Out-Null
  Git-Hardened -C $dest init -q; Git-Hardened -C $dest fetch -q --depth 1 "https://github.com/$($r[0]).git" $r[1]; Git-Hardened -C $dest checkout -q FETCH_HEAD
  $tree = git -C $dest rev-parse 'HEAD^{tree}'
  if ($tree -ne $r[2]) { Remove-Item -Recurse -Force $dest; throw "tree mismatch for $key; removed" }
  if ($after) { & $after $dest }
  Report "engine $key" $true "fetched $($r[1])" "tree verified; $dest" $gb
}

Write-Host ("Smoothie install - {0} - phase {1} - free space {2} GB" -f $(if($Real){'INSTALL'}else{'DRY RUN'}), $Phase, (FreeGB))

# ---------- Phase 0: quick wins ----------
if ($Phase -in '0','all') {
  # 0.1 Vite app: GSAP, three.js, lottie-web only (motion is already in package.json; anime/tween/mojs/konva/pixi are duplicates)
  $pk = 'gsap@3.15.1 three@0.187.0 lottie-web@5.13.0'
  Push-Location $Repo
  if ($Real) {
    npm install --save-exact --ignore-scripts --no-audit --no-fund gsap@3.15.1 three@0.187.0 lottie-web@5.13.0
    $ok01 = ($LASTEXITCODE -eq 0); npm run lint; $ok01 = $ok01 -and ($LASTEXITCODE -eq 0)
    npm run build; $ok01 = $ok01 -and ($LASTEXITCODE -eq 0)          # dist/ only; the live output (master-video-styles/editor) is untouched
    if (-not $ok01) { git -C $Repo checkout -- package.json package-lock.json; npm install --ignore-scripts --no-audit --no-fund; throw 'site lint/build failed after adding motion libs: reverted' }
  }
  else { $o = npm install --dry-run --ignore-scripts --no-audit --no-fund gsap@3.15.1 three@0.187.0 lottie-web@5.13.0 2>&1 | Out-String }
  Pop-Location
  Report '0.1 npm motion libs (Vite app)' ($Real -or $LASTEXITCODE -eq 0) "npm install --save-exact --ignore-scripts $pk" 'no install hooks in any of the three; site build must pass after' 0.06

  # 0.2 Shared Python venv for video engines (Manim, film engine, depth plates, sfx). torch pinned to ComfyUI's version so uv hardlinks it (no second copy).
  $venv = "$AILocal\venvs\video-py"
  $pkgs = @('manim==0.19.*','numpy','scipy','pillow','opencv-python-headless','skia-python','soundfile','torch==2.15.0+cpu','transformers')
  if ($Real) { & $uv venv --python 3.12 $venv; & $uv pip install --python "$venv\Scripts\python.exe" --index-url https://pypi.org/simple --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match @pkgs }
  else {
    $req = Join-Path $env:TEMP 'smoothie-video-py.in'; $lock = Join-Path $env:TEMP 'smoothie-video-py.lock'
    Set-Content -Encoding ascii $req ($pkgs -join "`n")
    $o = & $uv pip compile $req -o $lock --python-version 3.12 --python-platform windows --index-url https://pypi.org/simple --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match 2>&1 | Out-String
    $ok = ($LASTEXITCODE -eq 0)
    if ($ok) { Copy-Item $lock "$PSScriptRoot\video-py.lock.txt" -Force }   # the resolved set, reviewed before install
  }
  Report '0.2 shared venv video-py (manim + engines)' ($Real -or $ok) "uv pip install $($pkgs -join ' ')" 'one venv for all Python video engines; torch hardlinked from the uv cache' 1.3

  # 0.3 ComfyUI first test render (already installed; models already verified)
  $comfy = Test-Path "$AILocal\ComfyUI\.venv\Scripts\python.exe"
  Report '0.3 ComfyUI LTX/Wan test render' $comfy 'python main.py --cpu, then gpu\comfy_job.py ltx_test.json (512x320, 25 frames)' 'run only after install now; 15-40 min CPU' 0
  # 0.4 captions-skill on a real video (approval frames 1.5/4/8 s)
  Report '0.4 captions-skill + shared Whisper small' ((Test-Path "$Repo\captions-skill\.venv") -and (Test-Path "$env:USERPROFILE\.cache\huggingface\hub\models--Systran--faster-whisper-small")) 'setx WHISPER_MODEL small; words.py <video>; render.js --still 1.5 --still 4 --still 8' 'reuses the cached small model instead of downloading base' 0
  # 0.5 OmniVoice
  Report '0.5 OmniVoice (setup-tier1.ps1 -Tool omnivoice)' (Test-Path "$AILocal\setup-tier1.ps1") "$AILocal\setup-tier1.ps1 -Tool omnivoice" ("already set up: " + (Test-Path "$AILocal\OmniVoice\.venv")) 0.5
}

# ---------- Phase 1: engines into AI-Local\engines (outside the repo, never committed) ----------
if ($Phase -in '1','all') {
  Engine 'ffmpeg-skill' 0.03 $null
  Engine 'sfx-generator' 0.01 { param($d) & $uv pip install --python "$AILocal\venvs\video-py\Scripts\python.exe" --no-deps -e $d }
  Engine 'cinematic-film' 0.01 $null
  Engine 'still-to-film' 1.31 $null     # + Depth Anything V2 Large safetensors (1.3 GB) fetched on first use; always run prep_plate.py with --no-upscale
  Engine 'motion-educator' 0.35 { param($d) Push-Location $d; npm ci --ignore-scripts; npx playwright@1 install chromium; Pop-Location }
  Engine 'stickman-director' 0.05 $null
  Engine 'paper2video' 0.01 $null
  # Shared JS video workspace: one node_modules for HyperFrames + every Remotion project (one headless Chrome)
  $ws = "$AILocal\engines\video-js"
  if ($Real) { New-Item -ItemType Directory -Force $ws | Out-Null; Push-Location $ws; npm init -y | Out-Null; npm install --save-exact --ignore-scripts hyperframes@0.9.87; Pop-Location }
  else { $o = npm view hyperframes@0.9.87 version scripts.postinstall --json 2>&1 | Out-String; $ok = $o -match '0.9.87' -and $o -notmatch 'postinstall' }
  Report '1.x shared JS workspace (HyperFrames 0.9.87)' ($Real -or $ok) 'npm install --save-exact --ignore-scripts hyperframes@0.9.87' 'Remotion projects later move their node_modules here (saves ~0.4 GB each)' 0.6
}

# ---------- Phase 2: merged skills into the project ----------
if ($Phase -in '2','all') {
  $skills = Get-ChildItem "$PSScriptRoot\..\skills" -Directory
  foreach ($s in $skills) {
    $dest = "$Repo\.claude\skills\$($s.Name)"
    $ok = (Test-Path "$($s.FullName)\SKILL.md") -and ((Get-Content "$($s.FullName)\SKILL.md" -TotalCount 3) -match "^name: $($s.Name)$")
    if ($Real) { Copy-Item -Recurse -Force $s.FullName $dest }
    Report "2 skill $($s.Name)" $ok "copy to .claude\skills\$($s.Name)" $(if(Test-Path $dest){'already present'}else{'frontmatter ok'}) 0
  }
}

# ---------- Budget ----------
$planned = ($results | Measure-Object GB -Sum).Sum
$free = FreeGB
Write-Host ("Planned local storage: {0:N2} GB of {1} GB budget. Free now: {2} GB (floor {3} GB)." -f $planned, $BudgetGB, $free, $MinFreeGB)
if ($planned -gt $BudgetGB -or ($free - $planned) -lt $MinFreeGB) { throw 'Budget exceeded: stop and ask the user.' }
$fails = @($results | Where-Object Result -eq 'FAIL').Count
$results | Export-Csv -NoTypeInformation -Encoding UTF8 "$PSScriptRoot\last-run-$(if($Real){'install'}else{'dryrun'}).csv"
Write-Host ("{0} steps, {1} failed." -f $results.Count, $fails)
if ($fails) { exit 1 }
