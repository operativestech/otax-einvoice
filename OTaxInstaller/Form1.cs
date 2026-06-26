using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Drawing;

namespace OTaxInstaller
{
    public partial class Form1 : Form
    {
        private Label lblStatus;
        private ProgressBar prgBar;
        private TextBox txtLog;
        private Button btnAction;
        private bool isFinished = false;

        private const string DEFAULT_CLOUD_URL = "https://e-invoice-545y.onrender.com";
        private const string AGENT_DIR = @"C:\OTaxAgent";

        public Form1()
        {
            InitializeComponentProgrammatic();
        }

        private void InitializeComponentProgrammatic()
        {
            this.Size = new Size(520, 380);
            this.Text = "OTax Agent - USB Token Signing Installer";
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = true;
            this.RightToLeft = RightToLeft.No;
            this.RightToLeftLayout = false;
            this.BackColor = Color.White;

            lblStatus = new Label
            {
                Text = "Preparing installation wizard...",
                Font = new Font("Arial", 11, FontStyle.Bold),
                Location = new Point(20, 20),
                Size = new Size(460, 30),
                ForeColor = Color.FromArgb(51, 65, 85) // Slate 700
            };

            prgBar = new ProgressBar
            {
                Location = new Point(20, 60),
                Size = new Size(460, 20),
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };

            txtLog = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                Location = new Point(20, 95),
                Size = new Size(460, 190),
                Font = new Font("Consolas", 9),
                BackColor = Color.FromArgb(248, 250, 252), // Slate 50
                ForeColor = Color.FromArgb(15, 23, 42) // Slate 900
            };

            btnAction = new Button
            {
                Location = new Point(20, 295),
                Size = new Size(460, 35),
                Text = "Start Automatic Installation",
                Font = new Font("Arial", 10, FontStyle.Bold),
                BackColor = Color.FromArgb(37, 99, 235), // Blue 600
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            btnAction.FlatAppearance.BorderSize = 0;
            btnAction.Click += BtnAction_Click;

            this.Controls.Add(lblStatus);
            this.Controls.Add(prgBar);
            this.Controls.Add(txtLog);
            this.Controls.Add(btnAction);
        }

        private void Log(string message)
        {
            if (txtLog.InvokeRequired)
            {
                txtLog.Invoke(new Action(() => Log(message)));
                return;
            }
            txtLog.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}\r\n");
        }

        private void SetStatus(string status, int progressValue)
        {
            if (lblStatus.InvokeRequired)
            {
                lblStatus.Invoke(new Action(() => SetStatus(status, progressValue)));
                return;
            }
            lblStatus.Text = status;
            prgBar.Value = Math.Min(100, Math.Max(0, progressValue));
        }

        private async void BtnAction_Click(object sender, EventArgs e)
        {
            if (isFinished)
            {
                Application.Exit();
                return;
            }

            btnAction.Enabled = false;
            btnAction.Text = "Installing...";
            btnAction.BackColor = Color.LightGray;

            try
            {
                await Task.Run(() => StartInstallationFlow());
            }
            catch (Exception ex)
            {
                Log($"[FATAL ERROR] Installation failed: {ex.Message}");
                SetStatus("Installation failed. Please check the error log.", prgBar.Value);
                btnAction.Enabled = true;
                btnAction.Text = "Retry";
                btnAction.BackColor = Color.FromArgb(220, 38, 38); // Red 600
            }
        }

