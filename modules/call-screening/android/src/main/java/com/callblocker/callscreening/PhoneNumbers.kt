package com.callblocker.callscreening

import android.content.Context
import com.google.i18n.phonenumbers.NumberParseException
import com.google.i18n.phonenumbers.PhoneNumberUtil

/** The device's region, e.g. `ID`, or `US` when Android reports none. */
fun deviceRegion(context: Context): String {
  val locales = context.resources.configuration.locales
  val country = if (locales.isEmpty) "" else locales.get(0).country
  return if (country.isNullOrBlank()) "US" else country
}

/**
 * A phone number as Canonical E.164, using libphonenumber with [region] as the
 * Default region. A number libphonenumber cannot parse falls back to `+` and
 * its digits, so an unusual number is still screened instead of slipping past.
 * Returns null when there is nothing number-like to work with.
 */
internal fun canonicalNumber(raw: String?, region: String): String? {
  if (raw.isNullOrBlank()) {
    return null
  }
  val defaultRegion = region.ifBlank { "US" }
  val util = PhoneNumberUtil.getInstance()
  try {
    val parsed = util.parse(raw, defaultRegion)
    if (util.isValidNumber(parsed)) {
      return util.format(parsed, PhoneNumberUtil.PhoneNumberFormat.E164)
    }
  } catch (error: NumberParseException) {
    // Fall through to the digits below.
  }
  val digits = digitsOf(raw)
  return if (digits.isEmpty()) null else "+$digits"
}
