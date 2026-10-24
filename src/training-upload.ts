import { z } from 'zod';
import { idSchema } from './validation';

export const MAX_TRAINING_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TRAINING_REQUEST_BYTES = 25 * 1024 * 1024;
export const MAX_TRAINING_ROWS = 1_000;
export const MAX_TRAINING_TEXT_CHARACTERS = 3_000_000;

const supportedExtensions = new Set(['json', 'jsonl', 'ndjson', 'csv', 'tsv']);
const inputKeys = ['instruction', 'input', 'prompt', 'question', 'query', 'user', 'text', 'content'];
const contextKeys = ['context', 'system', 'background', 'metadata', 'notes'];
const outputKeys = ['response', 'output', 'answer', 'completion', 'assistant', 'target', 'label'];
const trainingRowSchema = z.object({
  instruction: z.string().trim().min(1).max(20_000),
  context: z.string().trim().max(20_000).default(''),
  response: z.string().trim().min(1).max(20_000),
  tags: z.array(z.string().trim().min(1).max(100)).max(40).default([]),
  sourceRow: z.number().int().positive().max(1_000_000).optional(),
});

export const trainingRowsSchema = z.array(trainingRowSchema).min(1).max(MAX_TRAINING_ROWS);
export const trainingUploadIdSchema = idSchema;
export type TrainingUploadRow = z.infer<typeof trainingRowSchema>;

export function fileExtension(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop() || '';
  const separator = baseName.lastIndexOf('.');
  return separator >= 0 ? baseName.slice(separator + 1).toLowerCase() : '';
}

export function isSupportedTrainingFile(fileName: string): boolean {
  return supportedExtensions.has(fileExtension(fileName));
}

export function isArabicTrainingText(value: string): boolean {
  const letters = Array.from(value).filter((character) => /\p{L}/u.test(character));
  if (!letters.length) return false;
  const arabicLetters = letters.filter((character) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(character)).length;
  return arabicLetters / letters.length >= 0.4;
}

export function invalidArabicTrainingRows(rows: TrainingUploadRow[]): number[] {
  return rows.flatMap((row, index) => (
    isArabicTrainingText(row.instruction)
      && isArabicTrainingText(row.response)
      && (!row.context || isArabicTrainingText(row.context))
      ? []
      : [row.sourceRow ?? index + 1]
  ));
}

export function totalTrainingTextCharacters(rows: TrainingUploadRow[]): number {
  return rows.reduce((total, row) => total + row.instruction.length + row.context.length + row.response.length, 0);
}

export function parseTrainingFile(fileName: string, rawText: string): TrainingUploadRow[] {
  if (!isSupportedTrainingFile(fileName)) throw new Error('الصيغ المدعومة هي JSON وJSONL وNDJSON وCSV وTSV');
  const text = rawText.replace(/^\uFEFF/, '');
  const extension = fileExtension(fileName);
  let rows: TrainingUploadRow[];
  if (extension === 'jsonl' || extension === 'ndjson') {
    rows = text.split(/\r?\n/).flatMap((line, index) => {
      if (!line.trim()) return [];
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`سطر JSONL رقم ${index + 1} ليس JSON صالحًا`);
      }
      return normalizeJsonRecord(value, index + 1);
    });
  } else if (extension === 'json') {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('ملف JSON غير صالح');
    }
    const sourceRecords = Array.isArray(value)
      ? value
      : value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)
        ? (value as { data: unknown[] }).data
        : [value];
    rows = sourceRecords.flatMap((record, index) => normalizeJsonRecord(record, index + 1));
  } else {
    rows = parseDelimitedFile(text, extension === 'tsv' ? '\t' : ',');
  }

  if (rows.length > MAX_TRAINING_ROWS) throw new Error(`الحد الأقصى ${MAX_TRAINING_ROWS} مثال لكل ملف`);
  const parsed = trainingRowsSchema.safeParse(rows);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const rowIndex = typeof issue?.path[0] === 'number' ? issue.path[0] + 1 : undefined;
    throw new Error(rowIndex ? `المثال رقم ${rowIndex} ناقص أو يتجاوز حد طول الحقل` : 'يحتوي الملف أمثلة ناقصة');
  }
  if (totalTrainingTextCharacters(parsed.data) > MAX_TRAINING_TEXT_CHARACTERS) {
    throw new Error(`إجمالي نصوص التدريب يتجاوز ${MAX_TRAINING_TEXT_CHARACTERS} حرف`);
  }
  return parsed.data;
}

