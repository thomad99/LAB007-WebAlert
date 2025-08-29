# GitHub Sync Scripts for Web-Alert Project

This directory contains scripts to automatically sync your local Web-Alert project to the GitHub repository at [https://github.com/thomad99/LAB007-WebAlert](https://github.com/thomad99/LAB007-WebAlert).

## 📁 Files Included

- **`sync-to-github.bat`** - Windows Batch script (recommended for most users)
- **`sync-to-github.ps1`** - PowerShell script (alternative option)
- **`GITHUB_SYNC_README.md`** - This instruction file

## 🚀 Quick Start

### Option 1: Using the Batch Script (Recommended)

1. **Double-click** `sync-to-github.bat` to run it
2. The script will automatically:
   - Check if Git is installed
   - Set up your local Git repository
   - Connect to your GitHub repository
   - Sync all your files

### Option 2: Using the PowerShell Script

1. **Right-click** `sync-to-github.ps1` and select "Run with PowerShell"
2. Or open PowerShell and run: `.\sync-to-github.ps1`

## ⚠️ Prerequisites

### 1. Install Git
If you don't have Git installed:
- Download from: [https://git-scm.com/](https://git-scm.com/)
- Install with default settings
- Restart your computer after installation

### 2. Configure Git (First Time Only)
Before running the script for the first time, you need to configure Git with your GitHub credentials:

```bash
git config --global user.name "Your GitHub Username"
git config --global user.email "your.email@example.com"
```

### 3. GitHub Authentication
You'll need to authenticate with GitHub. The script will guide you through this, but you have two options:

#### Option A: Personal Access Token (Recommended)
1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate a new token with `repo` permissions
3. Use this token as your password when prompted

#### Option B: SSH Keys
1. Generate SSH keys: `ssh-keygen -t ed25519 -C "your.email@example.com"`
2. Add the public key to your GitHub account
3. Use SSH URL instead of HTTPS

## 🔧 What the Script Does

The sync script automatically performs these steps:

1. **Checks Git Installation** - Verifies Git is available
2. **Initializes Repository** - Sets up Git in your local directory
3. **Creates .gitignore** - Excludes unnecessary files (node_modules, .env, etc.)
4. **Connects to GitHub** - Links your local repo to the remote GitHub repo
5. **Adds All Files** - Stages all your project files for commit
6. **Commits Changes** - Creates a commit with your changes
7. **Pushes to GitHub** - Uploads everything to your GitHub repository

## 📋 Files That Will Be Synced

Your entire Web-Alert project will be uploaded, including:

- ✅ Backend Node.js code
- ✅ Frontend HTML/CSS/JavaScript
- ✅ Database configuration
- ✅ Email and SMS services
- ✅ Web scraping functionality
- ✅ Docker and deployment files
- ✅ Package configuration

## 🚫 Files That Will Be Excluded

The script automatically excludes:

- ❌ `node_modules/` (dependencies)
- ❌ `.env` files (environment variables)
- ❌ Log files
- ❌ Temporary files
- ❌ IDE configuration files
- ❌ OS-generated files

## 🆘 Troubleshooting

### Common Issues and Solutions

#### 1. "Git is not installed"
- Install Git from [https://git-scm.com/](https://git-scm.com/)
- Restart your computer
- Run the script again

#### 2. "Authentication failed"
- Check your GitHub username and password
- Use a personal access token instead of your password
- Ensure you have access to the repository

#### 3. "Repository access denied"
- Verify you're a collaborator on the GitHub repository
- Check repository permissions
- Contact the repository owner if needed

#### 4. "Network issues"
- Check your internet connection
- Try again later
- Check if GitHub is accessible from your network

### Manual Git Commands

If the script fails, you can run these commands manually:

```bash
# Navigate to your project directory
cd "C:\Users\david\OneDrive\My Pet Projects\AI\Web-Alert"

# Initialize Git repository
git init

# Add remote origin
git remote add origin https://github.com/thomad99/LAB007-WebAlert.git

# Add all files
git add .

# Commit changes
git commit -m "Initial commit: Web-Alert project"

# Push to GitHub
git push -u origin main
```

## 🔄 Future Updates

After the initial sync, you can use these commands to keep your repository updated:

```bash
# Check for changes
git status

# Add new/changed files
git add .

# Commit changes
git commit -m "Description of your changes"

# Push to GitHub
git push
```

## 📞 Support

If you encounter issues:

1. **Check the error messages** - They often contain helpful information
2. **Verify prerequisites** - Ensure Git is installed and configured
3. **Check GitHub access** - Confirm you can access the repository
4. **Try manual commands** - Use the manual Git commands above

## 🎯 Success Indicators

When the script completes successfully, you should see:

```
========================================
SUCCESS: Repository synced to GitHub!
========================================

Your Web-Alert project is now available at:
https://github.com/thomad99/LAB007-WebAlert.git

You can view it online at:
https://github.com/thomad99/LAB007-WebAlert
```

## 🔗 Useful Links

- [Git Installation](https://git-scm.com/)
- [GitHub Personal Access Tokens](https://github.com/settings/tokens)
- [GitHub SSH Keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh)
- [Git Cheat Sheet](https://education.github.com/git-cheat-sheet-education.pdf)

---

**Note**: This script is designed to work with your specific project structure and GitHub repository. If you need to modify it for other projects, update the repository paths and URLs accordingly.
