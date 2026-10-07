package com.callblocker.callscreening

import android.content.Context
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * The snapshot the screening service reads at call time: the Blocking switch,
 * the Default region and the Rules, as one JSON file at
 * `filesDir/call-screening/snapshot.json`.
 *
 * Writes land through a temporary file and a rename, so a call arriving while
 * the app syncs never reads a half-written snapshot.
 */
object RuleStore {
  private const val DIRECTORY_NAME = "call-screening"
  private const val FILE_NAME = "snapshot.json"
  private const val TEMP_FILE_NAME = "snapshot.json.tmp"

  private const val KEY_BLOCKING = "blocking"
  private const val KEY_DEFAULT_REGION = "defaultRegion"
  private const val KEY_RULES = "rules"

  /** The snapshot as the app wrote it: everything Blocking needs. */
  data class Snapshot(
    val blocking: Boolean,
    val defaultRegion: String,
    val rules: List<EngineRule>
  ) {
    fun toInput(): EngineInput = EngineInput(blocking, rules)
  }

  @Volatile private var cachedSnapshot: Snapshot? = null
  @Volatile private var cachedStamp: String? = null

  /**
   * The snapshot, or null when nothing has been written yet. Cached in memory
   * until the file's `lastModified()` and length change.
   */
  fun readSnapshot(context: Context): Snapshot? {
    val file = snapshotFile(context)
    val stamp = stampOf(file)
    if (stamp == null) {
      cachedSnapshot = null
      cachedStamp = null
      return null
    }
    val cached = cachedSnapshot
    if (cached != null && cachedStamp == stamp) {
      return cached
    }
    val parsed = try {
      parse(file.readText())
    } catch (error: Exception) {
      // A snapshot we cannot read is no snapshot: Blocking stays off.
      null
    }
    cachedSnapshot = parsed
    cachedStamp = if (parsed == null) null else stamp
    return parsed
  }

  /**
   * The snapshot as an [EngineInput]. Blocking off when nothing has been
   * written yet, so a call is allowed.
   */
  fun read(context: Context): EngineInput =
    readSnapshot(context)?.toInput()
      ?: EngineInput(blocking = false, rules = emptyList())

  /** Writes the snapshot, replacing the previous one in a single rename. */
  fun write(context: Context, input: EngineInput, defaultRegion: String): Boolean {
    val directory = directory(context)
    if (!directory.exists() && !directory.mkdirs()) {
      return false
    }
    val payload = JSONObject().apply {
      put(KEY_BLOCKING, input.blocking)
      put(KEY_DEFAULT_REGION, defaultRegion)
      put(KEY_RULES, rulesToJson(input.rules))
    }
    val written = try {
      val temporary = File(directory, TEMP_FILE_NAME)
      temporary.writeText(payload.toString())
      val target = File(directory, FILE_NAME)
      if (temporary.renameTo(target)) {
        true
      } else {
        // Some filesystems refuse to replace an existing file: clear it and try once more.
        if (target.exists()) {
          target.delete()
        }
        temporary.renameTo(target)
      }
    } catch (error: Exception) {
      false
    }
    // The file on disk is the truth now, so drop the cache and read it back.
    cachedSnapshot = null
    cachedStamp = null
    return written
  }

  /** Where the snapshot lives. */
  fun directory(context: Context): File = File(context.filesDir, DIRECTORY_NAME)

  private fun snapshotFile(context: Context): File = File(directory(context), FILE_NAME)

  private fun stampOf(file: File): String? {
    if (!file.isFile) return null
    return "${file.lastModified()}:${file.length()}"
  }

  private fun parse(text: String): Snapshot {
    val json = JSONObject(text)
    return Snapshot(
      blocking = json.optBoolean(KEY_BLOCKING, true),
      defaultRegion = json.optString(KEY_DEFAULT_REGION, "US"),
      rules = rulesOf(json.optJSONArray(KEY_RULES))
    )
  }

  private fun rulesToJson(rules: List<EngineRule>): JSONArray {
    val array = JSONArray()
    for (rule in rules) {
      val object_ = JSONObject()
      object_.put("kind", rule.kind)
      object_.put("pattern", rule.pattern)
      object_.put("number", rule.number)
      val end = rule.end
      if (end != null) {
        object_.put("end", end)
      }
      array.put(object_)
    }
    return array
  }
}
