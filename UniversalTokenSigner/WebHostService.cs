using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting;

public sealed class WebHostService
{
    private readonly AppSettings _settings;
    private WebApplication? _app;

    public WebHostService(AppSettings settings)
    {
        _settings = settings;
    }

    public void Start()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls($"http://127.0.0.1:{_settings.Port}");

        _app = builder.Build();

        // CORS — allow local agent / browser to call UTS
        _app.Use(async (ctx, next) =>
        {
            ctx.Response.Headers.Append("Access-Control-Allow-Origin", "*");
            ctx.Response.Headers.Append("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            ctx.Response.Headers.Append("Access-Control-Allow-Headers", "Content-Type, X-UTS-Secret");

            if (ctx.Request.Method == "OPTIONS")
            {
                ctx.Response.StatusCode = 204;
                return;
            }
            await next();
        });

        // Security middleware
        _app.Use(async (ctx, next) =>
        {
            if (!Security.IsLocalRequest(ctx) || !Security.HasValidSecret(ctx, _settings))
            {
                ctx.Response.StatusCode = 403;
                await ctx.Response.WriteAsync("Forbidden");
                return;
            }
            await next();
        });

        // ── Status / Health ─────────────────────────────
        _app.MapGet("/status", () => new
        {
            ok = true,
            version = "2.0.0",
            port = _settings.Port,
            hasPkcs11 = !string.IsNullOrWhiteSpace(_settings.Pkcs11LibraryPath),
            pkcs11Dll = Path.GetFileName(_settings.Pkcs11LibraryPath ?? ""),
        });

        _app.MapGet("/secret", () => new
        {
            secret = _settings.ApiSecret
        });

        // ── List Certificates from Token ────────────────
        _app.MapGet("/tokens", () =>
        {
            var signer = new Pkcs11Signer(_settings.Pkcs11LibraryPath);
            return signer.ListCertificates();
        });

        // ── Low-Level Sign (raw hash) ───────────────────
        _app.MapPost("/sign", (SignRequest req) =>
        {
            var signer = new Pkcs11Signer(_settings.Pkcs11LibraryPath);
            return signer.Sign(req);
        });

        // ── High-Level Sign Document (serialized → hash → sign) ─
        _app.MapPost("/sign-document", (SignDocumentRequest req) =>
        {
            var signer = new Pkcs11Signer(_settings.Pkcs11LibraryPath);
            return signer.SignDocument(req);
        });

        // ── CAdES-BES Sign Document (ETA-compatible CMS PKCS#7) ─
        _app.MapPost("/sign-document-cades", (SignDocumentCadesRequest req) =>
        {
            var signer = new Pkcs11Signer(_settings.Pkcs11LibraryPath);
            return signer.SignDocumentCades(req);
        });

        _app.Start();
    }

    public void Stop()
    {
        _app?.StopAsync().GetAwaiter().GetResult();
        _app?.DisposeAsync().GetAwaiter().GetResult();
        _app = null;
    }
}