@echo off
setlocal
chcp 65001 >nul
title Yandex Music Fisher Mod - autoinstall
set "YMF_SRC=%~dp0"
set "YMF_CMD=%~f0"
set "YMF_PAYLOAD=#__PS_PAYLOAD__#"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try{[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding $false}catch{}; $t=[IO.File]::ReadAllText($env:YMF_CMD,[Text.Encoding]::UTF8); $m=$env:YMF_PAYLOAD; $i=$t.LastIndexOf($m); if($i -lt 0){Write-Host 'PS payload not found' -ForegroundColor Red; exit 2}; Invoke-Expression $t.Substring($i+$m.Length)"

set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [x] Скрипт завершился с ошибкой, код %RC%.
if /i not "%YMF_NOPAUSE%"=="1" pause
exit /b %RC%
#__PS_PAYLOAD__#
# ============================================================================
#  Yandex Music Fisher Mod - автоустановка в Chromium-браузеры
#  Ядро скрипта (выполняется в PowerShell 5.1+)
# ============================================================================

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
try { $OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

$script:Root          = if ($env:YMF_SRC) { $env:YMF_SRC.TrimEnd([char]92) } else { (Get-Location).Path }
$script:ExtDir        = $script:Root
$script:DesktopDir    = [Environment]::GetFolderPath('Desktop')
$script:StartMenuDir  = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Yandex Music Fisher'
$script:ShortcutPrefix = 'Yandex Music Fisher - '

$script:SmiRoots = @(
    'HKLM:\SOFTWARE\Clients\StartMenuInternet',
    'HKLM:\SOFTWARE\WOW6432Node\Clients\StartMenuInternet',
    'HKCU:\SOFTWARE\Clients\StartMenuInternet'
)
$script:AppPathRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths'
)

# ----------------------------------------------------------------------------
#  Оформление
# ----------------------------------------------------------------------------
function Write-Head([string]$text) {
    Write-Host ''
    Write-Host ('=' * 74) -ForegroundColor DarkCyan
    Write-Host ('  ' + $text) -ForegroundColor Cyan
    Write-Host ('=' * 74) -ForegroundColor DarkCyan
}
function Write-Step([string]$text) { Write-Host ''; Write-Host ('  ' + $text) -ForegroundColor White }
function Write-Ok([string]$text)   { Write-Host ('  [OK] ' + $text) -ForegroundColor Green }
function Write-Warn([string]$text) { Write-Host ('  [!]  ' + $text) -ForegroundColor Yellow }
function Write-Err([string]$text)  { Write-Host ('  [x]  ' + $text) -ForegroundColor Red }
function Write-Info([string]$text) { Write-Host ('       ' + $text) -ForegroundColor Gray }
function Write-Hint([string]$text) { Write-Host ('       ' + $text) -ForegroundColor DarkGray }
function Read-Input([string]$prompt) {
    Write-Host ('  ' + $prompt + ' ') -NoNewline -ForegroundColor White
    return (Read-Host)
}

# ----------------------------------------------------------------------------
#  Данные о браузерах
# ----------------------------------------------------------------------------
$script:Defs = @(
    [pscustomobject]@{
        Id='chrome'; Name='Google Chrome'; ExtPage='chrome://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%ProgramFiles%\Google\Chrome\Application\chrome.exe',
            '%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe',
            '%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe'
        )
        RegKeys=@('Google Chrome'); AppPaths=@()
    }
    [pscustomobject]@{
        Id='edge'; Name='Microsoft Edge'; ExtPage='edge://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe',
            '%ProgramFiles%\Microsoft\Edge\Application\msedge.exe',
            '%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe'
        )
        RegKeys=@('Microsoft Edge'); AppPaths=@('msedge.exe')
    }
    [pscustomobject]@{
        Id='yandex'; Name='Яндекс Браузер'; ExtPage='browser://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%LOCALAPPDATA%\Yandex\YandexBrowser\Application\browser.exe',
            '%ProgramFiles%\Yandex\YandexBrowser\Application\browser.exe',
            '%ProgramFiles(x86)%\Yandex\YandexBrowser\Application\browser.exe'
        )
        RegKeys=@('YandexBrowser'); AppPaths=@('browser.exe')
    }
    [pscustomobject]@{
        Id='opera'; Name='Opera'; ExtPage='opera://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%LOCALAPPDATA%\Programs\Opera\opera.exe',
            '%LOCALAPPDATA%\Programs\Opera\launcher.exe',
            '%ProgramFiles%\Opera\opera.exe',
            '%ProgramFiles(x86)%\Opera\opera.exe'
        )
        RegKeys=@('OperaStable'); AppPaths=@('opera.exe')
    }
    [pscustomobject]@{
        Id='operagx'; Name='Opera GX'; ExtPage='opera://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%LOCALAPPDATA%\Programs\Opera GX\opera.exe',
            '%LOCALAPPDATA%\Programs\Opera GX\launcher.exe',
            '%ProgramFiles%\Opera GX\opera.exe',
            '%ProgramFiles(x86)%\Opera GX\opera.exe'
        )
        RegKeys=@('OperaGXStable'); AppPaths=@()
    }
    [pscustomobject]@{
        Id='brave'; Name='Brave'; ExtPage='brave://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe',
            '%ProgramFiles(x86)%\BraveSoftware\Brave-Browser\Application\brave.exe',
            '%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe'
        )
        RegKeys=@('Brave'); AppPaths=@('brave.exe')
    }
    [pscustomobject]@{
        Id='vivaldi'; Name='Vivaldi'; ExtPage='vivaldi://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%LOCALAPPDATA%\Vivaldi\Application\vivaldi.exe',
            '%ProgramFiles%\Vivaldi\Application\vivaldi.exe',
            '%ProgramFiles(x86)%\Vivaldi\Application\vivaldi.exe'
        )
        RegKeys=@('Vivaldi'); AppPaths=@('vivaldi.exe')
    }
    [pscustomobject]@{
        Id='ungoogled'; Name='Ungoogled Chromium'; ExtPage='chrome://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%LOCALAPPDATA%\Chromium\Application\chrome.exe',
            '%ProgramFiles%\Chromium\Application\chrome.exe',
            '%ProgramFiles%\ungoogled-chromium\chrome.exe',
            '%LOCALAPPDATA%\ungoogled-chromium\chrome.exe'
        )
        RegKeys=@('Chromium'); AppPaths=@()
    }
    [pscustomobject]@{
        Id='gost'; Name='Chromium-Gost'; ExtPage='chrome://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%ProgramFiles%\Chromium-Gost\chrome.exe',
            '%ProgramFiles(x86)%\Chromium-Gost\chrome.exe',
            '%ProgramFiles%\Chromium-Gost\chromium-gost.exe',
            '%LOCALAPPDATA%\Chromium-Gost\chrome.exe',
            '%LOCALAPPDATA%\Chromium-Gost\chromium-gost.exe'
        )
        RegKeys=@('Chromium-Gost','Chromium GOST'); AppPaths=@('chromium-gost.exe')
    }
    [pscustomobject]@{
        Id='ghost'; Name='Ghost Browser'; ExtPage='chrome://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%LOCALAPPDATA%\GhostBrowser\Application\GhostBrowser.exe',
            '%LOCALAPPDATA%\Programs\GhostBrowser\GhostBrowser.exe',
            '%ProgramFiles%\GhostBrowser\GhostBrowser.exe',
            '%ProgramFiles(x86)%\GhostBrowser\GhostBrowser.exe'
        )
        RegKeys=@('Ghost Browser'); AppPaths=@('GhostBrowser.exe')
    }
    [pscustomobject]@{
        Id='arc'; Name='Arc'; ExtPage='arc://extensions/'; ManualOnly=$true
        ManualNote='Arc не поддерживает запуск с --load-extension, нужна ручная установка'
        Paths=@(
            '%LOCALAPPDATA%\Microsoft\Arc\Arc.exe',
            '%LOCALAPPDATA%\TheBrowserCompany\Arc\Arc.exe',
            '%LOCALAPPDATA%\Microsoft\WindowsApps\Arc.exe'
        )
        RegKeys=@(); AppPaths=@('Arc.exe')
    }
    [pscustomobject]@{
        Id='iron'; Name='SRWare Iron'; ExtPage='chrome://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%ProgramFiles(x86)%\SRWare Iron\iron.exe',
            '%ProgramFiles%\SRWare Iron\iron.exe',
            '%LOCALAPPDATA%\SRWare Iron\iron.exe'
        )
        RegKeys=@('SRWare Iron'); AppPaths=@('iron.exe')
    }
    [pscustomobject]@{
        Id='cent'; Name='Cent Browser'; ExtPage='chrome://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%LOCALAPPDATA%\CentBrowser\Application\chrome.exe',
            '%ProgramFiles%\CentBrowser\Application\chrome.exe',
            '%ProgramFiles(x86)%\CentBrowser\Application\chrome.exe',
            '%LOCALAPPDATA%\CentBrowser\Application\centbrowser.exe'
        )
        RegKeys=@('CentBrowser'); AppPaths=@('centbrowser.exe')
    }
    [pscustomobject]@{
        Id='thorium'; Name='Thorium'; ExtPage='chrome://extensions/'; ManualOnly=$false; ManualNote=''
        Paths=@(
            '%LOCALAPPDATA%\Thorium\Application\thorium.exe',
            '%ProgramFiles%\Thorium\Application\thorium.exe',
            '%ProgramFiles(x86)%\Thorium\Application\thorium.exe',
            '%LOCALAPPDATA%\Thorium\Application\chrome.exe'
        )
        RegKeys=@('Thorium'); AppPaths=@('thorium.exe')
    }
)

