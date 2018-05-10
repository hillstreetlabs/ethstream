export default (promise, timeout) => {
  return new Promise((resolve, reject) => {
    let timer = setTimeout(
      () => reject(`Timeout of ${timeout}ms exceeded`),
      timeout
    );
    promise
      .then((...args) => {
        if (timer) {
          clearTimeout(timer);
          resolve(...args);
        }
      })
      .catch((...args) => {
        if (timer) {
          clearTimeout(timer);
          reject(...args);
        }
      });
  });
};

