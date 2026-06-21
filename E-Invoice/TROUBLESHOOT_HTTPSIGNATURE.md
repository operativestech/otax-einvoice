# Troubleshooting HttpSignature.exe

## Step 1: Check if it's running

Open Task Manager (Ctrl+Shift+Esc) and look for `HttpSignature.exe` in the Processes tab.

If it's there but no window appeared, it might be running in the background.

## Step 2: Try running from Command Prompt

```cmd
cd C:\Users\DELL LS\Downloads\ETAHttpSignature
# (or wherever you extracted it)

HttpSignature.exe
```

This will show any error messages.

## Step 3: Check for missing dependencies

The tool needs **.NET Framework** or **.NET Core**. Try installing:

**Download .NET 6.0 Runtime**:
https://dotnet.microsoft.com/download/dotnet/6.0/runtime

Install the **Desktop Runtime** (x64)

## Step 4: Alternative - Build from source

If the exe doesn't work, we can build it:

```cmd
# Clone the repository
git clone https://github.com/mrkindy/ETAHttpSignature
cd ETAHttpSignature

# Build
dotnet build -c Release

# Run
cd bin\Release\net6.0
HttpSignature.exe
```

## Step 5: Check what you downloaded

Make sure you extracted the ZIP and you're running the `.exe` file, not the `.zip` file.

The folder should contain:
- HttpSignature.exe
- HttpSignature.dll
- Other DLL files

---

## Quick Test

Try this command to see if it shows anything:

```cmd
cd <extracted_folder>
HttpSignature.exe --help
```

Or just:
```cmd
HttpSignature.exe
```

**What do you see when you run it from command prompt?**
