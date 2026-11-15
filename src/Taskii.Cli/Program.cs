using System.Text;
using Taskii.Cli;
using Taskii.Core;

Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

return Cli.Run(args, new CliContext(
    Console.Out,
    Console.Error,
    TaskiiHome.Folder,
    DateOnly.FromDateTime(DateTime.Now),
    Environment.GetEnvironmentVariable("TASKII_DATA")));
