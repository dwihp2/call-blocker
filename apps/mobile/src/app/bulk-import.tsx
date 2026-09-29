/**
 * Bulk import: registering many Rules at once from pasted lines, with one
 * Block or Allow choice for the whole import (ADR 0004). The platform applies
 * what fits, and the lines it refused are reported with their line numbers.
 */

import { isDuplicate, parseBulkText } from '@call-blocker/core';
import type { RegionCode, RuleInput, RuleKind } from '@call-blocker/core';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { importRules } from '@/data/actions';
import type { ImportEntry, ImportOutcome } from '@/data/actions';
import { isSupported, UNSUPPORTED_DETAIL } from '@/data/engine';
import { useStore } from '@/data/store';
import { describeError, formatCount, kindLabel, patternText } from '@/format';
import {
  AppText,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  KeyValueRow,
  Row,
  Screen,
  Section,
  Segmented,
  TextField,
} from '@/ui/components';
import { RegionPicker } from '@/ui/region-picker';
import { Spacing } from '@/ui/theme';

const LINE_FORMAT =
  'One Rule per line: a number (08123456789), a prefix (08123*), an interval (6281100-6281199), or any of them with a Label after a comma (08123456789, Debt collector).';

/** One physical line of the pasted text, split into the number text and the Label. */
interface PastedLine {
  /** 1-based physical line of the pasted text. */
  line: number;
  raw: string;
  /** The text before the first comma: the number, prefix, or interval core reads. */
  numberText: string;
  label?: string;
}

/**
 * A line's Label starts at its first comma, so a Label may hold commas of its
 * own. Every line is stripped the same way before core reads it, and the
 * originals are kept so the preview can show exactly what was pasted.
 */
function splitPastedLines(text: string): PastedLine[] {
  return text.split(/\r?\n/u).map((raw, index) => {
    const trimmed = raw.trim();
    const comma = trimmed.indexOf(',');
    const pasted: PastedLine = {
      line: index + 1,
      raw,
      numberText: comma === -1 ? trimmed : trimmed.slice(0, comma).trim(),
    };
    if (comma !== -1) {
      const label = trimmed.slice(comma + 1).trim();
      if (label.length > 0) pasted.label = label;
    }
    return pasted;
  });
}

interface PreviewLineBase {
  line: number;
  raw: string;
  label?: string;
  /** What will become of this line, shown under the text it was read from. */
  detail: string;
}

type PreviewLine =
  | (PreviewLineBase & { status: 'accepted'; input: RuleInput })
  | (PreviewLineBase & { status: 'duplicate' })
  | (PreviewLineBase & { status: 'invalid' });

const VERDICT_TONE: Record<PreviewLine['status'], 'success' | 'warning' | 'danger'> = {
  accepted: 'success',
  duplicate: 'warning',
  invalid: 'danger',
};

interface Preview {
  lines: PreviewLine[];
  /** The Rules the import will register, one per accepted line. */
  entries: ImportEntry[];
  duplicates: number;
  invalid: number;
}

/** What the last import did, kept after the preview is dropped. */
interface ImportSummary {
  kind: RuleKind;
  region: RegionCode;
  applied: number;
  rejected: ImportOutcome['rejected'];
  message: string | null;
  duplicates: number;
  invalid: number;
}

function SummaryCard({
  registeredLabel,
  registered,
  duplicates,
  invalid,
}: {
  registeredLabel: string;
  registered: number;
  duplicates: number;
  invalid: number;
}) {
  return (
    <Card>
      <KeyValueRow label={registeredLabel} value={formatCount(registered)} tone="default" />
      <KeyValueRow label="Duplicates skipped" value={formatCount(duplicates)} />
      <KeyValueRow label="Lines not read" value={formatCount(invalid)} />
    </Card>
  );
}

