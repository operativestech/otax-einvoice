using System;
using System.Net;
using Microsoft.AspNetCore.Http;

public static class Security
{
    public const string SecretHeader = "X-UTS-Secret";

    public static bool IsLocalRequest(HttpContext ctx)
    {
        var remoteIp = ctx.Connection.RemoteIpAddress;
        if (remoteIp == null) return false;

        return remoteIp.Equals(System.Net.IPAddress.Loopback) || remoteIp.Equals(System.Net.IPAddress.IPv6Loopback);
    }

    public static bool HasValidSecret(HttpContext ctx, AppSettings settings)
    {
        if (!ctx.Request.Headers.TryGetValue(SecretHeader, out var v)) return false;
        return v.Count == 1 && v[0] == settings.ApiSecret;
    }
}