package com.callblocker.callscreening

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import com.google.i18n.phonenumbers.NumberParseException
import com.google.i18n.phonenumbers.PhoneNumberUtil

/**
 * The device's contacts, as Canonical numbers.
 *
 * Callers check `READ_CONTACTS` first: without it the list is empty rather than
 * an exception, because a missing permission must never keep a call from being
 * screened.
 */
object Contacts {
  /** Is `READ_CONTACTS` granted? */
  fun hasPermission(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

  /**
   * Every distinct number in the device's contacts, normalized to E.164 with
   * [defaultRegion] (the device's region when null). Empty without
   * `READ_CONTACTS`.
   */
  fun read(context: Context, defaultRegion: String? = null): List<String> {
    if (!hasPermission(context)) {
      return emptyList()
    }
    val region = regionOrDefault(defaultRegion, context)
    val numbers = LinkedHashSet<String>()
    val cursor = try {
      context.contentResolver.query(
        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
        arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
        null,
        null,
        null
      )
    } catch (error: SecurityException) {
      null
    } ?: return emptyList()

    cursor.use { rows ->
      val column = rows.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
      if (column < 0) {
        return emptyList()
      }
      while (rows.moveToNext()) {
        val raw = if (rows.isNull(column)) null else rows.getString(column)
        val canonical = canonicalNumber(raw, region)
        if (canonical != null) {
          numbers.add(canonical)
        }
      }
    }
    return numbers.toList()
  }

  /** The device's region, e.g. `ID`, or `US` when Android reports none. */
  fun deviceRegion(context: Context): String {
    val locales = context.resources.configuration.locales
    val country = if (locales.isEmpty) "" else locales.get(0).country
    return if (country.isNullOrBlank()) "US" else country
  }

  /** [defaultRegion] when it is usable, otherwise the device's region. */
  fun regionOrDefault(defaultRegion: String?, context: Context): String =
    if (defaultRegion.isNullOrBlank()) deviceRegion(context) else defaultRegion
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