# ----------------------------------------------------------------------------
#  Профили браузеров (для включения режима разработчика)
# ----------------------------------------------------------------------------
$script:ProfileRoots = @{
    chrome   = @('%LOCALAPPDATA%\Google\Chrome\User Data')
    edge     = @('%LOCALAPPDATA%\Microsoft\Edge\User Data')
    yandex   = @('%LOCALAPPDATA%\Yandex\YandexBrowser\User Data')
    opera    = @('%APPDATA%\Opera Software\Opera Stable')
    operagx  = @('%APPDATA%\Opera Software\Opera GX Stable')
    brave    = @('%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data')
    vivaldi  = @('%LOCALAPPDATA%\Vivaldi\User Data')
    ungoogled = @('%LOCALAPPDATA%\Chromium\User Data', '%LOCALAPPDATA%\ungoogled-chromium\User Data')
    gost     = @('%LOCALAPPDATA%\Chromium-Gost\User Data', '%LOCALAPPDATA%\Chromium\User Data')
    ghost    = @('%LOCALAPPDATA%\GhostBrowser\User Data')
    arc      = @(
        '%LOCALAPPDATA%\Microsoft\Arc\User Data',
        '%LOCALAPPDATA%\TheBrowserCompany\Arc\User Data',
        '%LOCALAPPDATA%\Packages\TheBrowserCompany.Arc_ttt1ap7aakyb4\LocalCache\Local\Arc\User Data'
    )
    iron     = @('%LOCALAPPDATA%\SRWare Iron\User Data')
    cent     = @('%LOCALAPPDATA%\CentBrowser\User Data')
    thorium  = @('%LOCALAPPDATA%\Thorium\User Data')
}