export default function BulkImportScreen() {
  const { state, error } = useStore();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<RuleKind>('block');
  const [region, setRegion] = useState<RegionCode>(state.settings.defaultRegion);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const supported = isSupported();

  /** Any change to the lines, the kind, or the region drops the preview and its list. */
  const changeText = (next: string) => {
    setText(next);
    setPreview(null);
    setFailure(null);
  };

  const changeKind = (next: RuleKind) => {
    setKind(next);
    setPreview(null);
    setFailure(null);
  };

  const changeRegion = (next: RegionCode) => {
    setRegion(next);
    setPreview(null);
    setFailure(null);
  };

  const buildPreview = () => {
    const pasted = splitPastedLines(text);
    // Core reads each line's Number pattern and its reason, so the Labels come
    // off here and the line numbers still point at the pasted text.
    const { lines: read } = parseBulkText({
      text: pasted.map((line) => line.numberText).join('\n'),
      region,
    });
    const entries: ImportEntry[] = [];
    const lines = read.map<PreviewLine>((entry) => {
      const original = pasted[entry.line - 1];
      const base: Omit<PreviewLineBase, 'detail'> = { line: entry.line, raw: original?.raw ?? entry.raw };
      const label = original?.label;
      if (label !== undefined) base.label = label;
      if (!entry.result.ok) {
        return { ...base, status: 'invalid', detail: entry.result.message };
      }
      const value = entry.result.value;
      const shape =
        value.end === undefined
          ? { pattern: value.pattern, number: value.number }
          : { pattern: value.pattern, number: value.number, end: value.end };
      if (state.rules.some((rule) => rule.kind === kind && isDuplicate(rule, shape))) {
        return { ...base, status: 'duplicate', detail: `Already in the ${kindLabel(kind)} list.` };
      }
      const input: RuleInput = { kind, pattern: value.pattern, number: value.number };
      if (value.end !== undefined) input.end = value.end;
      if (base.label !== undefined) input.label = base.label;
      entries.push({ line: entry.line, input });
      return { ...base, status: 'accepted', detail: `Will be registered as ${value.display}.`, input };
    });
    setPreview({
      lines,
      entries,
      duplicates: lines.filter((line) => line.status === 'duplicate').length,
      invalid: lines.filter((line) => line.status === 'invalid').length,
    });
    setResult(null);
    setFailure(null);
  };

  const runImport = async () => {
    if (!preview) return;
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await importRules(preview.entries);
      setResult({
        kind,
        region,
        // The engine reports no applied Rules when it cannot run at all, which
        // leaves the count below zero: the summary never shows a negative.
        applied: Math.max(outcome.applied, 0),
        rejected: outcome.rejected,
        message: outcome.message,
        duplicates: preview.duplicates,
        invalid: preview.invalid,
      });
      setPreview(null);
    } catch (reason) {
      setFailure(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  const canImport = preview !== null && preview.entries.length > 0;
  const refusedLines = result
    ? result.rejected.map(({ line, rule }) => `Line ${line}: ${patternText(rule, result.region)}`).join('\n')
    : '';

  return (
    <Screen>
      {error ? <Banner tone="danger" title="Saved state problem" message={error} /> : null}

      {supported ? null : (
        <Banner
          tone="info"
          title="This device cannot block calls"
          message={`${UNSUPPORTED_DETAIL} Rules you import here are kept, but nothing on this device acts on them.`}
        />
      )}

      <Section title="Lines to import" description="Blank lines and lines starting with # are ignored.">
        <TextField
          label="One Rule per line"
          hint={LINE_FORMAT}
          value={text}
          onChangeText={changeText}
          multiline
          numberOfLines={8}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={'08123456789\n08123*\n6281100-6281199, Office\n08123456789, Debt collector'}
          style={styles.paste}
        />
      </Section>

      <Section title="Whole import">
        <Segmented<RuleKind>
          value={kind}
          onChange={changeKind}
          options={[
            { value: 'block', label: 'Block' },
            { value: 'allow', label: 'Allow' },
          ]}
        />
        <AppText variant="small" tone="secondary">
          {`Every line is registered as a ${kindLabel(kind)} rule.`}
        </AppText>
        <RegionPicker value={region} onChange={changeRegion} />
        <AppText variant="small" tone="secondary">
          The Default region reads the lines. Changing it here does not change Settings.
        </AppText>
      </Section>

      <Row gap={Spacing.two}>
        <Button
          label="Preview"
          variant="secondary"
          onPress={buildPreview}
          disabled={busy || text.trim().length === 0}
          style={styles.action}
        />
        <Button
          label="Import"
          onPress={() => void runImport()}
          disabled={!canImport}
          busy={busy}
          style={styles.action}
        />
      </Row>

      {failure ? <Banner tone="danger" title="The import could not run" message={failure} /> : null}

      {result ? (
        <>
          {result.applied > 0 ? (
            <Banner
              tone="success"
              title="Bulk import finished"
              message={`${formatCount(result.applied)} ${
                result.applied === 1 ? 'Rule was' : 'Rules were'
              } registered in the ${kindLabel(result.kind)} list.`}
            />
          ) : null}
          {result.rejected.length > 0 ? (
            <Banner
              tone="danger"
              title={
                result.rejected.length === 1
                  ? 'One line was refused'
                  : `${formatCount(result.rejected.length)} lines were refused`
              }
              message={result.message ? `${refusedLines}\n\n${result.message}` : refusedLines}
            />
          ) : null}
          {result.applied <= 0 && result.rejected.length === 0 ? (
            <Banner tone="danger" title="Nothing was imported" message={result.message ?? undefined} />
          ) : null}
          <SummaryCard
            registeredLabel="Rules registered"
            registered={result.applied}
            duplicates={result.duplicates}
            invalid={result.invalid}
          />
          <AppText variant="small" tone="secondary">
            Preview again before importing more lines.
          </AppText>
        </>
      ) : null}

      {preview ? (
        <Section title="Preview">
          {preview.lines.length === 0 ? (
            <Banner tone="warning" title="Nothing to import" message="Every line was blank or started with #." />
          ) : (
            <>
              <Card style={styles.list}>
                {preview.lines.map((line, index) => (
                  <View key={line.line}>
                    {index > 0 ? <Divider /> : null}
                    <Row align="flex-start" gap={Spacing.two} style={styles.previewRow}>
                      <AppText variant="smallBold" tone="secondary" style={styles.lineNumber}>
                        {formatCount(line.line)}
                      </AppText>
                      <View style={styles.previewText}>
                        <AppText variant="mono">{line.raw.trim()}</AppText>
                        {line.label !== undefined ? (
                          <AppText variant="small" tone="secondary">{`Label: ${line.label}`}</AppText>
                        ) : null}
                        <AppText variant="small" tone={VERDICT_TONE[line.status]}>
                          {line.detail}
                        </AppText>
                      </View>
                    </Row>
                  </View>
                ))}
              </Card>
              <SummaryCard
                registeredLabel="Rules to register"
                registered={preview.entries.length}
                duplicates={preview.duplicates}
                invalid={preview.invalid}
              />
            </>
          )}
        </Section>
      ) : null}

      {!preview && !result ? (
        <EmptyState
          title="Nothing previewed yet"
          message="A Bulk import registers many Rules at once from pasted lines, with one Block or Allow choice for the whole import."
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  paste: { minHeight: 140, textAlignVertical: 'top' },
  action: { flex: 1 },
  list: { gap: 0, paddingVertical: 0 },
  previewRow: { paddingVertical: Spacing.two },
  lineNumber: { minWidth: 28 },
  previewText: { flex: 1, gap: Spacing.half },
});
