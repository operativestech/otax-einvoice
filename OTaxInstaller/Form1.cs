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
            this.Text = "تثبيت برنامج التوقيع الإلكتروني - OTax Agent";
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = true;
            this.RightToLeft = RightToLeft.Yes;
            this.RightToLeftLayout = true;
            this.BackColor = Color.White;

            lblStatus = new Label
            {
                Text = "جاري تهيئة معالج التثبيت...",
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
                Text = "بدء التثبيت التلقائي",
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
            btnAction.Text = "جاري التثبيت...";
            btnAction.BackColor = Color.LightGray;

            try
            {
                await Task.Run(() => StartInstallationFlow());
            }
            catch (Exception ex)
            {
                Log($"[خطأ فادح] حدث خطأ أثناء التثبيت: {ex.Message}");
                SetStatus("فشل التثبيت. يرجى مراجعة سجل الأخطاء.", prgBar.Value);
                btnAction.Enabled = true;
                btnAction.Text = "إعادة المحاولة";
                btnAction.BackColor = Color.FromArgb(220, 38, 38); // Red 600
            }
        }

        private async Task StartInstallationFlow()
        {
            // Step 1: Parse Company ID from filename
            SetStatus("جاري استخراج كود الشركة من اسم الملف...", 5);
            string exePath = Environment.ProcessPath ?? "";
            string exeName = Path.GetFileNameWithoutExtension(exePath);
            string companyId = "default";

            Log($"مسار ملف التثبيت: {exePath}");
            Log($"اسم الملف الحالي: {exeName}");

            var match = Regex.Match(exeName, @"OTax-Agent-Setup-(.+)");
            if (match.Success)
            {
                companyId = match.Groups[1].Value;
                Log($"تم التعرف على كود الشركة: {companyId}");
            }
            else
            {
                Log("لم يتم العثور على كود الشركة في اسم الملف. سيتم استخدام القيمة الافتراضية.");
            }

            // Step 2: Download Agent ZIP
            SetStatus("جاري تحميل ملفات OTax Agent...", 15);
            string cloudUrl = DEFAULT_CLOUD_URL;
            string zipUrl = $"{cloudUrl}/api/bridge/download-setup-files";
            string tempZipPath = Path.Combine(Path.GetTempPath(), $"otax-setup-{companyId}.zip");

            Log($"جاري الاتصال بالسيرفر: {zipUrl}");
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
                    Log("تم تحميل الملفات المضغوطة بنجاح.");
                }
                catch (Exception ex)
                {
                    Log($"فشل تحميل الملفات: {ex.Message}");
                    throw;
                }
            }

            // Step 3: Unpack ZIP to C:\OTaxAgent
            SetStatus("جاري استخراج الملفات إلى جهازك...", 30);
            Log($"المسار المستهدف: {AGENT_DIR}");
            try
            {
                if (Directory.Exists(AGENT_DIR))
                {
                    Log("المجلد موجود بالفعل. جاري مسح المحتويات القديمة...");
                    Directory.Delete(AGENT_DIR, true);
                }
                Directory.CreateDirectory(AGENT_DIR);
                ZipFile.ExtractToDirectory(tempZipPath, AGENT_DIR);
                Log("تم فك ضغط الملفات بنجاح.");
            }
            catch (Exception ex)
            {
                Log($"فشل استخراج الملفات: {ex.Message}");
                throw;
            }
            finally
            {
                if (File.Exists(tempZipPath)) File.Delete(tempZipPath);
            }

            // Step 4: Write agent_config.json
            SetStatus("جاري كتابة ملفات الإعدادات...", 40);
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
                Log("تم إنشاء ملف agent_config.json بنجاح.");
            }
            catch (Exception ex)
            {
                Log($"فشل إنشاء ملف الإعدادات: {ex.Message}");
                throw;
            }

            // Step 5: Check and install Node.js
            SetStatus("جاري فحص وتثبيت Node.js...", 55);
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
                Log("Node.js مثبت بالفعل على الجهاز.");
            }
            else
            {
                Log("Node.js غير موجود. جاري تحميل وتثبيت Node.js v20 LTS صامتاً...");
                string nodeMsiUrl = "https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi";
                string msiPath = Path.Combine(Path.GetTempPath(), "node-setup.msi");
                using (var client = new HttpClient())
                {
                    var data = await client.GetByteArrayAsync(nodeMsiUrl);
                    File.WriteAllBytes(msiPath, data);
                }

                Log("جاري تشغيل مثبت Node.js بالخلفية...");
                var procInfo = new ProcessStartInfo("msiexec", $"/i \"{msiPath}\" /qn /norestart")
                {
                    UseShellExecute = true,
                    Verb = "runas",
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                var installProc = Process.Start(procInfo);
                installProc?.WaitForExit();
                Log("تم تثبيت Node.js بنجاح.");
            }

            // Step 6: Check .NET 8 Runtime
            SetStatus("جاري فحص .NET 8 Desktop Runtime...", 70);
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
                Log(".NET 8 Desktop Runtime مثبت بالفعل.");
            }
            else
            {
                Log(".NET 8 Desktop Runtime غير موجود. جاري التحميل صامتاً...");
                string dotnetUrl = "https://dotnetcli.azureedge.net/dotnet/WindowsDesktop/8.0.11/windowsdesktop-runtime-8.0.11-win-x64.exe";
                string dotnetInstallerPath = Path.Combine(Path.GetTempPath(), "dotnet-desktop-runtime.exe");
                using (var client = new HttpClient())
                {
                    var data = await client.GetByteArrayAsync(dotnetUrl);
                    File.WriteAllBytes(dotnetInstallerPath, data);
                }

                Log("جاري تثبيت .NET 8 صامتاً بالخلفية...");
                var dotnetProcInfo = new ProcessStartInfo(dotnetInstallerPath, "/install /quiet /norestart")
                {
                    UseShellExecute = true,
                    Verb = "runas",
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                var dotnetProc = Process.Start(dotnetProcInfo);
                dotnetProc?.WaitForExit();
                Log("تم تثبيت .NET 8 Runtime بنجاح.");
            }

            // Step 7: npm install dependencies
            SetStatus("جاري تنزيل مكتبات التشغيل (npm install)...", 85);
            Log("جاري تشغيل npm install...");
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
                Log("اكتمل تثبيت مكتبات التشغيل.");
            }

            // Step 8: Configuring PKCS11 driver for UTS
            SetStatus("جاري إعداد محرك التوكن للبرنامج...", 90);
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
                Log("تم إعداد UniversalTokenSigner بمحرك PKCS#11.");
            }
            else
            {
                Log("تحذير: لم يتم العثور على محرك التوكن eps2003csp11.dll. يرجى تثبيت تعريف فلاشة التوكن.");
            }

            // Step 9: Register Auto-start Scheduled Task
            SetStatus("جاري تسجيل الخدمة التلقائية...", 95);
            Log("جاري تسجيل مهمة مجدولة لتشغيل الـ Agent مع إقلاع ويندوز...");

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
                Log("تم تسجيل الخدمة التلقائية بنجاح.");
            }
            else
            {
                Log("لم نتمكن من استخدام schtasks، جاري نسخ السكربت مجلد بدء التشغيل كبديل...");
                string startupPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Windows\Start Menu\Programs\Startup");
                File.Copy(vbsPath, Path.Combine(startupPath, "OTaxAgent.vbs"), true);
            }

            // Step 10: Run the agent
            SetStatus("جاري تشغيل الـ Agent الآن...", 99);
            var startAgentPsi = new ProcessStartInfo("wscript.exe", $"\"{vbsPath}\"") { UseShellExecute = true };
            Process.Start(startAgentPsi);
            Log("تم تشغيل الـ Agent بنجاح بالخلفية!");

            // Complete!
            this.Invoke(new Action(() =>
            {
                SetStatus("✓ اكتمل التثبيت والتشغيل بنجاح!", 100);
                isFinished = true;
                btnAction.Enabled = true;
                btnAction.Text = "إنهاء المعالج";
                btnAction.BackColor = Color.FromArgb(16, 185, 129); // Emerald 500
                Log("=================================================");
                Log("  تم تفعيل التوقيع بالتوكن بنجاح!");
                Log("  يمكنك الآن العودة للمتصفح واستكمال رفع الفواتير.");
                Log("=================================================");
            }));
        }
    }
}
