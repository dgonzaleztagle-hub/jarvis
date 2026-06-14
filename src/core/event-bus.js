const { EventEmitter } = require('events');

class EventBus {
  constructor() {
    this.emitter = new EventEmitter();
    this.events = [];
  }

  emit(type, payload = {}) {
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type,
      payload,
      createdAt: new Date().toISOString()
    };
    this.events.push(event);
    if (this.events.length > 500) this.events.shift();
    this.emitter.emit(type, event);
    this.emitter.emit('*', event);
    return event;
  }

  on(type, listener) {
    this.emitter.on(type, listener);
    return () => this.emitter.off(type, listener);
  }

  recent(limit = 100) {
    return this.events.slice(-limit);
  }
}

module.exports = {
  EventBus
};
