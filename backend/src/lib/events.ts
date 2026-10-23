import { EventEmitter } from "events";
/** In-process event bus used to push new alerts to connected SSE clients. */
export const bus = new EventEmitter();
bus.setMaxListeners(100);
