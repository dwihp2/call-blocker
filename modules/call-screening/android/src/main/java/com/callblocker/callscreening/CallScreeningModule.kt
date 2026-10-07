package com.callblocker.callscreening

import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val REQUEST_SCREENING_ROLE = 47110

/**
 * The JavaScript face of the Android engine.
 *
 * Blocking on Android is the app holding the call screening role: the app writes
 * a snapshot of its settings and Rules through [RuleStore], and
 * [CallBlockerScreeningService] is the piece the system calls.
 */
class CallScreeningModule : Module() {
  private var rolePromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("CallScreening")

    Function("isSupported") { true }

    AsyncFunction("getStatus") {
      val roleHeld = isRoleHeld()
      mapOf(
        "active" to roleHeld,
        "platformPieceOn" to roleHeld,
        "detail" to roleDetail(roleHeld)
      )
    }

    AsyncFunction("requestScreeningRole") { promise: Promise ->
      val activity = appContext.currentActivity
      val manager = roleManager()
      if (activity == null || manager == null) {
        // Android 9 and below have no call screening role: Settings is the only route.
        promise.resolve(mapOf("screeningRole" to false))
        return@AsyncFunction
      }
      rolePromise = promise
      activity.startActivityForResult(
        manager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING),
        REQUEST_SCREENING_ROLE
      )
    }

    AsyncFunction("openRoleSettings") {
      openRoleSettings()
    }

    AsyncFunction("sync") { input: Map<String, Any?> ->
      val engineInput = engineInputOf(input)
      val defaultRegion = RuleStore.readSnapshot(androidContext())?.defaultRegion
        ?: deviceRegion(androidContext())
      val written = RuleStore.write(androidContext(), engineInput, defaultRegion)
      mapOf(
        "written" to written,
        "entries" to engineInput.rules.size,
        // Android has no Capacity: it never refuses a Rule.
        "capacity" to 0,
        "overflow" to false,
        "rejected" to emptyList<Int>()
      )
    }

    AsyncFunction("checkNumber") { input: Map<String, Any?> ->
      val passed = engineInputOf(input)
      // Evaluated on the spot, against the input just passed: a Number check
      // never depends on a stale snapshot.
      val result = evaluate(passed, input["query"] as? String ?: "")
      mapOf(
        "blocked" to result.blocked,
        "decidedBy" to decisionOf(result.decidedBy),
        "matches" to result.matches
      )
    }

    AsyncFunction("selfCheck") { fixturesJson: String ->
      mapOf("failures" to fixtureFailures(fixturesJson))
    }

    /**
     * ADR 0006: the permissions this build asks Android for, read back from the
     * package manager — the same list the system's Permissions page shows for
     * the app, so the Privacy screen cannot claim more or less than the truth.
     */
    AsyncFunction("getRequestedPermissions") {
      val context = androidContext()
      @Suppress("DEPRECATION")
      val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
      (info.requestedPermissions ?: emptyArray()).sorted()
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == REQUEST_SCREENING_ROLE) {
        val promise = rolePromise
        rolePromise = null
        promise?.resolve(mapOf("screeningRole" to isRoleHeld()))
      }
    }
  }

  private fun androidContext(): Context = appContext.reactContext
    ?: appContext.currentActivity
    ?: throw IllegalStateException("CallScreening has no Android context")

  private fun roleManager(): RoleManager? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      return null
    }
    return androidContext().getSystemService(RoleManager::class.java)
  }

  private fun isRoleHeld(): Boolean =
    roleManager()?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) ?: false

  private fun roleDetail(roleHeld: Boolean): String = when {
    Build.VERSION.SDK_INT < Build.VERSION_CODES.Q -> "Call screening needs Android 10 or later"
    roleHeld -> "Call screening role held"
    else -> "Call screening role not granted"
  }

  private fun openRoleSettings() {
    val activity = appContext.currentActivity ?: return
    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
    } else {
      appDetailsIntent() ?: return
    }
    try {
      activity.startActivity(intent)
    } catch (error: Exception) {
      appDetailsIntent()?.let { activity.startActivity(it) }
    }
  }

  private fun appDetailsIntent(): Intent? {
    val packageName = appContext.reactContext?.packageName ?: return null
    return Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
  }
}

private fun engineInputOf(input: Map<String, Any?>): EngineInput = EngineInput(
  blocking = input["blocking"] as? Boolean ?: true,
  rules = (input["rules"] as? List<*>)?.mapNotNull { ruleOf(it) } ?: emptyList()
)

private fun ruleOf(value: Any?): EngineRule? {
  val rule = value as? Map<*, *> ?: return null
  val number = rule["number"] as? String ?: return null
  return EngineRule(
    kind = rule["kind"] as? String ?: "block",
    pattern = rule["pattern"] as? String ?: "single",
    number = number,
    end = rule["end"] as? String
  )
}

private fun decisionOf(decision: Decision): Map<String, Any?> = when (decision) {
  is Decision.Rule -> mapOf("type" to "rule", "index" to decision.index)
  Decision.Off -> mapOf("type" to "off")
  Decision.None -> mapOf("type" to "none")
}
