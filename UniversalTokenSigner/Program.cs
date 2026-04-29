using System;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();

        // Load settings (PKCS#11 dll path, api secret, etc.)
        var settings = SettingsStore.LoadOrCreate();

        // Start local web API (Kestrel)
        var web = new WebHostService(settings);
        web.Start();

        // Start tray UI
        Application.Run(new TrayAppContext(settings, web));
    }
}