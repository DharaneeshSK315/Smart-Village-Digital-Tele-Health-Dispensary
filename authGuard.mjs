export function createAuthGuard() {
  let currentTimer = null;
  let version = 0;

  return {
    schedule(task, delay = 0) {
      version += 1;
      const activeVersion = version;

      if (currentTimer) {
        clearTimeout(currentTimer);
      }

      currentTimer = setTimeout(() => {
        if (activeVersion !== version) {
          return;
        }
        currentTimer = null;
        task();
      }, delay);
    },
    clear() {
      version += 1;
      if (currentTimer) {
        clearTimeout(currentTimer);
        currentTimer = null;
      }
    }
  };
}
