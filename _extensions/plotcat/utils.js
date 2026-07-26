export async function withRetry(fn, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (1 << (attempt - 1))));
      } else {
        throw error;
      }
    }
  }
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function parseSvgDoc(source) {
  if (typeof source === 'string') {
    return new DOMParser().parseFromString(source, 'image/svg+xml');
  }
  return source;
}

export function serializeSvgDoc(doc) {
  return new XMLSerializer().serializeToString(doc.documentElement);
}
