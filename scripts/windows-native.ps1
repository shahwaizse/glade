param(
  [Parameter(Mandatory = $true)]
  [string]$CommandName,

  [Parameter(Mandatory = $true)]
  [string]$RepoPath,

  [Parameter(Mandatory = $true)]
  [string]$NodeDir
)

$ErrorActionPreference = "Stop"

$env:Path = "$NodeDir;$env:Path"
Set-Location $RepoPath

function Stop-GladeElectron {
  Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Path -like "$RepoPath*"
    } |
    Stop-Process -Force
}

switch ($CommandName) {
  "install" {
    & npm.cmd install
    break
  }
  "build" {
    & npm.cmd run build
    break
  }
  "start" {
    Stop-GladeElectron
    & npm.cmd run build
    & npm.cmd start
    break
  }
  "dev" {
    Stop-GladeElectron
    & npm.cmd run dev
    break
  }
  default {
    throw "Unknown command '$CommandName'. Expected install, build, start, or dev."
  }
}
