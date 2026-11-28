param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path,
  [string]$OutputDirectory = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$manifest = Get-Content (Join-Path $PSScriptRoot 'release-files.json') -Raw | ConvertFrom-Json
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $env:LOCALAPPDATA "NexoGuard/private-source-packages/$($manifest.release)"
}
if (Test-Path -LiteralPath $OutputDirectory) { throw 'El destino ya existe. Conserva el paquete anterior y elige otro directorio nuevo.' }
$roles = @('back','transport','migration','front','gateway')
$images = @()
$imageMetadata = @()
foreach ($role in $roles) {
  $tag = "nexoguard-ec2-${role}:$($manifest.release)"
  $info = docker image inspect --format '{{.Id}}|{{.Os}}|{{.Architecture}}' $tag
  if ($LASTEXITCODE -ne 0) { throw "Falta la imagen $role" }
  $parts = $info -split '\|'
  if ($parts.Count -ne 3 -or $parts[1] -ne 'linux' -or $parts[2] -ne 'amd64') { throw "Arquitectura incorrecta: $role" }
  $images += $tag
  $imageMetadata += [ordered]@{ role=$role; image=$tag; id=$parts[0]; os=$parts[1]; architecture=$parts[2] }
}
$sourceFiles = @()
foreach ($repo in @('back','front')) {
  foreach ($group in $manifest.repositories.$repo) {
    foreach ($file in $group.files) { $sourceFiles += "$repo/$file" }
  }
  foreach ($asset in @('LICENSE','NOTICE','logo.png','preview.png')) { $sourceFiles += "$repo/$asset" }
}
$sourceFiles += @($manifest.operationalFiles)
$sourceFiles = @($sourceFiles | Sort-Object -Unique)
$configFiles = @($manifest.configFiles)
$fileMetadata = @()
foreach ($file in @($sourceFiles + $configFiles | Sort-Object -Unique)) {
  if ($file -match '(^|/)(\.git|node_modules|bd|docs|AGENTS\.md)(/|$)' -or $file -match '\.(pem|key|pfx|p12|crt|dump|gpg)$' -or ($file -match '(^|/)\.env($|\.)' -and $file -notmatch '(^|/)\.env\.example$')) { throw "Archivo fuera de la selección pública: $file" }
  $path = Join-Path $Root $file
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Falta un archivo del inventario: $file" }
  $fileMetadata += [ordered]@{ path=$file; sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
}
New-Item -ItemType Directory -Path $OutputDirectory -ErrorAction Stop | Out-Null
docker save --output (Join-Path $OutputDirectory 'images.tar') @images
if ($LASTEXITCODE -ne 0) { throw 'Falló la exportación de imágenes; conservar el directorio para revisar.' }
Push-Location $Root
try {
  tar -czf (Join-Path $OutputDirectory 'config.tar.gz') -- @configFiles
  if ($LASTEXITCODE -ne 0) { throw 'Falló el paquete de configuración' }
  tar -czf (Join-Path $OutputDirectory 'source-changes.tar.gz') -- @sourceFiles
  if ($LASTEXITCODE -ne 0) { throw 'Falló el paquete de cambios para revisión' }
} finally { Pop-Location }
$utf8 = [Text.UTF8Encoding]::new($false)
$metadata = [ordered]@{ release=$manifest.release; createdUtc=[DateTime]::UtcNow.ToString('o'); scope='Local prepared update; not deployed; no secrets'; images=$imageMetadata; files=$fileMetadata }
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'release.json'), ($metadata | ConvertTo-Json -Depth 8) + "`n", $utf8)
$checksums = @()
foreach ($name in @('images.tar','config.tar.gz','source-changes.tar.gz','release.json')) {
  $checksums += (Get-FileHash -LiteralPath (Join-Path $OutputDirectory $name) -Algorithm SHA256).Hash.ToLowerInvariant() + "  $name"
}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'transfer.sha256'), ($checksums -join "`n") + "`n", [Text.Encoding]::ASCII)
# Verify file members without extracting private operational files into repositories.
foreach ($archive in @(@{ Name='config.tar.gz'; Files=$configFiles }, @{ Name='source-changes.tar.gz'; Files=$sourceFiles })) {
  $members = @(tar -tzf (Join-Path $OutputDirectory $archive.Name))
  if ($LASTEXITCODE -ne 0 -or @(Compare-Object ($archive.Files | Sort-Object) ($members | Sort-Object)).Count -ne 0) { throw 'El inventario del paquete no coincide' }
}
Write-Output "PRIVATE_UPDATE_PACKAGE_READY=$OutputDirectory"