# ----------------------------------------------------------------------------
#  Определение браузеров
# ----------------------------------------------------------------------------
function Get-RegDefault([string]$path) {
    try {
        $key = Get-Item -LiteralPath $path -ErrorAction Stop
        return $key.GetValue('')
    } catch {
        return $null
    }
}

function Get-ExeFromCommand([string]$cmd) {
    if (-not $cmd) { return $null }
    $cmd = $cmd.Trim()
    if ($cmd.StartsWith('"')) {
        $end = $cmd.IndexOf('"', 1)
        if ($end -gt 1) { return $cmd.Substring(1, $end - 1) }
    }
    $m = [regex]::Match($cmd, '^(.*?\.exe)(\s|$)', 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value.Trim('"') }
    return $null
}

function Resolve-Browser($def) {
    foreach ($raw in $def.Paths) {
        $p = [Environment]::ExpandEnvironmentVariables($raw)
        if (Test-Path -LiteralPath $p -PathType Leaf) { return (Get-Item -LiteralPath $p) }
    }
    foreach ($keyName in $def.RegKeys) {
        foreach ($base in $script:SmiRoots) {
            $cmd = Get-RegDefault (Join-Path $base ($keyName + '\shell\open\command'))
            $exe = Get-ExeFromCommand $cmd
            if ($exe -and (Test-Path -LiteralPath $exe -PathType Leaf)) { return (Get-Item -LiteralPath $exe) }
        }
    }
    foreach ($ap in $def.AppPaths) {
        foreach ($base in $script:AppPathRoots) {
            $p = Get-RegDefault (Join-Path $base $ap)
            if ($p) {
                $p = $p.Trim('"')
                if (Test-Path -LiteralPath $p -PathType Leaf) { return (Get-Item -LiteralPath $p) }
            }
        }
    }
    return $null
}