function normalizeJsonRecord(value: unknown, sourceRow: number): TrainingUploadRow[] {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const tags = normalizeTags(record.tags ?? record.tag ?? record.labels);
  const context = readValue(record, contextKeys);
  if (Array.isArray(record.messages)) {
    const rows: TrainingUploadRow[] = [];
    let pendingUser = '';
    for (const message of record.messages) {
      if (!message || typeof message !== 'object') continue;
      const item = message as { role?: unknown; content?: unknown };
      const content = typeof item.content === 'string' ? item.content.trim() : '';
      if (!content) continue;
      if (item.role === 'user') {
        pendingUser = content;
      } else if (item.role === 'assistant' && pendingUser) {
        rows.push({ instruction: pendingUser, context, response: content, tags, sourceRow });
        pendingUser = '';
        if (rows.length > MAX_TRAINING_ROWS) throw new Error(`الحد الأقصى ${MAX_TRAINING_ROWS} مثال لكل ملف`);
      }
    }
    if (rows.length) return rows;
  }
  return [{
    instruction: readValue(record, inputKeys),
    context,
    response: readValue(record, outputKeys),
    tags,
    sourceRow,
  }];
}

function readValue(record: Record<string, unknown>, keys: string[]): string {
  const key = keys.find((candidate) => record[candidate] !== undefined && record[candidate] !== null);
  const value = key ? record[key] : '';
  if (typeof value === 'string') return value.trim();
  if (value === '') return '';
  return JSON.stringify(value) ?? String(value);
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 40);
  return String(value || '').split(/[,،|]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 40);
}

function parseDelimitedFile(text: string, delimiter: string): TrainingUploadRow[] {
  const records = parseDelimitedRecords(text, delimiter);
  while (records.length && records[records.length - 1].every((field) => !field.trim())) records.pop();
  const headerRow = records.shift();
  if (!headerRow?.length) throw new Error('ملف CSV/TSV فارغ');
  const headers = headerRow.map((header) => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error('يجب أن تكون أسماء أعمدة CSV/TSV غير مكررة');
  const inputIndex = headers.findIndex((header) => inputKeys.includes(header));
  const outputIndex = headers.findIndex((header) => outputKeys.includes(header));
  if (inputIndex < 0 || outputIndex < 0) throw new Error('يجب أن يحتوي CSV/TSV أعمدة instruction/question وresponse/answer');
  const contextIndex = headers.findIndex((header) => contextKeys.includes(header));
  const tagsIndex = headers.findIndex((header) => ['tags', 'tag', 'labels'].includes(header));
  return records.flatMap((record, index) => {
    if (record.every((field) => !field.trim())) return [];
    const tags = tagsIndex < 0 ? [] : normalizeTags(record[tagsIndex] || '');
    return [{
      instruction: record[inputIndex] || '',
      context: contextIndex < 0 ? '' : record[contextIndex] || '',
      response: record[outputIndex] || '',
      tags,
      sourceRow: index + 2,
    }];
  });
}

function parseDelimitedRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      record.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('يوجد حقل مقتبس غير مغلق في CSV/TSV');
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function createTrainingUploadName(fileName: string, uploadId: string, createdAt = new Date()): string {
  const baseName = fileName.split(/[\\/]/).pop() || 'training-file';
  const separator = baseName.lastIndexOf('.');
  const stem = separator > 0 ? baseName.slice(0, separator) : baseName;
  const extension = fileExtension(baseName) || 'data';
  const safeStem = stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'training-file';
  const timestamp = createdAt.toISOString().replace(/[-:.]/g, '').replace(/Z$/, 'Z');
  return `zazo-training-${timestamp}-${uploadId}-${safeStem}.${extension}`;
}

/** Deterministic UUIDv5-style row ID makes retries of one upload idempotent. */
export async function trainingRowId(uploadId: string, rowIndex: number): Promise<string> {
  const namespace = uploadId.replaceAll('-', '').match(/.{2}/g);
  if (!namespace || namespace.length !== 16) throw new TypeError('uploadId must be a UUID');
  const namespaceBytes = new Uint8Array(namespace.map((byte) => Number.parseInt(byte, 16)));
  const rowBytes = new TextEncoder().encode(String(rowIndex));
  const name = new Uint8Array(namespaceBytes.length + rowBytes.length);
  name.set(namespaceBytes);
  name.set(rowBytes, namespaceBytes.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', name));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
