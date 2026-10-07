package com.callblocker.callscreening

import java.math.BigInteger
import org.json.JSONArray
import org.json.JSONObject

/**
 * A Rule as the matching engine sees it: what kind it is, which Number pattern
 * it holds, and the number that pattern is built from. `end` is set for an
 * Interval only.
 */
data class EngineRule(val kind: String, val pattern: String, val number: String, val end: String?)

/**
 * Everything the engine needs to answer a query. The Rules are in the app's
 * canonical order and that order is part of the contract.
 */
data class EngineInput(
  val blocking: Boolean,
  val rules: List<EngineRule>
)

/** What settled a decision. `index` points into the Rules the engine was given. */
sealed class Decision {
  data class Rule(val index: Int) : Decision()
  object Off : Decision()
  object None : Decision()
}

data class Result(val blocked: Boolean, val decidedBy: Decision, val matches: List<Int>)

private const val KIND_BLOCK = "block"
private const val KIND_ALLOW = "allow"

private const val PATTERN_SINGLE = "single"
private const val PATTERN_PREFIX = "prefix"
private const val PATTERN_INTERVAL = "interval"

/**
 * The matching half of the Android engine, written as plain JVM Kotlin: it must
 * keep no `android.*` imports so the fixture table can be run by a JVM unit test.
 *
 * Precedence, highest first, as stated by `fixtures/matching.json`:
 * (1) Blocking off decides `off` and no Rule is consulted.
 * (2) A matching Allow rule decides `rule` and allows the call, whatever size
 *     the Block rule it overrides is.
 * (3) A matching Single number Block rule decides `rule` and blocks the call.
 * (4) Any other matching Block rule decides `rule` and blocks the call.
 * (5) Otherwise `none`, allowed.
 * When several Block rules match, the most specific reports: Single number
 * first, then the first Prefix or Interval in input order. When several Allow
 * rules match, the first in input order reports.
 */
fun evaluate(input: EngineInput, query: String): Result {
  val queryDigits = digitsOf(query)

  val matches = ArrayList<Int>(input.rules.size)
  for (index in input.rules.indices) {
    if (ruleMatches(input.rules[index], queryDigits)) {
      matches.add(index)
    }
  }
  val matched = matches.toList()

  // (1) Blocking off: no Rule is consulted.
  if (!input.blocking) {
    return Result(blocked = false, decidedBy = Decision.Off, matches = matched)
  }

  // (2) The first matching Allow rule allows the call.
  for (index in matched) {
    if (input.rules[index].kind == KIND_ALLOW) {
      return Result(blocked = false, decidedBy = Decision.Rule(index), matches = matched)
    }
  }

  // (3) A matching Single number Block rule.
  for (index in matched) {
    val rule = input.rules[index]
    if (rule.kind == KIND_BLOCK && rule.pattern == PATTERN_SINGLE) {
      return Result(blocked = true, decidedBy = Decision.Rule(index), matches = matched)
    }
  }

  // (4) Any other matching Block rule.
  for (index in matched) {
    if (input.rules[index].kind == KIND_BLOCK) {
      return Result(blocked = true, decidedBy = Decision.Rule(index), matches = matched)
    }
  }

  // (5) Nothing matched.
  return Result(blocked = false, decidedBy = Decision.None, matches = matched)
}

/**
 * Runs every case in a fixture table through [evaluate]. Returns one line per
 * failing case, `"<name>: expected <x>, got <y>"`, and nothing when the whole
 * table passes. A table that cannot be read is itself a failure.
 */
