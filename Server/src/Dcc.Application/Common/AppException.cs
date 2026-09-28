namespace Dcc.Application.Common;

/// <summary>
/// An expected failure with an HTTP status and a stable code. The API turns it
/// into <c>{ "error": code, "message": … }</c> — the same shape the web client
/// already reads.
/// </summary>
public class AppException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;

    public static AppException BadRequest(string code, string message) => new(400, code, message);
    public static AppException Unauthorized(string code, string message) => new(401, code, message);
    public static AppException Forbidden(string code, string message) => new(403, code, message);
    public static AppException NotFound(string what) => new(404, "not_found", $"{what} not found");
    public static AppException Conflict(string code, string message) => new(409, code, message);
}
