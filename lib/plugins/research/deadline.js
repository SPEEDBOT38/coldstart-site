// A deadline for an entire stage, including retries and body reads.
export function deadlineFetch(fetchImpl, end) {
  return async (url, options = {}) => {
    const left = end - Date.now();
    if (left <= 0) throw new Error('Search time budget exhausted');
    const timer = AbortSignal.timeout(left);
    return fetchImpl(url, { ...options, signal: options.signal ? AbortSignal.any([timer, options.signal]) : timer });
  };
}
