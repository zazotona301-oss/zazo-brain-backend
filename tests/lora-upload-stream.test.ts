import { describe, expect, it } from 'vitest';
import { createStreamedMultipartFile } from '../src/lora-upload-stream';

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  return haystack.some((_, index) => needle.every((byte, part) => haystack[index + part] === byte));
}

describe('streamed LoRA multipart upload', () => {
  it('streams multipart headers, the exact binary file bytes, and the closing boundary', async () => {
    const sourceBytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    const file = new Blob([sourceBytes], { type: 'application/octet-stream' });
    const { body, contentType } = createStreamedMultipartFile('adapter_model.safetensors', file);
    const bytes = await collect(body);
    const text = new TextDecoder().decode(bytes);

    expect(contentType).toMatch(/^multipart\/form-data; boundary=----zazo-/);
    expect(text).toContain('name="file_name"');
    expect(text).toContain('adapter_model.safetensors');
    expect(text).toContain('name="file"; filename="adapter_model.safetensors"');
    expect(containsBytes(bytes, sourceBytes)).toBe(true);
    expect(text.endsWith('--\r\n')).toBe(true);
  });

  it('reads the file as multiple chunks instead of requesting an array buffer', async () => {
    const sourceChunks = [new Uint8Array([10, 11]), new Uint8Array([12, 13])];
    let streamOpened = false;
    const file = {
      type: 'application/octet-stream',
      stream() {
        streamOpened = true;
        let index = 0;
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index === sourceChunks.length) controller.close();
            else controller.enqueue(sourceChunks[index++]);
          },
        });
      },
    } as Pick<Blob, 'stream' | 'type'>;

    const { body } = createStreamedMultipartFile('adapter_model.safetensors', file);
    expect(streamOpened).toBe(true);
    const bytes = await collect(body);
    expect(containsBytes(bytes, new Uint8Array([10, 11]))).toBe(true);
    expect(containsBytes(bytes, new Uint8Array([12, 13]))).toBe(true);
  });
});
