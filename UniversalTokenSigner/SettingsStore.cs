using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

public sealed class AppSettings
{
    public string Pkcs11LibraryPath { get; set; } = "";
    public int Port { get; set; } = 7777;

    // Secret used by WebApp to call localhost API safely (X-UTS-Secret)
    public string ApiSecret { get; set; } = "";

    // Optional: allow only specific origins (your webapp domain)
    public string[] AllowedOrigins { get; set; } = Array.Empty<string>();
}

public static class SettingsStore
{
    private static readonly string Dir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "UniversalTokenSigner");
    private static readonly string FilePath = Path.Combine(Dir, "settings.json");

    public static AppSettings LoadOrCreate()
    {
        Directory.CreateDirectory(Dir);

        if (System.IO.File.Exists(FilePath))
        {
            var json = System.IO.File.ReadAllText(FilePath);
            var s = JsonSerializer.Deserialize<AppSettings>(json) ?? new AppSettings();
            if (string.IsNullOrWhiteSpace(s.ApiSecret))
            {
                s.ApiSecret = GenerateSecret();
                Save(s);
            }
            return s;
        }

        var settings = new AppSettings
        {
            ApiSecret = GenerateSecret(),
            Port = 7777
        };
        Save(settings);
        return settings;
    }

    public static void Save(AppSettings settings)
    {
        Directory.CreateDirectory(Dir);
        var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
        System.IO.File.WriteAllText(FilePath, json);
    }

    private static string GenerateSecret()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes);
    }
}