function Get-BrowserVersion($item) {
    try {
        $v = $item.VersionInfo.ProductVersion
        if (-not $v) { $v = $item.VersionInfo.FileVersion }
        return $v
    } catch {
        return ''
    }
}

function Get-MajorVersion([string]$version) {
    if ($version -and $version -match '^(\d+)') { return [int]$Matches[1] }
    return 0
}

function Find-AllBrowsers {
    $list = @()
    foreach ($def in $script:Defs) {
        $item = Resolve-Browser $def
        if (-not $item) { continue }
        $version = Get-BrowserVersion $item
        $major = Get-MajorVersion $version
        $manual = [bool]$def.ManualOnly
        $note = $def.ManualNote
        if ($def.Id -eq 'chrome' -and $major -ge 137) {
            $manual = $true
            $note = 'Chrome 137+ игнорирует --load-extension (защита Google)'
        }
        $profileRoots = @()
        if ($script:ProfileRoots.ContainsKey($def.Id)) {
            $profileRoots = @($script:ProfileRoots[$def.Id])
        }
        $list += [pscustomobject]@{
            Id = $def.Id
            Name = $def.Name
            Exe = $item.FullName
            Version = $version
            Major = $major
            ExtPage = $def.ExtPage
            Manual = $manual
            Note = $note
            ProfileRoots = $profileRoots
        }
    }
    return $list
}

# ----------------------------------------------------------------------------
#  Файлы расширения
# ----------------------------------------------------------------------------
function Get-SourceVersion {
    $mf = Join-Path $script:Root 'manifest.json'
    if (Test-Path -LiteralPath $mf) {
        try { return (Get-Content -LiteralPath $mf -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch {}
    }
    return '?'
}

function Test-ExtensionFiles {
    $manifest = Join-Path $script:ExtDir 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
        throw "В папке скрипта нет manifest.json: $script:ExtDir"
    }
    foreach ($required in @('js\service_worker.js', 'html\popup.html', 'icons')) {
        if (-not (Test-Path -LiteralPath (Join-Path $script:ExtDir $required))) {
            throw "В папке расширения не хватает: $required"
        }
    }
    $ver = '?'
    try {
        $ver = (Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
    } catch {}
    return $ver
}

# ----------------------------------------------------------------------------
#  Режим разработчика в профилях браузеров
# ----------------------------------------------------------------------------
function Get-ProfilePreferenceFiles($browser) {
    $seen = @{}
    $result = @()
    foreach ($raw in @($browser.ProfileRoots)) {
        if (-not $raw) { continue }
        $root = [Environment]::ExpandEnvironmentVariables($raw)
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }

        $candidates = @()
        $direct = Join-Path $root 'Preferences'
        if (Test-Path -LiteralPath $direct -PathType Leaf) { $candidates += $direct }
        foreach ($dir in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
            if ($dir.Name -in @('System Profile', 'Guest Profile')) { continue }
            $p = Join-Path $dir.FullName 'Preferences'
            if (Test-Path -LiteralPath $p -PathType Leaf) { $candidates += $p }
        }

        foreach ($p in $candidates) {
            $full = [IO.Path]::GetFullPath($p)
            if (-not $seen.ContainsKey($full)) {
                $seen[$full] = $true
                $result += $full
            }
        }
    }
    return $result
}

function Set-DeveloperModeInPreferences([string]$path) {
    $raw = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
    if (-not $raw.Trim()) { return 'failed' }
    $obj = $null
    try { $obj = $raw | ConvertFrom-Json } catch { return 'failed' }
    if ($null -eq $obj) { return 'failed' }

    if ($null -eq $obj.PSObject.Properties['extensions'] -or $null -eq $obj.extensions) {
        $obj | Add-Member -NotePropertyName extensions -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    $ext = $obj.extensions
    if ($null -eq $ext.PSObject.Properties['ui'] -or $null -eq $ext.ui) {
        $ext | Add-Member -NotePropertyName ui -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    $ui = $ext.ui
    if ($ui.PSObject.Properties['developer_mode'] -and $ui.developer_mode -eq $true) {
        return 'already'
    }
    $ui | Add-Member -NotePropertyName developer_mode -NotePropertyValue $true -Force

    $text = $obj | ConvertTo-Json -Depth 100 -Compress
    $null = $text | ConvertFrom-Json

    $backup = $path + '.ymf-backup'
    if (-not (Test-Path -LiteralPath $backup)) {
        Copy-Item -LiteralPath $path -Destination $backup -Force
    }
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))
    return 'patched'
}

function Enable-DeveloperMode($browser) {
    $result = [pscustomobject]@{ Patched = 0; Already = 0; Failed = 0; Profiles = 0 }
    foreach ($file in @(Get-ProfilePreferenceFiles $browser)) {
        $result.Profiles++
        try {
            switch (Set-DeveloperModeInPreferences $file) {
                'patched' { $result.Patched++ }
                'already' { $result.Already++ }
                default   { $result.Failed++ }
            }
        } catch {
            $result.Failed++
        }
    }
    return $result
}

# ----------------------------------------------------------------------------
#  Ярлыки
# ----------------------------------------------------------------------------
function Get-ShortcutPath($browser) {
    $safe = ($browser.Name -replace '[\\/:*?"<>|]', '')
    return (Join-Path $script:DesktopDir ($script:ShortcutPrefix + $safe + '.lnk'))
}

function New-BrowserShortcut($browser) {
    $lnk = Get-ShortcutPath $browser
    $arguments = '--load-extension="' + $script:ExtDir + '" --disable-features=DisableLoadExtensionCommandLineSwitch --no-first-run'
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnk)
    $sc.TargetPath = $browser.Exe
    $sc.Arguments = $arguments
    $sc.WorkingDirectory = [IO.Path]::GetDirectoryName($browser.Exe)
    $sc.IconLocation = $browser.Exe + ',0'
    $sc.Description = 'Yandex Music Fisher Mod - ' + $browser.Name
    $sc.Save()

    New-Item -ItemType Directory -Force -Path $script:StartMenuDir | Out-Null
    $safe = ($browser.Name -replace '[\\/:*?"<>|]', '')
    Copy-Item -LiteralPath $lnk -Destination (Join-Path $script:StartMenuDir ($safe + '.lnk')) -Force

    return $lnk
}

