# PowerShell twin of solution.sh. Run from the repository root.
#   .\dataverse\scripts\solution.ps1 clone|init|sync|build|import|push
param([Parameter(Mandatory)][ValidateSet("clone", "init", "sync", "build", "import", "push")][string]$Command)
$ErrorActionPreference = "Stop"
$Solution = if ($env:SOLUTION) { $env:SOLUTION } else { "ContosoCollections" }
$Prefix = if ($env:PUBLISHER_PREFIX) { $env:PUBLISHER_PREFIX } else { "contoso" }
$SolDir = "dataverse/solution/$Solution"
$PcfDir = "pcf/CollectionsBridge"

switch ($Command) {
  "clone" {
    New-Item -ItemType Directory -Force dataverse/solution | Out-Null
    Push-Location dataverse/solution; pac solution clone --name $Solution --processCanvasApps false; Pop-Location
    Push-Location $SolDir; pac solution add-reference --path "../../../$PcfDir"; Pop-Location
  }
  "init" {
    New-Item -ItemType Directory -Force $SolDir | Out-Null
    Push-Location $SolDir
    pac solution init --publisher-name Contoso --publisher-prefix $Prefix
    pac solution add-reference --path "../../../$PcfDir"
    Pop-Location
  }
  "sync" { Push-Location $SolDir; pac solution sync; Pop-Location }
  "build" {
    npm run build:prod -w $PcfDir
    Push-Location $SolDir; dotnet build -c Release; Pop-Location
    Get-ChildItem "$SolDir/bin/Release/*.zip"
  }
  "import" {
    $zip = Get-ChildItem "$SolDir/bin/Release/*.zip" | Select-Object -First 1
    pac solution import --path $zip.FullName --publish-changes --activate-plugins
  }
  "push" { Push-Location $PcfDir; pac pcf push --publisher-prefix $Prefix; Pop-Location }
}
