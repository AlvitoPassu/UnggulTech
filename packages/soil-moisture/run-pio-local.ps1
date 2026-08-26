$env:PLATFORMIO_CORE_DIR = Join-Path $PSScriptRoot ".pio-core"
$env:PLATFORMIO_PACKAGES_DIR = Join-Path $PSScriptRoot ".pio-local\packages"
$env:PLATFORMIO_PLATFORMS_DIR = Join-Path $PSScriptRoot ".pio-local\platforms"

if ($args.Count -eq 0) {
  pio run
} else {
  pio @args
}