function Test-BrowserRunning($browser) {
    $procName = [IO.Path]::GetFileNameWithoutExtension($browser.Exe)
    return [bool](Get-Process -Name $procName -ErrorAction SilentlyContinue)
}

function Stop-BrowserProcess($browser) {
    $procName = [IO.Path]::GetFileNameWithoutExtension($browser.Exe)
    $procs = @(Get-Process -Name $procName -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) { return $true }

    Write-Info ("{0}: закрываю процесс(ы) ({1})..." -f $browser.Name, $procs.Count)
    try { & taskkill.exe /IM ($procName + '.exe') /F /T 2>$null | Out-Null } catch {}

    for ($i = 0; $i -lt 24; $i++) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-Process -Name $procName -ErrorAction SilentlyContinue)) { return $true }
    }
    $left = @(Get-Process -Name $procName -ErrorAction SilentlyContinue).Count
    Write-Warn ("{0}: осталось процессов: {1}" -f $browser.Name, $left)
    return ($left -eq 0)
}

# ----------------------------------------------------------------------------
#  Ручная установка
# ----------------------------------------------------------------------------
function Show-ManualSteps($browser) {
    Write-Host ''
    Write-Host ('  ' + $browser.Name + ':') -ForegroundColor White
    Write-Hint  '1. Убедитесь, что включён «Режим разработчика» (скрипт включает его автоматически).'
    Write-Hint  '2. Нажмите «Загрузить распакованное расширение» (Load unpacked).'
    Write-Hint  '3. В окне выбора папки вставьте путь (Ctrl+V) в поле имени и нажмите «Выбрать папку»:'
    Write-Host ('       ' + $script:ExtDir) -ForegroundColor Cyan
    Write-Hint  '4. Убедитесь, что расширение включено и закреплено на панели браузера.'
}

function Open-ManualInstall($browser) {
    try {
        Start-Process -FilePath $browser.Exe -ArgumentList $browser.ExtPage
    } catch {
        Write-Warn ("{0}: не удалось открыть страницу расширений ({1})" -f $browser.Name, $_.Exception.Message)
    }
}

function Copy-ExtensionPathToClipboard {
    try { Set-Clipboard -Value $script:ExtDir } catch {
        try { $script:ExtDir | clip.exe } catch {}
    }
}

