<#
.SYNOPSIS
    Automated PostgreSQL database setup script for IoT Energy Analyzer.
.DESCRIPTION
    Creates the 'iot_energy_db' database and applies the minimal 2-table schema.sql.
#>

param (
    [string]$DbUser = "postgres",
    [string]$DbHost = "localhost",
    [int]$DbPort = 5432,
    [string]$DbName = "iot_energy_db",
    [string]$PsqlPath = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
)

if (-not (Test-Path $PsqlPath)) {
    $found = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($found) {
        $PsqlPath = $found.Source
    } else {
        Write-Error "Could not find psql.exe."
        exit 1
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Minimal 2-Table PostgreSQL Setup: $DbName" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not $env:PGPASSWORD) {
    $enteredPass = Read-Host "Enter password for PostgreSQL user '$DbUser'" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($enteredPass)
    $env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

# 1. Check if database exists
$checkDbCmd = "SELECT 1 FROM pg_database WHERE datname='$DbName';"
$dbExists = (& $PsqlPath -h $DbHost -p $DbPort -U $DbUser -t -A -c $checkDbCmd 2>&1).Trim()

if ($dbExists -ne "1") {
    Write-Host "Creating database '$DbName'..." -ForegroundColor Green
    & $PsqlPath -h $DbHost -p $DbPort -U $DbUser -c "CREATE DATABASE $DbName;"
} else {
    Write-Host "Database '$DbName' exists." -ForegroundColor Green
}

# 2. Apply schema.sql
$schemaFile = Join-Path $PSScriptRoot "schema.sql"
Write-Host "`nApplying 2-table schema from $schemaFile..." -ForegroundColor Yellow
& $PsqlPath -h $DbHost -p $DbPort -U $DbUser -d $DbName -f $schemaFile

Write-Host "`nInstalled Tables:" -ForegroundColor Cyan
& $PsqlPath -h $DbHost -p $DbPort -U $DbUser -d $DbName -c "\dt"
