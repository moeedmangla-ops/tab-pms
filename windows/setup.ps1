# One-time setup on a Windows laptop. Run by double-clicking setup.bat.
. "$PSScriptRoot\common.ps1"

Step "Checking Node.js"
$nodeV = (& node -v) 2>$null
if (-not $nodeV) { throw "Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org (guide, step 1)." }
if ([int]($nodeV.TrimStart('v').Split('.')[0]) -lt 20) { throw "Node.js $nodeV is too old. Install Node.js 22 LTS from https://nodejs.org." }
Write-Host "    Node.js $nodeV"

Step "Checking PostgreSQL"
$pg = Find-PgBin
Write-Host "    Found $pg"

Step "Creating the database"
$sec = Read-Host "Type the password you chose for the 'postgres' user when installing PostgreSQL" -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$psql = Join-Path $pg "psql.exe"
& $psql -U postgres -h localhost -tAc "SELECT 1" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not sign in to PostgreSQL as 'postgres'. Check the password and that PostgreSQL is running." }
$dbPass = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
$hasUser = & $psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_roles WHERE rolname='tab'"
if ($hasUser -match '1') { & $psql -U postgres -h localhost -c "ALTER USER tab WITH PASSWORD '$dbPass';" | Out-Null }
else { & $psql -U postgres -h localhost -c "CREATE USER tab WITH PASSWORD '$dbPass' CREATEDB;" | Out-Null }
$hasDb = & $psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='tab_pms'"
if (-not ($hasDb -match '1')) { & $psql -U postgres -h localhost -c "CREATE DATABASE tab_pms OWNER tab;" | Out-Null }
if ($LASTEXITCODE -ne 0) { throw "Could not create the database." }
Remove-Item Env:\PGPASSWORD
Write-Host "    Database tab_pms is ready"

Step "Writing settings (.env)"
$secret = (& node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").Trim()
$hook = (& node -e "console.log(require('crypto').randomBytes(16).toString('hex'))").Trim()
$envText = @"
DATABASE_URL="postgresql://tab:$dbPass@localhost:5432/tab_pms?schema=public"
SESSION_SECRET="$secret"
APP_URL="http://localhost:3000"
SESSION_TIMEOUT_HOURS=8
COOKIE_SECURE="false"
MAIL_TRANSPORT="console"
LEAD_WEBHOOK_SECRET="$hook"
# Microsoft 365 (fill in after the app registration in docs\CONNECTORS.md, then remove the MAIL_TRANSPORT line)
GRAPH_TENANT_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=
GRAPH_SYNC_MAILBOXES=
ENTRA_TENANT_ID=
ENTRA_CLIENT_ID=
ENTRA_CLIENT_SECRET=
"@
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) { Copy-Item $envPath "$envPath.old" -Force; Write-Host "    Previous .env kept as .env.old" }
[IO.File]::WriteAllText($envPath, $envText, (New-Object Text.UTF8Encoding $false))

Step "Demo data or a clean start?"
$demo = Read-Host "Load the 20 demo clients and demo users? Type Y for a demo, N to start clean for real use"
if ($demo -match '^[Nn]') {
  $env:SEED_DEMO = "false"
  $env:SEED_ADMIN_EMAIL = Read-Host "Your email address (you will be the administrator)"
  do { $p = Read-Host "Choose an administrator password (at least 12 characters)" } while ($p.Length -lt 12)
  $env:SEED_ADMIN_PASSWORD = $p
} else { $env:SEED_DEMO = "true" }

Step "Installing (this takes a few minutes)"
Run "npm ci"
Run "npx prisma generate"
Run "npx prisma migrate deploy"
Run "npx tsx prisma/seed.ts"
Run "npm run build"

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
if ($env:SEED_DEMO -eq "false") { Write-Host "Sign in with $($env:SEED_ADMIN_EMAIL) and the password you just chose." }
else { Write-Host "Sign in as mp@tabconsultants.test with password TabDemo!2026" }
Write-Host "Next: double-click start.bat"