# ----------------------------------------------------------------------------
#  Установка / удаление
# ----------------------------------------------------------------------------
function Invoke-Install($targets) {
    $targets = @($targets)
    if ($targets.Count -eq 0) {
        Write-Warn 'Нечего устанавливать: браузеры не выбраны.'
        return
    }

    Write-Step 'Проверка файлов расширения...'
    try {
        $ver = Test-ExtensionFiles
        Write-Ok ("Папка расширения: v{0}" -f $ver)
        Write-Info $script:ExtDir
    } catch {
        Write-Err $_.Exception.Message
        return
    }
    Copy-ExtensionPathToClipboard

    Write-Step 'Принудительное закрытие браузеров...'
    $running = @($targets | Where-Object { Test-BrowserRunning $_ })
    if ($running.Count -eq 0) {
        Write-Ok 'Запущенных браузеров нет.'
    } else {
        foreach ($b in $running) { Write-Warn ("{0}: запущен" -f $b.Name) }
        $answer = Read-Input 'Закрыть эти браузеры принудительно? (Y/n)'
        if ($answer -eq '' -or $answer -match '^(y|yes|д|да)') {
            foreach ($b in $running) {
                if (Stop-BrowserProcess $b) { Write-Ok ("{0}: закрыт" -f $b.Name) }
            }
        } else {
            Write-Warn 'Браузеры не закрыты: режим разработчика и автозагрузка могут не примениться.'
        }
    }

    Write-Step 'Включение режима разработчика...'
    foreach ($b in $targets) {
        if (Test-BrowserRunning $b) {
            Write-Warn ("{0}: браузер не закрыт, шаг пропущен" -f $b.Name)
            continue
        }
        $dm = Enable-DeveloperMode $b
        if ($dm.Patched -gt 0) {
            Write-Ok ("{0}: режим разработчика включён (профилей: {1})" -f $b.Name, $dm.Patched)
        } elseif ($dm.Already -gt 0) {
            Write-Ok ("{0}: режим разработчика уже включён" -f $b.Name)
        } elseif ($dm.Profiles -gt 0) {
            Write-Warn ("{0}: не удалось изменить настройки профиля, включите режим разработчика вручную" -f $b.Name)
        } else {
            Write-Warn ("{0}: профиль не найден, включите режим разработчика вручную" -f $b.Name)
        }
    }

    $shortcutBrowser = @()
    $manualBrowser = @()
    $created = @()

    foreach ($b in $targets) {
        if ($b.Manual) { $manualBrowser += $b; continue }
        try {
            $lnk = New-BrowserShortcut $b
            $created += $lnk
            $shortcutBrowser += $b
            Write-Ok ("{0}: ярлык создан" -f $b.Name)
            Write-Hint ("    " + $lnk)
        } catch {
            Write-Err ("{0}: не удалось создать ярлык ({1})" -f $b.Name, $_.Exception.Message)
            if (-not $b.Note) { $b.Note = 'ярлык создать не удалось' }
            $manualBrowser += $b
        }
    }

    if ($manualBrowser.Count -gt 0) {
        Write-Step 'Требуется ручное подтверждение в браузере:'
        foreach ($b in $manualBrowser) {
            Write-Warn ("{0}  -  {1}" -f $b.Name, $b.Note)
            Show-ManualSteps $b
        }
        Write-Host ''
        $answer = Read-Input 'Открыть страницы расширений и папку с файлами? (Y/n)'
        if ($answer -eq '' -or $answer -match '^(y|yes|д|да)') {
            foreach ($b in $manualBrowser) { Open-ManualInstall $b }
            try { Start-Process -FilePath 'explorer.exe' -ArgumentList $script:ExtDir } catch {}
            Write-Info 'Путь к папке скопирован в буфер обмена.'
        }
    }

    if ($shortcutBrowser.Count -gt 0) {
        Write-Host ''
        Write-Hint 'Ярлыки также добавлены в меню «Пуск» -> Yandex Music Fisher.'
        Write-Hint 'Важно: браузер должен быть полностью закрыт перед запуском ярлыка,'
        Write-Hint 'иначе он проигнорирует параметры загрузки расширения.'

        $answer = Read-Input 'Запустить созданные ярлыки для проверки? (y/N)'
        if ($answer -match '^(y|yes|д|да)') {
            foreach ($b in $shortcutBrowser) {
                if (Test-BrowserRunning $b) {
                    Write-Warn ("{0} уже запущен. Закройте его полностью и запустите ярлык вручную." -f $b.Name)
                    continue
                }
                try {
                    Start-Process -FilePath (Get-ShortcutPath $b)
                    Write-Ok ("{0}: запуск..." -f $b.Name)
                } catch {
                    Write-Err ("{0}: {1}" -f $b.Name, $_.Exception.Message)
                }
            }
        }
    }

    Write-Step 'Готово.'
    Write-Hint 'Для постоянной установки без ярлыка используйте ручной режим («Загрузить распакованное»).'
    Write-Hint 'Обновление: запустите autoinstall.cmd снова, затем нажмите «Обновить» на странице расширений.'
}

