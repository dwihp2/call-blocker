import {
  backupFileName,
  buildBackupFile,
  isDuplicate,
  mergeBackup,
  parseBackup,
  replaceBackup,
  serializeBackup,
} from '@call-blocker/core';
import type { BackupFile, E164, PatternType, Rule } from '@call-blocker/core';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { restoreRules } from '@/data/actions';
import { isSupported, UNSUPPORTED_DETAIL } from '@/data/engine';
import { newRuleId, useStore } from '@/data/store';
import { describeError, formatCount, formatDate, kindLabel, patternText } from '@/format';
import { AppText, Banner, Button, Card, KeyValueRow, Row, Screen, Section } from '@/ui/components';

/** Backup files are written into their own folder inside the cache directory. */
const BACKUP_DIRECTORY = 'backups';

interface PickedFile {
  fileName: string;
  file: BackupFile;
}

/**
 * How a Merge would land: a file rule is already in the Block list when it
 * matches a Rule the Block list holds, or one the file has already put there.
 */
function countRestored(blockRules: Rule[], file: BackupFile): { imported: number; duplicates: number } {
  const held: Array<{ pattern: PatternType; number: E164; end?: E164 }> = [...blockRules];
  let duplicates = 0;
  for (const from of file.rules) {
    if (held.some((rule) => isDuplicate(rule, from))) duplicates += 1;
    else held.push(from);
  }
  return { imported: file.rules.length - duplicates, duplicates };
}

type RestoreMode = 'merge' | 'replace';

interface RestoreOutcome {
  mode: RestoreMode;
  /** Block rules the file contributed that the engine accepted and are now saved. */
  added: number;
  /** Merge only: file rules the Block list already held. */
  duplicates: number;
  /** How many Rules are saved on this device now, the Block list and the Allow list together. */
  applied: number;
  /** The Rules the engine refused, named by `message`. */
  rejected: Rule[];
  message: string | null;
}

