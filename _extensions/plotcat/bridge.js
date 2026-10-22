window.plotCat = {
  queue: [],
  provide(engine, promise) {
    this.queue.push([engine, promise]);
  }
};