function Remove-Installation {
    Write-Step 'Удаление ярлыков и папки установки...'
    $removed = 0
    if (Test-Path -LiteralPath $script:DesktopDir) {
        Get-ChildItem -LiteralPath $script:DesktopDir -Filter ($script:ShortcutPrefix + '*.lnk') -File -ErrorAction SilentlyContinue | ForEach-Object {
            try { Remove-Item -LiteralPath $_.FullName -Force; $removed++ } catch {}
        }
    }
    if (Test-Path -LiteralPath $script:StartMenuDir) {
        try { Remove-Item -LiteralPath $script:StartMenuDir -Recurse -Force } catch {}
    }
    Write-Ok ("Удалено ярлыков: " + $removed)
    Write-Hint 'Папка с файлами расширения не удаляется - это папка, из которой запущен скрипт:'
    Write-Hint $script:ExtDir
    Write-Hint 'Расширения, установленные вручную через «Загрузить распакованное»,'
    Write-Hint 'удаляются на странице расширений соответствующего браузера.'
}

# ----------------------------------------------------------------------------
#  Интерфейс
# ----------------------------------------------------------------------------
function Show-Browsers($found) {
    Write-Step 'Найденные браузеры:'
    $i = 0
    foreach ($b in $found) {
        $i++
        $method = if ($b.Manual) { 'вручную' } else { 'ярлык' }
        $ver = if ($b.Version) { $b.Version } else { '?' }
        Write-Host ('   {0,2}. {1,-20} {2,-17} {3}' -f $i, $b.Name, $ver, $method)
    }
}

function Show-Details($found) {
    Write-Step 'Подробности:'
    foreach ($b in $found) {
        Write-Host ('  ' + $b.Name) -ForegroundColor White
        Write-Hint ('    exe:         ' + $b.Exe)
        Write-Hint ('    версия:      ' + $b.Version)
        Write-Hint ('    расширения:  ' + $b.ExtPage)
        Write-Hint ('    способ:      ' + $(if ($b.Manual) { 'ручной' } else { 'ярлык с --load-extension' }))
        if ($b.Note) { Write-Hint ('    примечание:  ' + $b.Note) }
    }
}

function Select-Browsers($found, [string]$raw) {
    if ($null -eq $raw -or $raw -eq '' -or $raw -match '^(a|all|все)$') { return @($found) }
    $indices = @()
    foreach ($part in ($raw -split '[,;\s]+')) {
        if ($part -eq '') { continue }
        if ($part -notmatch '^\d+$') { throw ("Не понял значение: " + $part) }
        $n = [int]$part
        if ($n -lt 1 -or $n -gt $found.Count) { throw ("Нет браузера с номером " + $n) }
        $indices += $n
    }
    if ($indices.Count -eq 0) { throw 'Ничего не выбрано.' }
    $selected = @()
    foreach ($n in ($indices | Sort-Object -Unique)) { $selected += $found[$n - 1] }
    return $selected
}

