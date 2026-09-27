// Background builders fan out many independent reads. Bound database pressure
// across all of them so the expensive sales aggregate has room to complete.
export function limitConcurrentFetch(fetcher, concurrency = 2) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid fetch concurrency');
  let active = 0;
  const waiting = [];
  return async (...args) => {
    if (active >= concurrency) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fetcher(...args);
    } finally {
      const next = waiting.shift();
      if (next) next(); // Transfer this permit without opening a race for it.
      else active--;
    }
  };
}
