# 🔄 Web-Alert Git Sync Scripts

These scripts make it easy to sync your Web-Alert project to GitHub whenever you make changes.

## 📁 Available Scripts

### 1. `sync-to-github.bat` (Windows Batch)
- **Use this if you prefer batch files**
- Double-click to run
- Shows step-by-step progress
- Good for quick syncs

### 2. `sync-to-github.ps1` (PowerShell)
- **Use this for better compatibility**
- Right-click → "Run with PowerShell"
- Colored output and better error handling
- Recommended for most users

## 🚀 How to Use

### **Option A: Double-Click (Batch)**
1. Double-click `sync-to-github.bat`
2. Watch the progress
3. Press any key when done

### **Option B: PowerShell**
1. Right-click `sync-to-github.ps1`
2. Select "Run with PowerShell"
3. Watch the colored progress
4. Press any key when done

## 📋 What the Scripts Do

1. **Check Git Status** - Shows what files have changed
2. **Add Changes** - Stages all modified files
3. **Commit** - Creates a commit with timestamp
4. **Push** - Uploads to GitHub

## 🎯 When to Use

- ✅ After fixing bugs
- ✅ After adding new features
- ✅ After updating documentation
- ✅ Before sharing with others
- ✅ Regular backups

## 🔧 Troubleshooting

### **If push fails:**
1. Check internet connection
2. Verify GitHub credentials
3. Run: `git remote -v`
4. Try: `git push --force origin main`

### **If you get errors:**
- Make sure you're in the right directory
- Check that Git is installed
- Verify your GitHub repository exists

## 📍 Your Repository

**GitHub URL:** https://github.com/thomad99/LAB007-WebAlert

## 💡 Pro Tips

- **Run regularly** - Don't let changes pile up
- **Check the output** - Look for any error messages
- **Keep scripts handy** - Put them in an easy-to-find location
- **Use PowerShell version** - Better error messages and colors

## 🎉 You're All Set!

Your Web-Alert project is now working great, and you have easy scripts to keep it synced with GitHub. Run one of these scripts whenever you want to save your progress! 🚀
