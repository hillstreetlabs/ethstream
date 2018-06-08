type EventHandler = (...args: any[]) => void;

export default class EventEmitter {
  listeners: { [event: string]: EventHandler[] } = {};

  on(event: string, listener: EventHandler) {
    if (typeof this.listeners[event] === "undefined")
      this.listeners[event] = [];

    this.listeners[event].push(listener);
  }

  removeListener(event: string, listener: EventHandler) {
    if (typeof this.listeners[event] === "undefined") return;

    const index = this.listeners[event].indexOf(listener);
    if (index > -1) this.listeners[event].splice(index, 1);
  }

  emit(event: string, ...args: any[]) {
    if (typeof this.listeners[event] === "undefined") return;

    this.listeners[event].forEach(handler => {
      handler.apply(this, args);
    });
  }

  once(event: string, listener: EventHandler) {
    const inner = (...args: any[]) => {
      listener(...args);
      this.removeListener(event, inner);
    };
    this.on(event, inner);
  }

  promise(event: string) {
    return new Promise(resolve => this.once(event, resolve));
  }
}
