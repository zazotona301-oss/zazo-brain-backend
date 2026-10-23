const encoder = new TextEncoder();

export interface StreamedMultipartFile {
  body: ReadableStream<Uint8Array>;
  contentType: string;
}

/**
 * يبني multipart/form-data من تيار الملف نفسه، فلا ينشئ نسخة كاملة عبر arrayBuffer().
 * ترتيب الحقول متوافق مع Cloudflare AI finetune-assets REST API.
 */
export function createStreamedMultipartFile(
  fileName: string,
  file: Pick<Blob, 'stream' | 'type'>,
): StreamedMultipartFile {
  const boundary = `----zazo-${crypto.randomUUID()}`;
  const prefix = encoder.encode(
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="file_name"\r\n\r\n' +
    `${fileName}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const fileReader = file.stream().getReader();
  let prefixSent = false;
  let suffixSent = false;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!prefixSent) {
        prefixSent = true;
        controller.enqueue(prefix);
        return;
      }

      if (!suffixSent) {
        const { value, done } = await fileReader.read();
        if (!done) {
          controller.enqueue(value);
          return;
        }
        suffixSent = true;
        controller.enqueue(suffix);
        return;
      }

      controller.close();
      fileReader.releaseLock();
    },
    async cancel(reason) {
      await fileReader.cancel(reason).catch(() => undefined);
    },
  });

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
