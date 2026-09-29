package com.callblocker.callscreening

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Runs the whole matching contract, `fixtures/matching.json`, through the
 * engine. The path arrives as the `fixtures.path` system property, which
 * `android/build.gradle` sets for every Test task.
 */
class RuleEngineFixtureTest {
  @Test
  fun everyFixtureCasePasses() {
    val path = System.getProperty("fixtures.path")
    if (path.isNullOrBlank()) {
      throw AssertionError("the fixtures.path system property is not set")
    }
    val fixtures = File(path)
    assertTrue("no fixture file at ${fixtures.absolutePath}", fixtures.isFile)

    val failures = fixtureFailures(fixtures.readText())
    for (failure in failures) {
      println(failure)
    }
    assertTrue(
      "${failures.size} fixture case(s) failed:\n" + failures.joinToString("\n"),
      failures.isEmpty()
    )
  }
}
