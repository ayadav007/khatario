# Quick HTTPS Setup for Windows (No Package Manager Required)

## Option 1: Automatic Installation (Recommended)

1. **Open PowerShell as Administrator:**
   - Press `Win + X`
   - Select "Windows PowerShell (Admin)" or "Terminal (Admin)"

2. **Run the installation script:**
   ```powershell
   cd D:\MyApps\Khatario
   .\scripts\install-mkcert-windows.ps1
   ```

3. **If you get an execution policy error, run this first:**
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

## Option 2: Manual Installation

1. **Download mkcert:**
   - Go to: https://github.com/FiloSottile/mkcert/releases/latest
   - Download: `mkcert-v1.4.4-windows-amd64.exe`
   - Rename it to `mkcert.exe`

2. **Place mkcert in a folder:**
   - Create a folder: `C:\Users\YourUsername\bin` (or any folder you prefer)
   - Move `mkcert.exe` there

3. **Add to PATH:**
   - Press `Win + R`, type `sysdm.cpl`, press Enter
   - Go to "Advanced" tab → "Environment Variables"
   - Under "User variables", find "Path" and click "Edit"
   - Click "New" and add: `C:\Users\YourUsername\bin` (or your chosen folder)
   - Click OK on all dialogs

4. **Open a NEW PowerShell window** (to reload PATH)

5. **Install the local CA:**
   ```powershell
   mkcert -install
   ```
   (You may need to run PowerShell as Administrator for this step)

## Generate SSL Certificates

After mkcert is installed, run:

```bash
npm run setup:https
```

This will create SSL certificates in the `certs` folder.

## Start HTTPS Server

```bash
npm run dev:https
```

Then access: **https://localhost:3000**

## Troubleshooting

### "mkcert is not recognized"
- Make sure you added mkcert to PATH
- Close and reopen your terminal/PowerShell
- Try the full path: `C:\Users\YourUsername\bin\mkcert.exe -install`

### "Permission denied" when installing CA
- Run PowerShell as Administrator
- Or run: `mkcert -install` in an Administrator PowerShell window

### Still having issues?
You can also use the manual certificate generation method (see below).
