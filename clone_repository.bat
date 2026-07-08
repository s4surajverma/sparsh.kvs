@echo off
TITLE SPARSH - Clone Repository
COLOR 0B

echo ==================================================
echo SPARSH Setup - Repository Cloner
echo ==================================================
echo.

:: 1. Check if Git is installed
git --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Git is not installed or not added to your system PATH.
    echo Please install Git from https://git-scm.com/downloads
    echo.
    pause
    exit /b 1
)

:: 2. Repository URL
set REPO_URL=https://github.com/s4surajverma/sparsh.kvs
echo [INFO] Target Repository: %REPO_URL%

:: 3. Clone the repository
echo.
echo [INFO] Cloning the repository...
git clone "%REPO_URL%"

IF %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Failed to clone the repository. Please check the URL and your internet connection.
    echo Make sure you have the correct permissions if it's a private repository.
    pause
    exit /b 1
)

:: 4. Extract folder name from URL to give the user instructions
FOR %%i IN ("%REPO_URL%") DO set FOLDER_NAME=%%~nxi
set FOLDER_NAME=%FOLDER_NAME:.git=%

echo.
echo ==================================================
echo [SUCCESS] Repository cloned successfully into the "%FOLDER_NAME%" folder!
echo.
echo Next steps:
echo 1. Open the "%FOLDER_NAME%" folder.
echo 2. Run 'install_requirements.bat' to install dependencies.
echo ==================================================
pause