export default function BackupScreen() {
  const { state } = useStore();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<RestoreMode | null>(null);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);

  const { rules, settings } = state;
  const blockRules = useMemo(() => rules.filter((rule) => rule.kind === 'block'), [rules]);
  const allowCount = rules.length - blockRules.length;
  const filesAvailable = Platform.OS !== 'web' && isSupported();

  /** What a Restore of the picked file would do to the Block list as it stands now. */
  const preview = useMemo(() => {
    if (!picked) return null;
    return { fileName: picked.fileName, file: picked.file, ...countRestored(blockRules, picked.file) };
  }, [picked, blockRules]);

  const exportBackup = async () => {
    setExporting(true);
    setExportError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setExportError('Sharing is not available on this device, so the Backup file cannot be handed on.');
        return;
      }
      const now = new Date();
      const directory = new Directory(Paths.cache, BACKUP_DIRECTORY);
      if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
      const file = new File(directory, backupFileName(now));
      file.write(serializeBackup(buildBackupFile(blockRules, now.toISOString())));
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        UTI: 'public.json',
        dialogTitle: `Backup file with ${formatCount(blockRules.length)} Block rules`,
      });
    } catch (reason) {
      setExportError(describeError(reason));
    } finally {
      setExporting(false);
    }
  };

  const chooseFile = async () => {
    setPicking(true);
    setPickError(null);
    try {
      const chosen = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (chosen.canceled) return;
      const asset = chosen.assets[0];
      if (!asset) return;
      const text = await new File(asset.uri).text();
      const parsed = parseBackup(text);
      if (!parsed.ok) {
        setPicked(null);
        setOutcome(null);
        setPickError(parsed.message);
        return;
      }
      setPicked({ fileName: asset.name, file: parsed.file });
      setOutcome(null);
    } catch (reason) {
      setPicked(null);
      setOutcome(null);
      setPickError(describeError(reason));
    } finally {
      setPicking(false);
    }
  };

  const restore = async (mode: RestoreMode) => {
    if (!preview) return;
    const allowRules = rules.filter((rule) => rule.kind === 'allow');
    const now = new Date().toISOString();
    let nextBlockRules: Rule[];
    let imported: number;
    let duplicates = 0;
    if (mode === 'merge') {
      const merged = mergeBackup(blockRules, preview.file, now, newRuleId);
      nextBlockRules = merged.rules;
      imported = merged.imported;
      duplicates = merged.duplicates;
    } else {
      const replaced = replaceBackup(preview.file, now, newRuleId);
      nextBlockRules = replaced.rules;
      imported = replaced.imported;
    }
    setRestoring(mode);
    setOutcome(null);
    // The Allow list goes through untouched, after the Block rules.
    const result = await restoreRules([...nextBlockRules, ...allowRules]);
    setRestoring(null);
    const heldIds = new Set(blockRules.map((rule) => rule.id));
    const introduced = new Set(nextBlockRules.filter((rule) => !heldIds.has(rule.id)).map((rule) => rule.id));
    const refusedFromFile = result.rejected.filter((rule) => introduced.has(rule.id)).length;
    setOutcome({
      mode,
      added: imported - refusedFromFile,
      duplicates,
      applied: result.applied,
      rejected: result.rejected,
      message: result.message,
    });
  };

  const refused = outcome
    ? outcome.rejected.map((rule) => `${kindLabel(rule.kind)} · ${patternText(rule, settings.defaultRegion)}`)
    : [];

  return (
    <Screen>
      {filesAvailable ? null : (
        <Banner
          tone="info"
          title="Backup needs a device"
          message={`${UNSUPPORTED_DETAIL} Sharing a Backup file and choosing one to Restore both need iOS or Android, so this screen cannot do either here.`}
        />
      )}

      <Section
        title="Export"
        description="Write your Block rules to a Backup file you can keep, or carry to another phone.">
        <Banner
          tone="info"
          title="A Backup file holds Block rules only"
          message="Allow rules are not included in it. A Restore onto a new phone therefore comes back without the Allow rules that used to protect wanted numbers."
        />
        <Card>
          <KeyValueRow label="Block rules to export" value={formatCount(blockRules.length)} />
        </Card>
        <Button
          label="Export Backup file"
          busy={exporting}
          disabled={!filesAvailable || blockRules.length === 0}
          onPress={() => void exportBackup()}
        />
        {blockRules.length === 0 ? (
          <AppText variant="small" tone="secondary">
            There is nothing to export yet: your Block list is empty, so register a Block rule first.
          </AppText>
        ) : null}
        {exportError ? (
          <Banner tone="danger" title="The Backup file was not shared" message={exportError} />
        ) : null}
      </Section>

      <Section
        title="Restore"
        description="Load a Backup file back into the Block list. The Allow list on this device is kept either way.">
        <Button
          label="Choose file"
          variant="secondary"
          busy={picking}
          disabled={!filesAvailable}
          onPress={() => void chooseFile()}
        />
        {pickError ? (
          <Banner tone="danger" title="That file could not be read" message={pickError} />
        ) : null}
        {preview ? (
          <>
            <Card>
              <KeyValueRow label="Backup file" value={preview.fileName} tone="default" />
              <KeyValueRow label="Written" value={formatDate(preview.file.exportedAt)} />
              <KeyValueRow label="Block rules in the file" value={formatCount(preview.file.rules.length)} />
              <KeyValueRow label="New to your Block list" value={formatCount(preview.imported)} />
              <KeyValueRow label="Already in your Block list" value={formatCount(preview.duplicates)} />
            </Card>
            <Banner
              tone="warning"
              title="Allow rules are not in a Backup file"
              message="A Restore never touches the Allow list already on this device. On a new phone there is no Allow list yet, so numbers that Allow rules used to protect need those rules registered again."
            />
            <AppText variant="small" tone="secondary">
              {'Merge adds the file\'s Block rules to the ones you have. Replace discards your current Block list and puts the file\'s Block rules in its place. Neither touches your Allow list.'}
            </AppText>
            <Row>
              <Button
                label="Merge"
                busy={restoring === 'merge'}
                disabled={restoring !== null}
                onPress={() => void restore('merge')}
                style={styles.action}
              />
              <Button
                label="Replace"
                variant="danger"
                busy={restoring === 'replace'}
                disabled={restoring !== null}
                onPress={() => void restore('replace')}
                style={styles.action}
              />
            </Row>
          </>
        ) : (
          <AppText variant="small" tone="secondary">
            Choose a Backup file to see what a Restore would change before anything is written.
          </AppText>
        )}
      </Section>

      {preview && outcome ? (
        <Section title="Restore finished">
          <Banner
            tone={outcome.rejected.length === 0 ? 'success' : 'warning'}
            title={
              outcome.mode === 'merge'
                ? 'The file was merged into your Block list'
                : 'Your Block list was replaced by the file'
            }
            message="Your Allow list was left as it was: a Restore never changes it."
          />
          <Card>
            {outcome.mode === 'merge' ? (
              <KeyValueRow label="New Block rules added" value={formatCount(outcome.added)} />
            ) : (
              <KeyValueRow label="Block rules in your Block list now" value={formatCount(outcome.added)} />
            )}
            {outcome.mode === 'merge' ? (
              <KeyValueRow label="Already in your Block list" value={formatCount(outcome.duplicates)} />
            ) : null}
            <KeyValueRow label="Rules saved now" value={formatCount(outcome.applied)} />
            <KeyValueRow label="Allow rules kept" value={formatCount(allowCount)} />
          </Card>
          {outcome.message ? (
            <Banner
              tone="danger"
              title="Not every Rule was saved"
              message={[outcome.message, ...refused].join('\n')}
            />
          ) : null}
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1 },
});
