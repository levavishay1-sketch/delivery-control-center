// Smoke test written by DCC onboarding: proves `dotnet test` can run here.
// It needs a test project that includes this file — for example
// `dotnet new mstest -o Tests/Smoke` and a reference from the solution.
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Smoke
{
    [TestClass]
    public class SmokeTests
    {
        [TestMethod]
        public void TheTestRunnerWorks()
        {
            Assert.AreEqual(2, 1 + 1);
        }
    }
}
