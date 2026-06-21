# .NET SDK Installation Required

## The Issue

The `dotnet` command is not found because .NET SDK is not installed on your system.

## Solution: Install .NET 6.0 SDK

### Option 1: Direct Download (Recommended)

1. **Download .NET 6.0 SDK:**
   - Visit: https://dotnet.microsoft.com/download/dotnet/6.0
   - Click "Download .NET SDK x64" (for Windows)
   - File: `dotnet-sdk-6.0.xxx-win-x64.exe`

2. **Install:**
   - Run the downloaded installer
   - Follow the installation wizard
   - Accept defaults

3. **Verify Installation:**
   ```cmd
   dotnet --version
   ```
   Should show: `6.0.xxx`

### Option 2: Using winget (Windows Package Manager)

If you have Windows 11 or Windows 10 with winget:

```cmd
winget install Microsoft.DotNet.SDK.6
```

### Option 3: Using Chocolatey

If you have Chocolatey installed:

```cmd
choco install dotnet-6.0-sdk
```

## After Installation

1. **Close and reopen your command prompt** (to refresh PATH)

2. **Verify dotnet is available:**
   ```cmd
   dotnet --version
   ```

3. **Build the ETA Signer:**
   ```cmd
   cd E:\E-Invoice\E-Invoice
   build-signer.bat
   ```

## Alternative: Use Pre-built Executable

If you don't want to install .NET SDK, you can:

1. **Build on another machine** that has .NET SDK
2. **Copy the entire `bin\Release\net6.0` folder** to your server
3. **Use the EtaSigner.exe** directly (it will work without SDK)

Note: The .NET 6.0 **runtime** is required to run the exe, but the **SDK** is only needed to build it.

## Quick Check

Run this to see if .NET is installed:

```cmd
where dotnet
```

If it returns a path, .NET is installed but might not be in your PATH.
If it says "not found", you need to install it.

---

**Recommended:** Install .NET 6.0 SDK from the official Microsoft website. It's free, safe, and only takes 2-3 minutes.

Download: https://dotnet.microsoft.com/download/dotnet/6.0
