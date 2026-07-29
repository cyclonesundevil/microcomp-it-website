$ErrorActionPreference = "Stop"

$routes = @(
    "https://www.microcompit.com/preview-review.html",
    "https://www.microcompit.com/demo-lab/llm-training-simulation.html"
)

foreach ($route in $routes) {
    Write-Host "`nHEAD $route"
    curl.exe -fsSIL $route

    Write-Host "`nGET $route"
    $body = curl.exe -fsSL $route
    if ($LASTEXITCODE -ne 0) {
        throw "GET failed for $route"
    }
    if ($body -notmatch "<title>" -or $body -notmatch "<h1") {
        throw "Response did not contain meaningful static HTML for $route"
    }
    Write-Host "Meaningful static HTML received."
}
