// job-run: runs one command inside a Windows Job Object that kills every
// process in it when the job's last handle closes (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE).
// This helper holds the only handle. So:
//   - when the command exits, this helper exits and every descendant still
//     running is killed by the kernel;
//   - when the harness terminates this helper (a cap, an abort), the job is
//     closed and the whole tree is killed at once.
// Breakaway is not allowed, so a descendant cannot leave the job.
// Usage: job-run.exe <status-file> <command> [args...]
// The command inherits this process's standard handles, environment and
// working directory. The status file receives, as JSON, the command's exit
// code and how many processes were still alive in the job when it exited.
// Compiled with the .NET Framework's in-box csc.exe (C# 5); no dependency.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class JobRun
{
    const uint JobObjectExtendedLimitInformation = 9;
    const uint JobObjectBasicAccountingInformation = 1;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    const uint CREATE_SUSPENDED = 0x4;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x400;
    const int STARTF_USESTDHANDLES = 0x100;
    const uint INFINITE = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS { public ulong a, b, c, d, e, f; }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, uint cls, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, uint cls, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, uint size, IntPtr ret);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr h, uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int which);

    // Quotes one argument by the rules CommandLineToArgvW and the C runtime use.
    static string Quote(string a)
    {
        if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return a;
        var sb = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in a)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { sb.Append('\\', slashes * 2 + 1); sb.Append('"'); }
            else { sb.Append('\\', slashes); sb.Append(c); }
            slashes = 0;
        }
        sb.Append('\\', slashes * 2);
        sb.Append('"');
        return sb.ToString();
    }

    static int Fail(string what)
    {
        Console.Error.WriteLine("job-run: " + what + ": " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
        return 125;
    }

    static int Main(string[] args)
    {
        if (args.Length < 2) { Console.Error.WriteLine("usage: job-run <status-file> <command> [args...]"); return 125; }
        string statusFile = args[0];
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return Fail("CreateJobObject");
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref info, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)))) return Fail("SetInformationJobObject");

        var cmd = new StringBuilder();
        for (int i = 1; i < args.Length; i++) { if (i > 1) cmd.Append(' '); cmd.Append(Quote(args[i])); }
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = GetStdHandle(-10);
        si.hStdOutput = GetStdHandle(-11);
        si.hStdError = GetStdHandle(-12);
        PROCESS_INFORMATION pi;
        if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, null, ref si, out pi)) return Fail("CreateProcess");
        if (!AssignProcessToJobObject(job, pi.hProcess)) { TerminateProcess(pi.hProcess, 125); return Fail("AssignProcessToJobObject"); }
        ResumeThread(pi.hThread);
        WaitForSingleObject(pi.hProcess, INFINITE);
        uint code;
        GetExitCodeProcess(pi.hProcess, out code);
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION acct;
        uint active = 0, total = 0;
        if (QueryInformationJobObject(job, JobObjectBasicAccountingInformation, out acct, (uint)Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), IntPtr.Zero)) { active = acct.ActiveProcesses; total = acct.TotalProcesses; }
        try { File.WriteAllText(statusFile, "{\"exitCode\":" + code + ",\"activeAtExit\":" + active + ",\"totalProcesses\":" + total + "}"); } catch { }
        // Returning closes the job's only handle: the kernel kills whatever is still in it.
        return (int)code;
    }
}
