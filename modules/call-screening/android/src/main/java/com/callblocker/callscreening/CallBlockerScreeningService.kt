package com.callblocker.callscreening

import android.telecom.Call
import android.telecom.CallScreeningService

/**
 * The platform piece of Blocking: the service Android hands every incoming call
 * to before it rings.
 *
 * It reads the snapshot the app wrote, normalizes the incoming number to a
 * Canonical number with the snapshot's Default region, and runs the same
 * matching table every other engine runs. A blocked call is rejected, stays in
 * the system call log, and never rings or buzzes.
 */
class CallBlockerScreeningService : CallScreeningService() {
  override fun onScreenCall(callDetails: Call.Details) {
    val snapshot = RuleStore.readSnapshot(this)
    // (1) Blocking off, or nothing loaded yet: the call is left alone.
    if (snapshot == null || !snapshot.blocking) {
      respondToCall(callDetails, allowed())
      return
    }

    val query = canonicalNumber(callDetails.handle?.schemeSpecificPart, snapshot.defaultRegion)
    if (query == null) {
      // Nothing to match on: never block a call we cannot identify.
      respondToCall(callDetails, allowed())
      return
    }

    val result = evaluate(snapshot.toInput(), query)
    respondToCall(callDetails, responseFor(result.blocked))
  }

  private fun responseFor(blocked: Boolean): CallScreeningService.CallResponse =
    CallScreeningService.CallResponse.Builder()
      .setDisallowCall(blocked)
      .setRejectCall(blocked)
      .setSkipCallLog(false)
      .setSkipNotification(true)
      .build()

  private fun allowed(): CallScreeningService.CallResponse =
    CallScreeningService.CallResponse.Builder()
      .setDisallowCall(false)
      .setRejectCall(false)
      .setSkipCallLog(false)
      .setSkipNotification(false)
      .build()
}
