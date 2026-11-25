@echo off
chcp 65001 >nul 2>&1
title Style AI Dev Server (HMR)
cd /d "%~dp0"

echo.
echo ============================================
echo   Style AI 本地开发模式 (无需构建 dist)
echo   前端 HMR 热更新 + 后端 API
echo ============================================
echo.

REM ===== 查找 Node.js =====
set "NODE_EXE="

where node >nul 2>nul
if errorlevel 1 goto :node_missing
set "NODE_EXE=node"

goto :found_node

:node_missing
if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    goto :found_node
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe"
    goto :found_node
)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
    goto :found_node
)
if exist "C:\nodejs\node.exe" (
    set "NODE_EXE=C:\nodejs\node.exe"
    goto :found_node
)

echo [错误] 未找到 Node.js，请安装 Node.js v24+
pause
exit /b 1

:found_node
"%NODE_EXE%" -e "const major = Number(process.versions.node.split('.')[0]); if (!Number.isInteger(major) || major < 24) { console.error('  需要 Node.js 24 或更高版本，当前为 ' + process.version); process.exit(1) }"
if errorlevel 1 (
    echo [错误] Node.js 主版本必须 ^>=24，请安装 Node.js v24+
    pause
    exit /b 1
)
echo   Node.js: %NODE_EXE%
"%NODE_EXE%" -e "console.log('  版本: ' + process.version)"
echo.

REM ===== 环境检查 =====
if not exist "backend\node_modules" (
    echo [错误] backend\node_modules 不存在
    echo   请先运行: npm ci --prefix backend --ignore-scripts
    pause
    exit /b 1
)
if not exist "app\node_modules" (
    echo [错误] app\node_modules 不存在
    echo   请先运行: npm ci --prefix app
    pause
    exit /b 1
)

REM 依赖缺失时只提示按锁文件重装，不自动改 package.json 或 lockfile。

REM ===== 检查端口 =====
echo [1/3] 检查端口 5000 和 5173...

set "BUSY_PORTS="
netstat -ano | findstr ":5000" | findstr "LISTENING" >nul && set "BUSY_PORTS=5000"
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul && set "BUSY_PORTS=%BUSY_PORTS% 5173"
if defined BUSY_PORTS (
    echo [错误] 端口%BUSY_PORTS%已被占用，请先停止对应服务再启动。
    echo   本脚本不会终止任何现有进程。
    pause
    exit /b 1
)
echo   端口可用
echo.

REM ===== 隔离本地开发数据 =====
set "NODE_ENV=development"
set "STYLEAI_DB_PATH=%~dp0.tmp\dev\styleai.db"
set "STYLEAI_UPLOAD_DIR=%~dp0.tmp\dev\uploads"
set "STYLEAI_LOG_DIR=%~dp0.tmp\dev\logs"
set "DOTENV_CONFIG_PATH=%~dp0.tmp\dev\disabled.env"
set "SECRET_KEY=local-dev-only-secret-change-me-32-chars"
set "ADMIN_PASSWORD=local-dev-only-admin-password"
if not exist "%~dp0.tmp\dev\uploads" mkdir "%~dp0.tmp\dev\uploads"
if not exist "%~dp0.tmp\dev\logs" mkdir "%~dp0.tmp\dev\logs"
if errorlevel 1 (
    echo [错误] 无法创建 .tmp\dev 开发数据目录。
    pause
    exit /b 1
)
echo   开发数据库: %STYLEAI_DB_PATH%
echo   上传目录:   %STYLEAI_UPLOAD_DIR%
echo   日志目录:   %STYLEAI_LOG_DIR%
echo.

REM ===== 启动后端 =====
echo [2/3] 启动后端服务 (端口 5000)...
start "Style AI Backend" cmd /k "cd /d "%~dp0backend" && "%NODE_EXE%" --require "%~dp0npm-patch.js" server.js"
echo   后端已启动: http://127.0.0.1:5000
echo.

REM ===== 启动前端 Vite 开发服务器 =====
echo [3/3] 启动前端 Vite 开发服务器 (端口 5173, HMR 热更新)...
echo.
echo ============================================
echo   前端地址:   http://localhost:5173
echo   后端 API:   http://127.0.0.1:5000
echo   健康检查:   http://127.0.0.1:5000/api/health
echo   管理后台:   http://localhost:5173/admin/login
echo ============================================
echo.
echo   - 修改 app/src/ 下的代码会自动热更新
echo   - 无需构建 dist，直接在浏览器看效果
echo   - 关闭此窗口会同时停止前端 (后端需单独关闭)
echo.

REM 3秒后自动打开浏览器
start "" cmd /c "timeout /t 3 /nobreak >nul 2>&1 && start http://localhost:5173"

cd /d "%~dp0app"
"%NODE_EXE%" --require "%~dp0npm-patch.js" node_modules\vite\bin\vite.js