        private async Task StartInstallationFlow()
        {
            // Step 1: Parse Company ID from filename
            SetStatus("Extracting company code from filename...", 5);
            string exePath = Environment.ProcessPath ?? "";
            string exeName = Path.GetFileNameWithoutExtension(exePath);
            string companyId = "default";

            Log($"Installer path: {exePath}");
            Log($"Filename: {exeName}");

            var match = Regex.Match(exeName, @"OTax-Agent-Setup-(.+)");
            if (match.Success)
            {
                companyId = match.Groups[1].Value;
                Log($"Company code detected: {companyId}");
            }
            else
            {
                Log("Company code not found in filename. Using default value.");
            }

            // Step 1.5: Stop any running agent processes BEFORE touching files
            SetStatus("Stopping running agent processes...", 10);
            StopRunningAgentProcesses();

            // Step 2: Download Agent ZIP
            SetStatus("Downloading OTax Agent files...", 15);
            string cloudUrl = DEFAULT_CLOUD_URL;
            string zipUrl = $"{cloudUrl}/api/bridge/download-setup-files";
            string tempZipPath = Path.Combine(Path.GetTempPath(), $"otax-setup-{companyId}.zip");

            Log($"Connecting to server: {zipUrl}");
            using (var httpClient = new HttpClient())
            {
                httpClient.Timeout = TimeSpan.FromMinutes(5);
                try
                {
                    var response = await httpClient.GetAsync(zipUrl);
                    response.EnsureSuccessStatusCode();
                    using (var fs = new FileStream(tempZipPath, FileMode.Create))
                    {
                        await response.Content.CopyToAsync(fs);
                    }
                    Log("Files downloaded successfully.");
                }
                catch (Exception ex)
                {
                    Log($"Download failed: {ex.Message}");
                    throw;
                }
            }

            // Step 3: Unpack ZIP to C:\OTaxAgent
            SetStatus("Extracting files to your computer...", 30);
            Log($"Target path: {AGENT_DIR}");
            try
            {
                if (Directory.Exists(AGENT_DIR))
                {
                    Log("Folder exists. Cleaning old files...");
                    SafeDeleteDirectory(AGENT_DIR);
                }
                Directory.CreateDirectory(AGENT_DIR);
                ZipFile.ExtractToDirectory(tempZipPath, AGENT_DIR);
                Log("Files extracted successfully.");
            }
            catch (Exception ex)
            {
                Log($"Extraction failed: {ex.Message}");
                throw;
            }
            finally
            {
                if (File.Exists(tempZipPath)) File.Delete(tempZipPath);
            }

            // Step 4: Write agent_config.json
            SetStatus("Writing configuration files...", 40);
            string configFilePath = Path.Combine(AGENT_DIR, "agent_config.json");
            var config = new
            {
                nodeId = $"otax-{companyId}-{Guid.NewGuid().ToString().Substring(0, 8)}",
                companyId = companyId,
                cloudUrl = cloudUrl.Replace("https://", "wss://").Replace("http://", "ws://"),
                agentName = Environment.MachineName
            };
            try
            {
                string configJson = JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(configFilePath, configJson);
                Log("agent_config.json created successfully.");
            }
            catch (Exception ex)
            {
                Log($"Failed to create config file: {ex.Message}");
                throw;
            }

            // Step 5: Check and install Node.js
            SetStatus("Checking Node.js installation...", 55);
            bool hasNode = false;
            try
            {
                var psi = new ProcessStartInfo("node", "-v")
                {
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (var proc = Process.Start(psi))
                {
                    proc?.WaitForExit();
                    if (proc?.ExitCode == 0) hasNode = true;
                }
            }
            catch { }

            if (hasNode)
            {
                Log("Node.js is already installed.");
            }
            else
            {
                Log("Node.js not found. Downloading Node.js v20 LTS silently...");
                string nodeMsiUrl = "https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi";
                string msiPath = Path.Combine(Path.GetTempPath(), "node-setup.msi");
                using (var client = new HttpClient())
                {
                    var data = await client.GetByteArrayAsync(nodeMsiUrl);
                    File.WriteAllBytes(msiPath, data);
                }

                Log("Running Node.js installer in background...");
                var procInfo = new ProcessStartInfo("msiexec", $"/i \"{msiPath}\" /qn /norestart")
                {
                    UseShellExecute = true,
                    Verb = "runas",
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                var installProc = Process.Start(procInfo);
                installProc?.WaitForExit();
                Log("Node.js installed successfully.");
            }

            // Step 6: Check .NET 8 Runtime
            SetStatus("Checking .NET 8 Desktop Runtime...", 70);
            bool hasDotnet = false;
            try
            {
                if (Directory.Exists(@"C:\Program Files\dotnet\shared\Microsoft.WindowsDesktop.App"))
                {
                    string[] dirs = Directory.GetDirectories(@"C:\Program Files\dotnet\shared\Microsoft.WindowsDesktop.App");
                    foreach (var d in dirs)
                    {
                        if (Path.GetFileName(d).StartsWith("8."))
                        {
                            hasDotnet = true;
                            break;
                        }
                    }
                }
            }
            catch { }

            if (hasDotnet)
            {
                Log(".NET 8 Desktop Runtime is already installed.");
            }
            else
            {
                Log(".NET 8 Desktop Runtime not found. Downloading silently...");
                string dotnetUrl = "https://dotnetcli.azureedge.net/dotnet/WindowsDesktop/8.0.11/windowsdesktop-runtime-8.0.11-win-x64.exe";
                string dotnetInstallerPath = Path.Combine(Path.GetTempPath(), "dotnet-desktop-runtime.exe");
                using (var client = new HttpClient())
                {
                    var data = await client.GetByteArrayAsync(dotnetUrl);
                    File.WriteAllBytes(dotnetInstallerPath, data);
                }

                Log("Installing .NET 8 silently in background...");
                var dotnetProcInfo = new ProcessStartInfo(dotnetInstallerPath, "/install /quiet /norestart")
                {
                    UseShellExecute = true,
                    Verb = "runas",
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                var dotnetProc = Process.Start(dotnetProcInfo);
                dotnetProc?.WaitForExit();
                Log(".NET 8 Runtime installed successfully.");
            }

            // Step 7: npm install dependencies
            SetStatus("Installing dependencies (npm install)...", 85);
            Log("Running npm install...");
            var npmPsi = new ProcessStartInfo("cmd.exe", "/c npm install --no-audit --no-fund --loglevel=error")
            {
                WorkingDirectory = AGENT_DIR,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true
            };
            using (var proc = Process.Start(npmPsi))
            {
                proc?.WaitForExit();
                Log("Dependencies installed.");
            }

            // Step 8: Configuring PKCS11 driver for UTS
            SetStatus("Configuring token driver...", 90);
            string pkcs11Dll = "";
            if (File.Exists(@"C:\Windows\System32\eps2003csp11.dll"))
                pkcs11Dll = @"C:\Windows\System32\eps2003csp11.dll";
            else if (File.Exists(@"C:\Windows\SysWOW64\eps2003csp11.dll"))
                pkcs11Dll = @"C:\Windows\SysWOW64\eps2003csp11.dll";

            if (!string.IsNullOrEmpty(pkcs11Dll))
            {
                string utsSettingsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "UniversalTokenSigner");
                Directory.CreateDirectory(utsSettingsDir);
                string settingsJsonPath = Path.Combine(utsSettingsDir, "settings.json");
                var utsSettings = new
                {
                    Pkcs11LibraryPath = pkcs11Dll,
                    Port = 7777,
                    ApiSecret = "",
                    AllowedOrigins = new string[] { }
                };
                string utsSettingsJson = JsonSerializer.Serialize(utsSettings, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(settingsJsonPath, utsSettingsJson);
                Log("UniversalTokenSigner configured with PKCS#11 driver.");
            }
            else
            {
                Log("Warning: Token driver eps2003csp11.dll not found. Please install the USB token driver.");
            }

            // Step 9: Register Auto-start Scheduled Task
            SetStatus("Registering auto-start service...", 95);
            Log("Registering scheduled task for Windows startup...");

            // Create silent runner VBS
            string vbsPath = Path.Combine(AGENT_DIR, "run_agent_silent.vbs");
            string vbsContent = $"Set WshShell = CreateObject(\"WScript.Shell\")\r\nWshShell.Run chr(34) & \"{AGENT_DIR}\\run_agent.bat\" & chr(34), 0, False";
            File.WriteAllText(vbsPath, vbsContent);

            // Register task via schtasks
            var schtasksDeletePsi = new ProcessStartInfo("schtasks", "/delete /tn \"OTaxSigningAgent\" /f") { CreateNoWindow = true, UseShellExecute = false };
            Process.Start(schtasksDeletePsi)?.WaitForExit();

            var schtasksCreatePsi = new ProcessStartInfo("schtasks", $"/create /tn \"OTaxSigningAgent\" /tr \"\\\"{vbsPath}\\\"\" /sc onlogon /rl highest /f")
            {
                CreateNoWindow = true,
                UseShellExecute = false
            };
            var createProc = Process.Start(schtasksCreatePsi);
            createProc?.WaitForExit();

            if (createProc?.ExitCode == 0)
            {
                Log("Auto-start service registered successfully.");
            }
            else
            {
                Log("schtasks failed. Copying script to Startup folder as fallback...");
                string startupPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Windows\Start Menu\Programs\Startup");
                File.Copy(vbsPath, Path.Combine(startupPath, "OTaxAgent.vbs"), true);
            }

            // Step 10: Run the agent
            SetStatus("Starting the Agent now...", 99);
            var startAgentPsi = new ProcessStartInfo("wscript.exe", $"\"{vbsPath}\"") { UseShellExecute = true };
            Process.Start(startAgentPsi);
            Log("Agent started successfully in background!");

            // Complete!
            this.Invoke(new Action(() =>
            {
                SetStatus("✓ Installation completed successfully!", 100);
                isFinished = true;
                btnAction.Enabled = true;
                btnAction.Text = "Close Installer";
                btnAction.BackColor = Color.FromArgb(16, 185, 129); // Emerald 500
                Log("=================================================");
                Log("  Token signing activated successfully!");
                Log("  You can now return to the browser to upload invoices.");
                Log("=================================================");
            }));
        }
        /// <summary>
        /// Kills all running processes that could lock files in C:\OTaxAgent
        /// Uses taskkill commands for reliability
        /// </summary>
        private void StopRunningAgentProcesses()
        {
            Log("Stopping any running OTax Agent processes...");
            int killed = 0;

            killed += KillProcessByName("esbuild");
            killed += KillProcessByName("UniversalTokenSigner");

            try
            {
                var psi = new ProcessStartInfo("cmd.exe", "/c wmic process where \"name='node.exe' and commandline like '%OTaxAgent%'\" call terminate >nul 2>&1") { CreateNoWindow = true, UseShellExecute = false };
                var proc = Process.Start(psi);
                proc?.WaitForExit(10000);
                if (proc?.ExitCode == 0) killed++;
            }
            catch { }

            try
            {
                var psi = new ProcessStartInfo("cmd.exe", "/c wmic process where \"name='wscript.exe' and commandline like '%OTaxAgent%'\" call terminate >nul 2>&1") { CreateNoWindow = true, UseShellExecute = false };
                var proc = Process.Start(psi);
                proc?.WaitForExit(10000);
            }
            catch { }

            if (killed > 0)
            {
                Log($"Stopped {killed} running process(es).");
                System.Threading.Thread.Sleep(2000);
            }
        }

        private int KillProcessByName(string processName)
        {
            int killed = 0;
            try
            {
                foreach (var proc in Process.GetProcessesByName(processName))
                {
                    try { proc.Kill(); proc.WaitForExit(5000); killed++; } catch { }
                }
            }
            catch { }
            return killed;
        }

        /// <summary>
        /// Safely deletes a directory with retry logic for locked files
        /// </summary>
        private void SafeDeleteDirectory(string dirPath, int maxRetries = 3)
        {
            for (int attempt = 1; attempt <= maxRetries; attempt++)
            {
                try
                {
                    Directory.Delete(dirPath, true);
                    return; // Success
                }
                catch (UnauthorizedAccessException) when (attempt < maxRetries)
                {
                    Log($"  Retry {attempt}/{maxRetries} — some files still locked, waiting...");
                    System.Threading.Thread.Sleep(3000);
                }
                catch (IOException) when (attempt < maxRetries)
                {
                    Log($"  Retry {attempt}/{maxRetries} — file system busy, waiting...");
                    System.Threading.Thread.Sleep(3000);
                }
            }
            // Final attempt
            Directory.Delete(dirPath, true);
        }
    }
}
