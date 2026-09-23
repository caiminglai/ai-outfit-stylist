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

if exist "D:\code tools\node\node.exe" (
    set "NODE_EXE=D:\code tools\node\node.exe"
    goto :found_node
)
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

echo [错误] 未找到 Node.js，请安装 Node.js v20+
pause
exit /b 1

:found_node
echo   Node.js: %NODE_EXE%
"%NODE_EXE%" -e "console.log('  版本: ' + process.version)"
echo.

REM ===== 从 NODE_EXE 推导 npm 路径 (在 if 块外面执行，避免延迟展开问题) =====
for %%i in ("%NODE_EXE%") do set "NODE_DIR=%%~dpi"
set "NPM_CLI=%NODE_DIR%node_modules\npm\bin\npm-cli.js"

REM ===== 环境检查 =====
if not exist "backend-node\node_modules" (
    echo [错误] backend-node\node_modules 不存在
    echo   请先运行: cd backend-node ^&^& npm install
    pause
    exit /b 1
)
if not exist "app\node_modules" (
    echo [错误] app\node_modules 不存在
    echo   请先运行: cd app ^&^& npm install
    pause
    exit /b 1
)

REM ===== 修复 Rollup 原生模块 (npm 已知 bug) =====
if not exist "app\node_modules\@rollup\rollup-win32-x64-msvc" (
    echo   [修复] Rollup 原生模块缺失，正在自动安装...
    if exist "%NPM_CLI%" (
        cd /d "%~dp0app"
        "%NODE_EXE%" "%NPM_CLI%" install @rollup/rollup-win32-x64-msvc --no-save
        cd /d "%~dp0"
    ) else (
        echo   [警告] 未找到 npm，请手动运行: cd app ^&^& npm install @rollup/rollup-win32-x64-msvc
    )
    if exist "app\node_modules\@rollup\rollup-win32-x64-msvc" (
        echo   [修复] Rollup 原生模块安装成功
    ) else (
        echo   [警告] 自动安装失败，请手动运行: cd app ^&^& npm install @rollup/rollup-win32-x64-msvc
    )
)

REM ===== 清理端口 =====
echo [1/3] 清理端口 5000 和 5173...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
    echo   终止占用 5000 进程 PID=%%a
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    echo   终止占用 5173 进程 PID=%%a
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul 2>&1
echo   端口已清理
echo.

REM ===== 启动后端 =====
echo [2/3] 启动后端服务 (端口 5000)...
start "Style AI Backend" cmd /k "cd /d "%~dp0backend-node" && "%NODE_EXE%" --require "%~dp0npm-patch.js" server.js"
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
