@echo off
chcp 65001 >nul
title ZheXian Comic Studio - Build
cd /d "%~dp0"

:: PATH
set "PATH=C:\Program Files\nodejs;%USERPROFILE%\.cargo\bin;%PATH%"

:: Disable incremental compilation to avoid Windows Defender file lock issues
set "CARGO_INCREMENTAL=0"

echo.
echo  ========================================
echo    ZheXian Comic Studio - Build Package
echo  ========================================
echo.

:: ============================================
:: Step 1: Check environment
:: ============================================
echo  [1/5] Checking build environment...
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found. Please install: https://nodejs.org/
    goto :error
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js %NODE_VER%

:: Check npm
where npm >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] npm not found.
    goto :error
)
for /f "tokens=*" %%i in ('npm -v') do set NPM_VER=%%i
echo  [OK] npm v%NPM_VER%

:: Check Rust
where rustc >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Rust not found. Please install: https://rustup.rs/
    goto :error
)
for /f "tokens=*" %%i in ('rustc --version') do set RUST_VER=%%i
echo  [OK] %RUST_VER%

:: Check Cargo
where cargo >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Cargo not found.
    goto :error
)
echo  [OK] Cargo ready
echo.

:: ============================================
:: Step 2: Install frontend dependencies
:: ============================================
echo  [2/5] Checking frontend dependencies...
echo.

if not exist "node_modules\vite" (
    echo  [INFO] Dependencies not found, installing...
    call npm install
    if errorlevel 1 (
        echo.
        echo  [ERROR] npm install failed. Check your network.
        goto :error
    )
    echo  [OK] Dependencies installed.
) else (
    echo  [OK] Dependencies ready.
)
echo.

:: ============================================
:: Step 3: Clean old build artifacts
:: ============================================
echo  [3/5] Cleaning old build artifacts...
echo.

if exist "dist" (
    rmdir /s /q "dist" >nul 2>&1
    echo  [OK] Cleaned dist/
)

if exist "src-tauri\target\release\bundle" (
    rmdir /s /q "src-tauri\target\release\bundle" >nul 2>&1
    echo  [OK] Cleaned old bundle/
)
echo.

:: ============================================
:: Step 4: Build frontend
:: ============================================
echo  [4/5] Building frontend...
echo.
echo  [INFO] Compiling TypeScript and bundling with Vite...

call npm run build
if errorlevel 1 (
    echo.
    echo  [ERROR] Frontend build failed.
    echo  [TIP]  Run "npm run typecheck" to check for type errors.
    goto :error
)
echo.
echo  [OK] Frontend build complete.
echo.

:: ============================================
:: Step 5: Build Tauri app (installer)
:: ============================================
echo  [5/5] Building Tauri desktop app (this may take a few minutes)...
echo.
echo  [INFO] Compiling Rust backend and generating installer...
echo  [INFO] First build may take 5-15 minutes, please wait...
echo.

call npx tauri build
if errorlevel 1 (
    echo.
    echo  [ERROR] Tauri build failed.
    echo  [TIP]  Check Rust compile errors or tauri.conf.json config.
    goto :error
)

echo.
echo  ========================================
echo    BUILD COMPLETE!
echo  ========================================
echo.
echo  Output location:
echo.
echo    MSI installer:
echo      src-tauri\target\release\bundle\msi\
echo.
echo    NSIS installer (.exe):
echo      src-tauri\target\release\bundle\nsis\
echo.
echo  ========================================
echo.

:: Open output directory
if exist "src-tauri\target\release\bundle\nsis" (
    echo  [INFO] Opening NSIS installer directory...
    explorer "src-tauri\target\release\bundle\nsis"
) else if exist "src-tauri\target\release\bundle\msi" (
    echo  [INFO] Opening MSI installer directory...
    explorer "src-tauri\target\release\bundle\msi"
)

goto :done

:error
echo.
echo  ========================================
echo    BUILD FAILED - See errors above.
echo  ========================================
echo.

:done
echo.
echo  Press any key to exit...
pause >nul
