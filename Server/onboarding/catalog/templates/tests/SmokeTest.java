// Smoke test written by DCC onboarding: proves the JUnit 5 runner works here.
// It needs junit-jupiter on the test classpath (Maven: junit-jupiter in
// <dependencies> with test scope; Gradle: testImplementation + useJUnitPlatform()).
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SmokeTest {

    @Test
    void theTestRunnerWorks() {
        assertEquals(2, 1 + 1);
    }
}