fun fixtureFailures(fixturesJson: String): List<String> {
  val root = try {
    JSONObject(fixturesJson)
  } catch (error: Exception) {
    return listOf("fixture file is not valid JSON: ${error.message}")
  }
  val cases = root.optJSONArray("cases") ?: return listOf("fixture file has no cases array")

  val failures = ArrayList<String>()
  for (index in 0 until cases.length()) {
    val case = cases.optJSONObject(index)
    if (case == null) {
      failures.add("case $index: not an object")
      continue
    }
    val name = case.optString("name", "case $index")
    val actual = evaluate(engineInputOf(case), case.optString("query", ""))
    val expected = case.optJSONObject("expect")
    val expectedBlocked = expected?.optBoolean("blocked", false) ?: false
    val expectedDecision = expected?.optJSONObject("decidedBy")
    val expectedType = expectedDecision?.optString("type", "none") ?: "none"
    val expectedIndex = if (expectedType == "rule" && expectedDecision?.has("index") == true) {
      expectedDecision.optInt("index", -1)
    } else {
      null
    }

    if (actual.blocked != expectedBlocked ||
      decisionTypeOf(actual.decidedBy) != expectedType ||
      decisionIndexOf(actual.decidedBy) != expectedIndex
    ) {
      failures.add(
        "$name: expected " + describe(expectedBlocked, expectedType, expectedIndex) +
          ", got " + describe(actual.blocked, decisionTypeOf(actual.decidedBy), decisionIndexOf(actual.decidedBy))
      )
    }
  }
  return failures
}

/** The E.164 digits of a number: everything matching `[0-9]`, without any `+`. */
internal fun digitsOf(value: String?): String {
  if (value == null) return ""
  val builder = StringBuilder(value.length)
  for (character in value) {
    if (character in '0'..'9') {
      builder.append(character)
    }
  }
  return builder.toString()
}

private fun ruleMatches(rule: EngineRule, queryDigits: String): Boolean {
  val numberDigits = digitsOf(rule.number)
  return when (rule.pattern) {
    PATTERN_SINGLE -> queryDigits.isNotEmpty() && queryDigits == numberDigits
    PATTERN_PREFIX -> numberDigits.isNotEmpty() && queryDigits.startsWith(numberDigits)
    PATTERN_INTERVAL -> intervalContains(queryDigits, numberDigits, digitsOf(rule.end))
    else -> false
  }
}

/**
 * Intervals compare numerically, inclusively. Intervals are at most ten digits
 * long, but a malformed Rule (a missing or unparsable end) must never throw, so
 * it simply does not match.
 */
private fun intervalContains(queryDigits: String, startDigits: String, endDigits: String): Boolean {
  if (queryDigits.isEmpty() || startDigits.isEmpty() || endDigits.isEmpty()) return false
  return try {
    // `BigInteger` accepts a leading `+`, and a version string like `+62812` is
    // never parsed as a Long.
    val value: BigInteger = BigInteger(queryDigits)
    value >= BigInteger(startDigits) && value <= BigInteger(endDigits)
  } catch (error: NumberFormatException) {
    false
  }
}

private fun decisionTypeOf(decision: Decision): String = when (decision) {
  is Decision.Rule -> "rule"
  Decision.Off -> "off"
  Decision.None -> "none"
}

private fun decisionIndexOf(decision: Decision): Int? = (decision as? Decision.Rule)?.index

private fun describe(blocked: Boolean, type: String, index: Int?): String {
  val decidedBy = if (type == "rule" && index != null) "rule($index)" else type
  return "blocked=$blocked decidedBy=$decidedBy"
}

internal fun engineInputOf(json: JSONObject): EngineInput = EngineInput(
  blocking = if (json.has("blocking")) json.optBoolean("blocking", true) else true,
  rules = rulesOf(json.optJSONArray("rules"))
)

internal fun rulesOf(array: JSONArray?): List<EngineRule> {
  if (array == null) return emptyList()
  val rules = ArrayList<EngineRule>(array.length())
  for (index in 0 until array.length()) {
    val rule = array.optJSONObject(index) ?: continue
    rules.add(
      EngineRule(
        kind = rule.optString("kind", KIND_BLOCK),
        pattern = rule.optString("pattern", PATTERN_SINGLE),
        number = rule.optString("number", ""),
        end = if (rule.has("end") && !rule.isNull("end")) rule.optString("end") else null
      )
    )
  }
  return rules
}
