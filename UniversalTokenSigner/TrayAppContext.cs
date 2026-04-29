using System;
using System.Drawing;
using System.Linq;
using System.Diagnostics;
using System.Windows.Forms;

public sealed class TrayAppContext : ApplicationContext
{
    private readonly NotifyIcon _tray;
    private readonly AppSettings _settings;
    private readonly WebHostService _web;

    public TrayAppContext(AppSettings settings, WebHostService web)
    {
        _settings = settings;
        _web = web;

        var menu = new ContextMenuStrip();

        menu.Items.Add("Set PKCS#11 DLL...", null, (_, __) => PickDll());
        menu.Items.Add("Show API Secret", null, (_, __) => ShowSecret());
        menu.Items.Add("Test: List Certificates", null, (_, __) => TestListCerts());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Open Local Status", null, (_, __) => OpenStatus());
        menu.Items.Add("Exit", null, (_, __) => Exit());

        _tray = new NotifyIcon
        {
            Icon = SystemIcons.Shield,
            Visible = true,
            Text = "Universal Token Signer",
            ContextMenuStrip = menu
        };

        _tray.DoubleClick += (_, __) => OpenStatus();
    }

    private void PickDll()
    {
        using var dlg = new OpenFileDialog
        {
            Title = "Select PKCS#11 DLL",
            Filter = "DLL Files (*.dll)|*.dll",
            CheckFileExists = true
        };

        if (dlg.ShowDialog() == DialogResult.OK)
        {
            _settings.Pkcs11LibraryPath = dlg.FileName;
            SettingsStore.Save(_settings);
            MessageBox.Show("Saved PKCS#11 library path.", "OK", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private void ShowSecret()
    {
        MessageBox.Show(_settings.ApiSecret, "X-UTS-Secret", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void TestListCerts()
    {
        try
        {
            var signer = new Pkcs11Signer(_settings.Pkcs11LibraryPath);
            var certs = signer.ListCertificates();

            if (certs.Count == 0)
            {
                MessageBox.Show("No certificates found.", "Result");
                return;
            }

            var text = string.Join("\n\n", certs.Select(c =>
                $"Label: {c.Label}\nKeyType: {c.KeyType}\nCertId: {c.CertIdBase64}\nSubject: {c.Subject}"));

            MessageBox.Show(text, "Certificates", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void OpenStatus()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = $"http://127.0.0.1:{_settings.Port}/status",
            UseShellExecute = true
        });
    }

    private void Exit()
    {
        _web.Stop();
        _tray.Visible = false;
        _tray.Dispose();
        Application.Exit();
    }
}