function New-ManualBrowser {
    Write-Host ''
    $raw = Read-Input 'Полный путь к .exe браузера:'
    if ($null -eq $raw -or $raw.Trim() -eq '') { return $null }
    $p = $raw.Trim('"').Trim()
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
        Write-Err ("Файл не найден: " + $p)
        return $null
    }
    if ([IO.Path]::GetExtension($p) -ne '.exe') {
        Write-Err 'Нужен файл .exe'
        return $null
    }
    $item = Get-Item -LiteralPath $p
    $ver = Get-BrowserVersion $item
    $major = Get-MajorVersion $ver
    $manual = $false
    $note = 'путь указан вручную'
    if ($item.Name -ieq 'chrome.exe' -and $major -ge 137 -and $p -match '\\Google\\Chrome\\') {
        $manual = $true
        $note = 'Chrome 137+ игнорирует --load-extension'
    }
    $profileRoots = @()
    $parent = [IO.Path]::GetDirectoryName($item.FullName)
    if ([IO.Path]::GetFileName($parent) -ieq 'Application') {
        $appRoot = [IO.Path]::GetDirectoryName($parent)
        if ($appRoot) { $profileRoots = @(Join-Path $appRoot 'User Data') }
    }
    return [pscustomobject]@{
        Id = 'manual'; Name = $item.BaseName; Exe = $item.FullName; Version = $ver; Major = $major
        ExtPage = 'chrome://extensions/'; Manual = $manual; Note = $note; ProfileRoots = $profileRoots
    }
}

function Show-Header($sourceVersion) {
    Write-Head ('Yandex Music Fisher Mod ' + $sourceVersion + ' - установка в браузеры')
    Write-Info ('Папка расширения: ' + $script:ExtDir)
    Write-Info 'Папка расширения - та, из которой запущен autoinstall.cmd.'
}

function Show-Menu {
    Write-Host ''
    Write-Host '  Действия:' -ForegroundColor White
    Write-Host '    [A]  Установить во все найденные браузеры'
    Write-Host '    [1,2,..]  Установить в выбранные (номера через запятую)'
    Write-Host '    [P]  Указать путь к браузеру вручную'
    Write-Host '    [D]  Подробная информация'
    Write-Host '    [U]  Удалить ярлыки установки'
    Write-Host '    [Q]  Выход'
}

# ----------------------------------------------------------------------------
#  Запуск
# ----------------------------------------------------------------------------
function Main {
    $sourceVersion = Get-SourceVersion
    Show-Header $sourceVersion

    Write-Step 'Поиск Chromium-браузеров...'
    $found = @(Find-AllBrowsers)

    if ($found.Count -eq 0) {
        Write-Warn 'Браузеры не найдены автоматически.'
        Write-Hint 'Установите браузер или укажите путь к его .exe через пункт [P].'
        Write-Hint 'Samsung Internet не имеет версии для Windows - установка невозможна.'
        return
    }

    Show-Browsers $found

    $known = @($script:Defs | ForEach-Object { $_.Name })
    $foundNames = @($found | ForEach-Object { $_.Name })
    $missing = @($known | Where-Object { $foundNames -notcontains $_ })
    Write-Host ''
    Write-Hint ('Не найдены: ' + ($missing -join ', '))
    Write-Hint 'Samsung Internet не имеет версии для Windows.'

    Write-Hint ''
    Write-Hint 'Chrome 137+ не загружает расширения из командной строки - для него'
    Write-Hint 'используется ручной режим «Загрузить распакованное» (2-3 клика).'
    Write-Hint 'Для остальных браузеров создаётся ярлык с автозагрузкой расширения.'
    Write-Hint 'Перед установкой скрипт принудительно закроет браузеры и включит'
    Write-Hint 'в их профилях режим разработчика.'

    while ($true) {
        Show-Menu
        $rawChoice = Read-Input 'Выбор:'
        if ($null -eq $rawChoice) { return }
        $choice = $rawChoice.Trim().ToLower()
        try {
            if ($choice -eq '' -or $choice -eq 'a' -or $choice -eq 'а' -or $choice -eq 'ф') {
                Invoke-Install $found
            }
            elseif ($choice -eq 'q' -or $choice -eq 'й') {
                return
            }
            elseif ($choice -eq 'd' -or $choice -eq 'д' -or $choice -eq 'в') {
                Show-Details $found
            }
            elseif ($choice -eq 'u' -or $choice -eq 'у' -or $choice -eq 'г') {
                $answer = Read-Input 'Удалить ярлыки установки? (y/N)'
                if ($answer -match '^(y|yes|д|да)') { Remove-Installation }
            }
            elseif ($choice -eq 'p' -or $choice -eq 'п' -or $choice -eq 'з') {
                $b = New-ManualBrowser
                if ($b) { Invoke-Install @($b) }
            }
            else {
                Invoke-Install (Select-Browsers $found $choice)
            }
        } catch {
            Write-Err $_.Exception.Message
        }
    }
}

try {
    Main
    exit 0
} catch {
    Write-Err $_.Exception.Message
    Write-Host ''
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    exit 1
}
